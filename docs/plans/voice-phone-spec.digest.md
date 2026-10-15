---
waypoint_digest: 1
title: "Waypoint Voice — phone number"
project: "waypoint"
source: "docs/plans/voice-phone-spec.md"
status: "completed"
reviewed_at: "2026-10-15T11:40:32.365Z"
answered: 12
flagged: 0
skipped: 0
untouched: 0
total: 12
comments: 0
synthetic: 0
---

# Digest — Waypoint Voice — phone number

## Questions

### q1 · choice (single) · answered
**Q:** **Q1 — Which phone provider?**
**Selected:** Twilio (Elastic SIP Trunking)
**Why:** Twilio has the only published step-by-step guide for forwarding to OpenAI Realtime, documented encryption (TLS and SRTP), and caller-verification headers. It's used only as a number that forwards; we write no Twilio code. Telnyx is a little cheaper and needs no paperwork for US or Canadian numbers, but its OpenAI guide targets GPT-Live, OpenAI's other voice API, so we'd be the first to wire it this way. Number cost is about $1/month on either.

### q2 · choice (single) · answered
**Q:** **Q2 — Where should the number be?**
**Selected:** A local Canadian number

### q3 · choice (single) · answered
**Q:** **Q3 — How do you enter the PIN?**
**Selected:** Either: key it in or say it
**Why:** Keypad is exact and works with a saved contact that dials the PIN for you (number, pause, PIN, #), which is the hands-free CarPlay case. Saying it covers the case where you didn't save a contact and can't look at the keypad. Spoken digits get checked against real PINs, so a mishearing just gets "I didn't find that one, try again."

### q4 · choice (single) · answered
**Q:** **Q4 — How long is a document's PIN?**
**Selected:** 4 digits
**Why:** With the caller-ID allowlist in front (Q5), the PIN mostly picks the document rather than guarding it, so short and easy to say wins. Wrong PINs are rate-limited and the call hangs up after three misses.

### q5 · choice (single) · answered
**Q:** **Q5 — Who is allowed to call?**
**Selected:** Only allowlisted numbers (yours), plus the document PIN
**Why:** Caller ID can be faked, so it isn't enough alone, and a 4-digit PIN isn't enough alone either. Together they're solid for one person's review docs. The third option adds a second PIN to every call, which costs time in the car for little extra safety. Twilio also marks whether the caller's number was verified by the carrier; I'll log it on the first real call and require it if it comes through.

### q6 · choice (multi) · answered
**Q:** **Q6 — Where should a document's PIN show up?** Pick any.
**Selected:** On the review page, next to the Talk button, In `waypoint push` output, beside the review URL

### q7 · choice (single) · answered
**Q:** **Q7 — When does a document get its PIN, and when does it stop working?**
**Selected:** Every document with questions gets one when it's pushed; it stops working once the review is completed, pulled or superseded
**Why:** Automatic means the PIN is already there when you see the review link. Expiring finished reviews keeps the live PINs few, so collisions don't happen and an old PIN can't reopen a done review.

### q8 · choice (single) · answered
**Q:** **Q8 — Without a PIN: a shortcut in the first version, or wait for the full menu?**
**Selected:** Include a small shortcut now: press 0 or say "latest" to get the most recent pending review
**Why:** The full menu (it reads out your recent reviews and you pick one) is a later step, as you said. "Latest" covers the common case cheaply, since the newest push is usually the one you're calling about. It confirms the title before starting.

### q9 · text · answered
**Q:** **Q9 — What is the Dahlia Connect discovery call?** Who's on the line (you, a client, a prospect), who calls whom, what the interview is collecting, and where the answers should end up.
**A:** You don’t have to worry too much about this. It’s just something else I’m working on that’s going to use OpenAI’s real-time API.

### q10 · choice (single) · answered
**Q:** **Q10 — How much should the phone layer be built for reuse right now?**
**Selected:** Waypoint-only; extract later if Dahlia goes ahead
**Why:** A clean boundary costs little now and makes lifting it easy. A separate package before the second user exists usually guesses the wrong shape. The interview logic is already pure and reusable.
**Note:** then we can pull it out later or replicate it for something else, because I have a few other ideas

### q11 · choice (single) · answered
**Q:** **Q11 — Guard against deploying during a call?**
**Selected:** No, I'll just avoid deploying while I'm on a call

### q12 · text · answered
**Q:** **Q12 — Anything else?** Changes to the flow above, or what you'd want the lobby to say.
**A:** The only thing I’m thinking about is, although I don’t necessarily think we have to change anything with our plan right now, I probably want to also build something similar for daily adjusting of my to-do list and that kind of stuff. So whatever we learn here might see more use.
