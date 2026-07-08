import { lookup } from "node:dns/promises";
import net from "node:net";
import { HttpError } from "../api/http";
import { MAX_DOC_BYTES } from "./constants";

/**
 * The URL ingest door (§7, §15). Basic SSRF hygiene: http/https only, text
 * content-types only, a 1 MB cap, and — the important part — every hostname
 * (including each redirect hop) is DNS-resolved and rejected if it maps to a
 * private, loopback, or link-local address.
 */

export class UrlDoorError extends HttpError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
    this.name = "UrlDoorError";
  }
}

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 10_000;

/** Parse a dotted-quad into four octets, or null if it is not IPv4. */
function ipv4Octets(ip: string): [number, number, number, number] | null {
  if (!net.isIPv4(ip)) return null;
  const parts = ip.split(".").map((p) => Number(p));
  return [parts[0], parts[1], parts[2], parts[3]];
}

function isPrivateIpv4(ip: string): boolean {
  const o = ipv4Octets(ip);
  if (!o) return false;
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved/broadcast
  return false;
}

/** Expand an IPv6 address (incl. `::` and embedded IPv4) to 16 bytes, or null. */
function ipv6Bytes(ip: string): number[] | null {
  if (!net.isIPv6(ip)) return null;
  let head = ip;
  let tail = "";
  const zoneIdx = head.indexOf("%");
  if (zoneIdx !== -1) head = head.slice(0, zoneIdx); // strip scope id

  const dbl = head.split("::");
  if (dbl.length > 2) return null;
  if (dbl.length === 2) {
    head = dbl[0];
    tail = dbl[1];
  }

  const toGroups = (segment: string): number[] => {
    if (segment === "") return [];
    const groups: number[] = [];
    for (const part of segment.split(":")) {
      if (part.includes(".")) {
        // Embedded IPv4 tail, e.g. ::ffff:192.0.2.1
        const o = ipv4Octets(part);
        if (!o) return groups.concat([NaN]);
        groups.push((o[0] << 8) | o[1], (o[2] << 8) | o[3]);
      } else {
        groups.push(parseInt(part, 16));
      }
    }
    return groups;
  };

  const headGroups = toGroups(head);
  const tailGroups = dbl.length === 2 ? toGroups(tail) : [];
  const fill = 8 - headGroups.length - tailGroups.length;
  if (fill < 0) return null;
  const groups = [...headGroups, ...Array(fill).fill(0), ...tailGroups];
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;

  const bytes: number[] = [];
  for (const g of groups) bytes.push((g >> 8) & 0xff, g & 0xff);
  return bytes;
}

function isPrivateIpv6(ip: string): boolean {
  const b = ipv6Bytes(ip);
  if (!b) return false;
  // ::1 loopback and :: unspecified
  const allZeroButLast = b.slice(0, 15).every((x) => x === 0);
  if (allZeroButLast && (b[15] === 1 || b[15] === 0)) return true;
  if (b[0] === 0xff) return true; // ff00::/8 multicast
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  // ::ffff:0:0/96 IPv4-mapped — evaluate the embedded IPv4.
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
    return isPrivateIpv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }
  return false;
}

/** True when `ip` is loopback, private, link-local, or otherwise non-public. */
export function isPrivateIp(ip: string): boolean {
  return isPrivateIpv4(ip) || isPrivateIpv6(ip);
}

/**
 * Resolve `hostname` and reject if any resolved address is non-public. Guards
 * both literal-IP hosts and DNS names (a name that resolves to 127.0.0.1 is
 * blocked just the same).
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  // Strip IPv6 brackets from URL host form ([::1] → ::1).
  const host = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      throw new UrlDoorError(403, "blocked_address", "URL resolves to a private address.");
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new UrlDoorError(400, "dns_failure", "Could not resolve the URL's hostname.");
  }
  if (addresses.length === 0) {
    throw new UrlDoorError(400, "dns_failure", "The URL's hostname did not resolve.");
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new UrlDoorError(403, "blocked_address", "URL resolves to a private address.");
    }
  }
}

/** Accept only `text/*` responses (§15). The MIME type before any `;` params. */
function isTextContentType(contentType: string): boolean {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return mime.startsWith("text/");
}

/** Read a response body, aborting if it exceeds `cap` bytes. */
async function readBodyCapped(res: Response, cap: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel();
        throw new UrlDoorError(413, "response_too_large", "Response exceeds the 1 MB ingest limit.");
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
}

export interface UrlDoorResult {
  /** Exact response bytes as a UTF-8 string (CRLF preserved; nothing normalized). */
  raw: string;
  /** The final URL after following any redirects. */
  resolvedUrl: string;
}

/**
 * Fetch a document through the URL door. Manual redirect handling lets us
 * re-run the SSRF check on every hop — an open redirect to `http://127.0.0.1`
 * is caught before the request is made.
 */
export async function fetchUrlDoor(inputUrl: string): Promise<UrlDoorResult> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(inputUrl);
  } catch {
    throw new UrlDoorError(400, "invalid_url", "That is not a valid URL.");
  }

  for (let hop = 0; ; hop++) {
    if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
      throw new UrlDoorError(400, "unsupported_protocol", "Only http and https URLs are allowed.");
    }
    await assertPublicHost(currentUrl.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: { accept: "text/*, text/markdown, text/plain", "user-agent": "waypoint" },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof UrlDoorError) throw err;
      throw new UrlDoorError(502, "fetch_failed", "Could not fetch the URL.");
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        throw new UrlDoorError(502, "fetch_failed", "Redirect response had no Location header.");
      }
      if (hop >= MAX_REDIRECTS) {
        throw new UrlDoorError(400, "too_many_redirects", "The URL redirected too many times.");
      }
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    if (!res.ok) {
      throw new UrlDoorError(502, "fetch_failed", `The URL returned HTTP ${res.status}.`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!isTextContentType(contentType)) {
      throw new UrlDoorError(
        415,
        "unsupported_content_type",
        `Only text content types are allowed (got "${contentType || "none"}").`,
      );
    }

    const declaredLength = res.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > MAX_DOC_BYTES) {
      throw new UrlDoorError(413, "response_too_large", "Response exceeds the 1 MB ingest limit.");
    }

    const buf = await readBodyCapped(res, MAX_DOC_BYTES);
    return { raw: buf.toString("utf8"), resolvedUrl: currentUrl.toString() };
  }
}
