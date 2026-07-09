/**
 * `parseDocument` — the deterministic SPEC v1 parser (§5.6).
 *
 * Pipeline: analyze the AST for exclusion ranges / task-list options / block
 * spans (see mdast.ts) → tokenize `wp:` comments over the raw string → pair
 * open/close tokens by a small state machine → capture byte spans and the
 * response currently embedded in the document. Malformed structure degrades to
 * {@link Warning}s; nothing here throws on bad input.
 */

import { parse as parseYaml } from "yaml";
import { analyzeDocument, type DocumentAnalysis, type TaskItem } from "./mdast.js";
import { tokenizeWpComments, type WpToken } from "./html.js";
import type {
  Comment,
  Frontmatter,
  Item,
  ItemResponse,
  ItemSpans,
  ParseResult,
  ResponseStatus,
  ResponseValue,
  ReviewComment,
  ReviewState,
  Span,
  SpanIndex,
  Warning,
} from "./types.js";

/** Parse result plus the AST-derived data the splice writer needs. */
export interface InternalParseResult extends ParseResult {
  analysis: DocumentAnalysis;
}

const STATUSES = new Set<ResponseStatus>(["answered", "flagged", "skipped"]);

interface WorkingQuestion {
  wpId: string;
  type: "text" | "choice" | undefined;
  select?: "single" | "multi";
  open: Span;
  answerOpen?: Span;
  answerStatus?: string;
  answerClose?: Span;
  answerInterior?: Span;
  rationaleOpen?: Span;
  rationaleClose?: Span;
  rationaleInterior?: Span;
}

interface WorkingComment {
  id: string;
  attrs: Record<string, string>;
  open: Span;
  interiorStart: number;
  suggestionOpen?: Span;
  suggestionInterior?: Span;
  suggestionClose?: Span;
}

function tokenSpan(token: WpToken): Span {
  return { start: token.start, end: token.end };
}

function parseFrontmatter(text: string | null): Frontmatter {
  if (text === null) return {};
  try {
    const parsed = parseYaml(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Frontmatter;
    }
    return {};
  } catch {
    // Malformed YAML is a warning-worthy soft failure, not a hard error (§5.6).
    return {};
  }
}

function asStatus(value: string | undefined): ResponseStatus | undefined {
  return value && STATUSES.has(value as ResponseStatus) ? (value as ResponseStatus) : undefined;
}

