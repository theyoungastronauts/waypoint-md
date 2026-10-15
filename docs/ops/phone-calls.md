# Calling in by phone — setup runbook

How a phone number reaches Waypoint Voice. Run once, by hand. Decisions: [voice-phone-spec.digest.md](../plans/voice-phone-spec.digest.md).

**The path a call takes:** your phone → Twilio number → Twilio Elastic SIP trunk → OpenAI Realtime (`sip.api.openai.com`) → OpenAI sends a signed `realtime.call.incoming` webhook to `https://review.tylersavery.com/api/voice/phone/webhook` → Waypoint checks your number and answers. Call audio goes from Twilio straight to OpenAI and never touches the Mac mini.

## 1. OpenAI: find the project id

The SIP address is per OpenAI project, and it must be **the project that `OPENAI_API_KEY` belongs to**, or Waypoint can't answer the call.

- platform.openai.com → Settings → Project → General. Copy the **Project ID** (`proj_…`).

## 2. Twilio: number and trunk

1. Sign in to Twilio. Trunking may require upgrading from a trial account.
2. **Buy a number:** Phone Numbers → Buy a number → Country: Canada, capability: Voice, a local area code you like. Twilio may ask for a regulatory address for Canadian numbers; that's expected.
3. **Create the trunk:** Elastic SIP Trunking → Trunks → Create new SIP Trunk, name it `waypoint-voice`.
   - **Secure Trunking:** on (TLS signalling and SRTP audio; OpenAI requires both).
   - **Origination → Add new Origination URI:** `sip:proj_XXXXXXXX@sip.api.openai.com;transport=tls` (your project id from step 1). Priority 10, weight 10.
   - **Numbers:** add the number you bought.

No Twilio code, webhooks or TwiML are involved: the trunk only forwards calls.

## 3. OpenAI: the incoming-call webhook

platform.openai.com → Settings → Project → Webhooks → Create:

- **URL:** `https://review.tylersavery.com/api/voice/phone/webhook`
- **Event:** `realtime.call.incoming`

OpenAI shows the **signing secret** (`whsec_…`) once. Copy it for step 4. Never paste it into chat.

## 4. Waypoint's env

Add to `~/.waypoint/env` (it stays `chmod 600`):

```
OPENAI_WEBHOOK_SECRET=whsec_...
WAYPOINT_PHONE_ALLOWLIST=+1XXXXXXXXXX
WAYPOINT_PHONE_PIN=<4 to 8 digits of your choosing>
```

The allowlist is your own mobile number in `+1` form. Several numbers are comma-separated. Calls from any other number are declined before anything is said.

`WAYPOINT_PHONE_PIN` is your personal security PIN for the "latest review" shortcut (press 0). Caller ID can be forged by someone dialling OpenAI directly, so the shortcut, which skips the review PIN, asks for this instead. It is keypad-only: spoken audio is transcribed into the call record, keypad presses are not. Without it, the shortcut is off and only review PINs work.

## 5. Tunnel: one more public path

`~/.cloudflared/config.yml` gets one rule, above the final 404, so OpenAI can reach the webhook and nothing else new opens:

```yaml
  # Waypoint Voice: OpenAI's signed incoming-call webhook. Exact path only.
  - hostname: review.tylersavery.com
    path: ^/api/voice/phone/webhook$
    service: http://localhost:3000
```

Then restart the tunnel: `launchctl kickstart -k gui/501/com.tyler.waypoint-review-tunnel`.

The app enforces the same boundary on its own: the webhook is the only `/api/voice` path open without a token (`lib/auth.ts`), and every request to it must carry a valid OpenAI signature.

## 6. Deploy and restart

Merge `feat/voice-phone`, build, and restart Waypoint (`launchctl kickstart -k gui/501/com.tyler.waypoint`). Don't do this mid-call: a restart drops any call in progress. On boot, every open review gets a phone PIN.

## 7. First call

1. Open any pending review; its **Phone PIN** shows next to Talk.
2. Call the number. You should hear: "Waypoint. Enter or say your review PIN, or press zero for your latest review."
3. Key or say the PIN. It opens the review and the interview runs as in the browser.

Logs (`~/.waypoint/logs/`) show `[phone] incoming … from an allowlisted number verstat=…` for each call. The `verstat` value is the carrier's caller-ID verification; once it's seen on real calls, Waypoint can require it.

**Saved contact for CarPlay:** review PINs change with each review, so the handy contact is the "latest" one: the number, then `,,0,,`, your security PIN and `#` (e.g. `+1249…,,0,,246813#`). The phone presses 0 after the greeting, then keys your security PIN; Waypoint names your newest open review and you say yes. Keep that contact private: it holds the security PIN. For a specific review, dial the number, then `,,` and its PIN.
