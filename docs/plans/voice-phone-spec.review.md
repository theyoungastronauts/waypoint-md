---
waypoint: 1
title: "Waypoint Voice — phone number"
project: waypoint
waypoint_status: completed
reviewed_at: 2026-10-15T11:40:32.321Z
---

# Waypoint Voice — phone number

*2026-10-15.* The browser Talk button works. Next: a phone number you call to answer a review, so it works in CarPlay with the phone locked. Each document gets a PIN; you dial, enter the PIN, and the same interview starts.

## How it would work

1. You call the number. The phone company passes the call to OpenAI, and OpenAI tells Waypoint a call has arrived.
2. Waypoint checks the calling number against an allowlist (yours). Unknown numbers are rejected before anything is said.
3. A short "lobby" asks for the document's PIN. You key it in or say it.
4. Waypoint switches the same call over to that document's interview: the voice brief, brief or thorough, the questions, the read-back, then submit. Answers go through the same draft-save path, and the transcript lands under "Voice calls" as today.

Nothing about the interview changes. What's new is under the hood: there is no browser page during a phone call, so the tools run on the server over a live connection to the call. The audio itself goes from the phone network straight to OpenAI and never touches the Mac mini.

## What I checked (live docs, 2026-10-14 and 15)

- OpenAI Realtime answers phone calls over SIP, the standard for internet phone calls, on the same `gpt-realtime-2.1` model. Keypad digits reach the server (`input_audio_buffer.dtmf_event_received`), and instructions and tools can be swapped mid-call, which is what makes the lobby-then-document flow possible.
- OpenAI does not sell phone numbers. A phone provider rents the number and forwards calls to OpenAI. That's the only non-OpenAI piece, and it involves no code on their side.
- Realtime only receives calls. It can't call you, so "Waypoint calls you back" is not an option on this API.
- Cost at about 10 ten-minute calls a month: roughly $1.50 for the number and minutes, plus $4–10 of OpenAI usage. About $6–12 a month all in.

## What you'd do (I can't create accounts or buy things)

1. Sign up with the provider you pick below, buy one number, and point it at OpenAI. That's about four console steps; I'll write them out exactly.
2. In the OpenAI dashboard, add a webhook for incoming calls. Its signing secret goes in `~/.waypoint/env` like the keys; don't paste it to me.
3. Add one path to the Cloudflare Tunnel so OpenAI can reach Waypoint's call webhook. Today the tunnel only exposes the public review pages. I'll write the exact config.

## Decisions