/** Full parse plus the AST analysis; used internally by the splice writer. */
export function parseInternal(raw: string): InternalParseResult {
  const analysis = analyzeDocument(raw);
  const tokens = tokenizeWpComments(raw, analysis.excluded);

  const items: Item[] = [];
  const comments: Comment[] = [];
  const warnings: Warning[] = [];
  const seenIds = new Set<string>();

  let question: WorkingQuestion | null = null;
  let comment: WorkingComment | null = null;

  const warn = (code: Warning["code"], message: string, extra?: Partial<Warning>) =>
    warnings.push({ code, message, ...extra });

  const finishQuestion = (closeToken?: WpToken) => {
    if (!question) return;
    const q = question;
    question = null;

    if (!q.answerClose && q.answerOpen) {
      warn("unclosed-answer", `wp:answer for "${q.wpId}" was never closed`, { wpId: q.wpId, offset: q.answerOpen.start });
    }
    if (!q.rationaleClose && q.rationaleOpen) {
      warn("unclosed-rationale", `wp:rationale for "${q.wpId}" was never closed`, { wpId: q.wpId, offset: q.rationaleOpen.start });
    }

    const blockEnd = closeToken ? closeToken.end : q.answerClose?.end ?? q.answerOpen?.end ?? q.rationaleClose?.end ?? q.rationaleOpen?.end ?? q.open.end;
    const boundary = q.answerOpen?.start ?? closeToken?.start ?? blockEnd;

    // Options end at the rationale block when present (§5.3): the rationale is
    // author prose that may itself contain a list, and it must never be mistaken
    // for a choice option — that would also let a checkbox flip splice into it.
    // Use the *earlier* of the rationale-open and the answer/close boundary, so a
    // well-placed rationale tightens the scan while a misplaced one (after
    // wp:answer, contrary to §5.3) can never loosen it past the answer.
    const optionsBoundary = Math.min(q.rationaleOpen?.start ?? Infinity, boundary);
    const options = q.type === "choice" || q.type === undefined
      ? analysis.taskItems.filter((t) => t.start > q.open.end && t.start < optionsBoundary)
      : [];

    let type = q.type;
    if (type === undefined) {
      warn("missing-type", `wp:question "${q.wpId}" has no type; inferred from content`, { wpId: q.wpId, offset: q.open.start });
      type = options.length > 0 ? "choice" : "text";
    }

    const promptEnd = type === "choice" && options.length > 0
      ? Math.min(...options.map((o) => o.listStart))
      : boundary;
    const promptMd = raw.slice(q.open.end, promptEnd).trim();

    const spans: ItemSpans = {
      block: { start: q.open.start, end: blockEnd },
      questionOpen: q.open,
      questionClose: closeToken ? tokenSpan(closeToken) : undefined,
      answerOpen: q.answerOpen,
      answerClose: q.answerClose,
      answerInterior: q.answerInterior,
      rationaleOpen: q.rationaleOpen,
      rationaleClose: q.rationaleClose,
      rationaleInterior: q.rationaleInterior,
    };

    const item: Item = { wpId: q.wpId, type, promptMd, spans };

    if (type === "choice") {
      if (options.length === 0) {
        warn("no-options", `choice question "${q.wpId}" has no task-list options`, { wpId: q.wpId, offset: q.open.start });
      }
      item.select = q.select ?? "single";
      item.options = options.map((o) => ({ label: o.label, checked: o.checked, marker: o.marker }));
    }

    // Author "why this option" rationale (§5.3, SPEC 1.1.0) — captured only when
    // the block is closed and non-empty. This is input, never review state, so
    // `extractResponse` below never reads it and `applyReview` never rewrites it.
    if (q.rationaleClose && q.rationaleInterior) {
      const rationaleMd = raw.slice(q.rationaleInterior.start, q.rationaleInterior.end).trim();
      if (rationaleMd.length > 0) item.rationale = rationaleMd;
    }

    item.response = extractResponse(raw, item, q, options, warn);
    if (item.response && Object.keys(item.response).length === 0) item.response = undefined;

    if (q.wpId && seenIds.has(q.wpId)) {
      warn("duplicate-id", `duplicate wp id "${q.wpId}"`, { wpId: q.wpId, offset: q.open.start });
    }
    if (q.wpId) seenIds.add(q.wpId);

    items.push(item);
  };

  const finishComment = (closeToken: WpToken) => {
    if (!comment) return;
    const c = comment;
    comment = null;

    const interiorEnd = c.suggestionOpen ? c.suggestionOpen.start : closeToken.start;
    const bodyMd = raw.slice(c.interiorStart, interiorEnd).trim();
    const suggestionMd = c.suggestionInterior
      ? raw.slice(c.suggestionInterior.start, c.suggestionInterior.end).trim()
      : undefined;

    comments.push({
      id: c.id,
      anchor: {
        exact: c.attrs.exact ?? "",
        prefix: c.attrs.prefix,
        suffix: c.attrs.suffix,
        exactHash: c.attrs["exact-hash"],
      },
      bodyMd,
      suggestionMd,
      spans: {
        block: { start: c.open.start, end: closeToken.end },
        open: c.open,
        close: tokenSpan(closeToken),
        suggestionOpen: c.suggestionOpen,
        suggestionClose: c.suggestionClose,
      },
    });
  };

  for (const token of tokens) {
    if (!token.close) {
      switch (token.tag) {
        case "question": {
          if (question) {
            warn("unclosed-question", `wp:question "${question.wpId}" was never closed`, { wpId: question.wpId, offset: question.open.start });
            finishQuestion();
          }
          if (!token.attrs.id) warn("missing-id", "wp:question has no id", { offset: token.start });
          const rawType = token.attrs.type;
          if (rawType && rawType !== "text" && rawType !== "choice") {
            warn("unknown-type", `wp:question has unknown type "${rawType}"`, { wpId: token.attrs.id, offset: token.start });
          }
          question = {
            wpId: token.attrs.id ?? "",
            type: rawType === "text" || rawType === "choice" ? rawType : undefined,
            select: token.attrs.select === "multi" ? "multi" : token.attrs.select === "single" ? "single" : undefined,
            open: tokenSpan(token),
          };
          break;
        }
        case "answer": {
          if (!question) {
            warn("answer-outside-question", "wp:answer outside any wp:question", { offset: token.start });
            break;
          }
          if (question.answerOpen) {
            warn("duplicate-answer", `wp:question "${question.wpId}" has more than one wp:answer`, { wpId: question.wpId, offset: token.start });
          }
          question.answerOpen = tokenSpan(token);
          question.answerStatus = token.attrs.status;
          question.answerInterior = { start: token.end, end: token.end };
          break;
        }
        case "rationale": {
          if (!question) {
            warn("rationale-outside-question", "wp:rationale outside any wp:question", { offset: token.start });
            break;
          }
          if (question.rationaleOpen) {
            warn("duplicate-rationale", `wp:question "${question.wpId}" has more than one wp:rationale`, { wpId: question.wpId, offset: token.start });
          }
          question.rationaleOpen = tokenSpan(token);
          question.rationaleInterior = { start: token.end, end: token.end };
          break;
        }
        case "comment": {
          if (comment) {
            warn("nested-comment", `wp:comment "${comment.id}" was never closed before a new one`, { offset: token.start });
            comment = null;
          }
          comment = {
            id: token.attrs.id ?? "",
            attrs: token.attrs,
            open: tokenSpan(token),
            interiorStart: token.end,
          };
          break;
        }
        case "suggestion": {
          if (!comment) {
            warn("suggestion-outside-comment", "wp:suggestion outside any wp:comment", { offset: token.start });
            break;
          }
          comment.suggestionOpen = tokenSpan(token);
          comment.suggestionInterior = { start: token.end, end: token.end };
          break;
        }
      }
    } else {
      switch (token.tag) {
        case "question": {
          if (!question) {
            warn("orphan-question-close", "/wp:question with no open question", { offset: token.start });
            break;
          }
          finishQuestion(token);
          break;
        }
        case "answer": {
          if (!question || !question.answerOpen) {
            warn("orphan-answer-close", "/wp:answer with no open answer", { offset: token.start });
            break;
          }
          question.answerClose = tokenSpan(token);
          question.answerInterior = { start: question.answerOpen.end, end: token.start };
          break;
        }
        case "rationale": {
          if (!question || !question.rationaleOpen) {
            warn("orphan-rationale-close", "/wp:rationale with no open rationale", { offset: token.start });
            break;
          }
          question.rationaleClose = tokenSpan(token);
          question.rationaleInterior = { start: question.rationaleOpen.end, end: token.start };
          break;
        }
        case "comment": {
          if (!comment) {
            warn("orphan-comment-close", "/wp:comment with no open comment", { offset: token.start });
            break;
          }
          finishComment(token);
          break;
        }
        case "suggestion": {
          if (!comment || !comment.suggestionOpen) {
            warn("orphan-suggestion", "/wp:suggestion with no open suggestion", { offset: token.start });
            break;
          }
          comment.suggestionInterior = { start: comment.suggestionOpen.end, end: token.start };
          comment.suggestionClose = tokenSpan(token);
          break;
        }
      }
    }
  }

  if (question) {
    warn("unclosed-question", `wp:question "${question.wpId}" was never closed`, { wpId: question.wpId, offset: question.open.start });
    finishQuestion();
  }
  if (comment) {
    warn("unclosed-comment", `wp:comment "${comment.id}" was never closed`, { offset: comment.open.start });
  }

  const spans: SpanIndex = {
    frontmatter: analysis.frontmatter,
    items: items.map((i) => i.spans),
    comments: comments.map((c) => c.spans),
  };

  return {
    frontmatter: parseFrontmatter(analysis.frontmatterText),
    items,
    comments,
    spans,
    warnings,
    analysis,
  };
}

function extractResponse(
  raw: string,
  item: Item,
  q: WorkingQuestion,
  options: TaskItem[],
  warn: (code: Warning["code"], message: string, extra?: Partial<Warning>) => void,
): ItemResponse | undefined {
  const response: ItemResponse = {};
  const interior = q.answerInterior ? raw.slice(q.answerInterior.start, q.answerInterior.end).trim() : "";
  const status = asStatus(q.answerStatus);
  if (status) response.status = status;

  if (item.type === "text") {
    if (interior.length > 0) response.text = interior;
  } else {
    let checked = options.filter((o) => o.checked);
    if (item.select === "single" && checked.length > 1) {
      warn("multi-checked-single", `select="single" question "${q.wpId}" has ${checked.length} checked boxes; first wins`, {
        wpId: q.wpId,
        offset: q.open.start,
      });
      checked = [checked[0]];
    }
    if (checked.length > 0) response.selected = checked.map((o) => o.label);
    if (interior.length > 0) response.other = interior;
  }

  return Object.keys(response).length > 0 ? response : undefined;
}

/** The public SPEC v1 parser (§5.6). Never throws; malformed input warns. */
export function parseDocument(raw: string): ParseResult {
  const { frontmatter, items, comments, spans, warnings } = parseInternal(raw);
  return { frontmatter, items, comments, spans, warnings };
}