<!-- wp:question id="q1" type="choice" select="single" -->
**Q1 — Which phone provider?**
- [x] Twilio (Elastic SIP Trunking)
- [ ] Telnyx
<!-- wp:rationale -->
Twilio has the only published step-by-step guide for forwarding to OpenAI Realtime, documented encryption (TLS and SRTP), and caller-verification headers. It's used only as a number that forwards; we write no Twilio code. Telnyx is a little cheaper and needs no paperwork for US or Canadian numbers, but its OpenAI guide targets GPT-Live, OpenAI's other voice API, so we'd be the first to wire it this way. Number cost is about $1/month on either.
<!-- /wp:rationale -->
<!-- wp:answer status="answered" -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q2" type="choice" select="single" -->
**Q2 — Where should the number be?**
- [x] A local Canadian number
- [ ] A local US number
- [ ] Toll-free
<!-- wp:answer status="answered" -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q3" type="choice" select="single" -->
**Q3 — How do you enter the PIN?**
- [ ] Keypad only
- [ ] Say it only
- [x] Either: key it in or say it
<!-- wp:rationale -->
Keypad is exact and works with a saved contact that dials the PIN for you (number, pause, PIN, #), which is the hands-free CarPlay case. Saying it covers the case where you didn't save a contact and can't look at the keypad. Spoken digits get checked against real PINs, so a mishearing just gets "I didn't find that one, try again."
<!-- /wp:rationale -->
<!-- wp:answer status="answered" -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q4" type="choice" select="single" -->
**Q4 — How long is a document's PIN?**
- [x] 4 digits
- [ ] 6 digits
<!-- wp:rationale -->
With the caller-ID allowlist in front (Q5), the PIN mostly picks the document rather than guarding it, so short and easy to say wins. Wrong PINs are rate-limited and the call hangs up after three misses.
<!-- /wp:rationale -->
<!-- wp:answer status="answered" -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q5" type="choice" select="single" -->
**Q5 — Who is allowed to call?**
- [x] Only allowlisted numbers (yours), plus the document PIN
- [ ] Anyone who knows a document PIN
- [ ] Allowlisted numbers, plus a personal PIN, plus the document PIN
<!-- wp:rationale -->
Caller ID can be faked, so it isn't enough alone, and a 4-digit PIN isn't enough alone either. Together they're solid for one person's review docs. The third option adds a second PIN to every call, which costs time in the car for little extra safety. Twilio also marks whether the caller's number was verified by the carrier; I'll log it on the first real call and require it if it comes through.
<!-- /wp:rationale -->
<!-- wp:answer status="answered" -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q6" type="choice" select="multi" -->
**Q6 — Where should a document's PIN show up?** Pick any.
- [x] On the review page, next to the Talk button
- [x] In `waypoint push` output, beside the review URL
- [ ] In the push notification or Booth, later
<!-- wp:answer status="answered" -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q7" type="choice" select="single" -->
**Q7 — When does a document get its PIN, and when does it stop working?**
- [x] Every document with questions gets one when it's pushed; it stops working once the review is completed, pulled or superseded
- [ ] Only when you ask for one (a "Get phone PIN" button); same expiry
- [ ] Every document gets one and it never expires
<!-- wp:rationale -->
Automatic means the PIN is already there when you see the review link. Expiring finished reviews keeps the live PINs few, so collisions don't happen and an old PIN can't reopen a done review.
<!-- /wp:rationale -->
<!-- wp:answer status="answered" -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q8" type="choice" select="single" -->
**Q8 — Without a PIN: a shortcut in the first version, or wait for the full menu?**
- [x] Include a small shortcut now: press 0 or say "latest" to get the most recent pending review
- [ ] PIN only for now; the menu of recent reviews comes later
<!-- wp:rationale -->
The full menu (it reads out your recent reviews and you pick one) is a later step, as you said. "Latest" covers the common case cheaply, since the newest push is usually the one you're calling about. It confirms the title before starting.
<!-- /wp:rationale -->
<!-- wp:answer status="answered" -->
<!-- /wp:answer -->
<!-- /wp:question -->

## Dahlia Connect and reuse

You mentioned taking the same approach for the Dahlia Connect discovery call. There's no vault note on it, so I don't know its shape yet, and one thing matters a lot: who dials whom. Realtime can only receive calls. If Dahlia needs to call someone, that means OpenAI's GPT-Live API, which is a different integration.

<!-- wp:question id="q9" type="text" -->
**Q9 — What is the Dahlia Connect discovery call?** Who's on the line (you, a client, a prospect), who calls whom, what the interview is collecting, and where the answers should end up.
<!-- wp:answer status="answered" -->
You don’t have to worry too much about this. It’s just something else I’m working on that’s going to use OpenAI’s real-time API.
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q10" type="choice" select="single" -->
**Q10 — How much should the phone layer be built for reuse right now?**
- [ ] Build it inside Waypoint, but as a self-contained module (call handling, lobby, server-side tool runner) with no Waypoint-specific code in it, so it can be lifted out when Dahlia needs it
- [ ] A separate shared package from the start
- [x] Waypoint-only; extract later if Dahlia goes ahead
<!-- wp:rationale -->
A clean boundary costs little now and makes lifting it easy. A separate package before the second user exists usually guesses the wrong shape. The interview logic is already pure and reusable.
<!-- /wp:rationale -->
<!-- wp:answer status="answered" -->
then we can pull it out later or replicate it for something else, because I have a few other ideas
<!-- /wp:answer -->
<!-- /wp:question -->

## Caveat

A deploy restarts Waypoint and drops the server's connection to any live call. The audio would continue but answers would stop being saved.

<!-- wp:question id="q11" type="choice" select="single" -->
**Q11 — Guard against deploying during a call?**
- [ ] Yes: a restart waits up to a few minutes for live calls to end, and says so
- [x] No, I'll just avoid deploying while I'm on a call
<!-- wp:answer status="answered" -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q12" type="text" -->
**Q12 — Anything else?** Changes to the flow above, or what you'd want the lobby to say.
<!-- wp:answer status="answered" -->
The only thing I’m thinking about is, although I don’t necessarily think we have to change anything with our plan right now, I probably want to also build something similar for daily adjusting of my to-do list and that kind of stuff. So whatever we learn here might see more use.
<!-- /wp:answer -->
<!-- /wp:question -->