/** True when a response carries no reviewer intent (no text/selection/status). */
export function responseIsEmpty(value: ResponseValue): boolean {
  const hasText = typeof value.text === "string" && value.text.trim().length > 0;
  const hasSelected = Array.isArray(value.selected) && value.selected.length > 0;
  const hasOther = typeof value.other === "string" && value.other.trim().length > 0;
  const hasStatus = !!value.status;
  // An explicit-empty response (W1) carries intent — the reviewer cleared a
  // pre-filled draft — so it is not "empty" for review-non-emptiness purposes.
  const isCleared = value.cleared === true;
  return !(hasText || hasSelected || hasOther || hasStatus || isCleared);
}

/** True when a review has no meaningful responses and no comments (§11). */
export function reviewIsEmpty(review: ReviewState): boolean {
  if (review.comments && review.comments.length > 0) return false;
  const responses = review.responses ?? {};
  for (const key of Object.keys(responses)) {
    if (!responseIsEmpty(responses[key])) return false;
  }
  return true;
}

/**
 * Rebuild a {@link ReviewState} from a parsed document — the responses and
 * comments currently embedded in the source. This is the round-trip target:
 * `extractReviewState(parseDocument(applyReview(raw, s)))` recovers `s` (§17.3).
 */
export function extractReviewState(parsed: ParseResult): ReviewState {
  const responses: Record<string, ResponseValue> = {};
  for (const item of parsed.items) {
    if (item.response && !responseIsEmpty(item.response)) {
      responses[item.wpId] = item.response;
    }
  }
  const comments: ReviewComment[] = parsed.comments.map((c) => {
    const review: ReviewComment = { id: c.id, anchor: c.anchor, bodyMd: c.bodyMd };
    if (c.suggestionMd !== undefined) review.suggestionMd = c.suggestionMd;
    return review;
  });

  const state: ReviewState = {};
  if (Object.keys(responses).length > 0) state.responses = responses;
  if (comments.length > 0) state.comments = comments;
  return state;
}
