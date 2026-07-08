---
waypoint: 1
title: "Webhook Delivery Service — Rollout Plan"
project: demo
---

# Webhook Delivery Service — Rollout Plan

> Prepared by the build agent for human review. Answer the questions below,
> comment on anything that looks off, and export — I'll act on the annotations.

## Summary

We're extracting webhook delivery out of the monolith into a small worker
service. Deliveries are pulled off a queue, signed, POSTed to customer
endpoints, and retried on failure. We will retry failed webhooks five times
with exponential backoff before parking them in the dead-letter queue.

Endpoints that fail consistently get quarantined: after 50 consecutive
failures we stop attempting delivery and email the customer. Quarantined
endpoints can be revived from the dashboard, which drains their backlog from
the dead-letter queue in original order.

| Component | Choice | Status |
|---|---|---|
| Queue | pgmq on existing Postgres | decided |
| Signing | HMAC-SHA256, per-endpoint secret | decided |
| Worker runtime | *see Q2* | **open** |
| Payload retention | *see Q3* | **open** |

## Decisions needed

<!-- wp:question id="q1" type="text" -->
**Q1 — Delivery guarantees.** The plan gives customers at-least-once delivery
with a signed `X-Delivery-Attempt` header for dedup on their side. Is that
acceptable for v1, or do we need effectively-once (which means an outbox table
and a lot more machinery)?
<!-- wp:answer -->
At-least-once is fine for v1 — every serious webhook consumer already dedups.
Document the header prominently.
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q2" type="choice" select="single" -->
**Q2 — Worker runtime.** Where do the delivery workers run? My pick is
pre-checked based on what's already deployed.
- [ ] `node-cron` loop inside the existing API pods (zero new infra, noisy neighbor risk)
- [x] **Dedicated worker deployment** on the current Nomad cluster
- [ ] [Temporal](https://temporal.io) (durable execution, but a whole new system to operate)
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q3" type="choice" select="multi" -->
**Q3 — Payload retention.** What do we keep after a delivery succeeds?
Select everything we should retain (storage cost noted per item).
- [x] Delivery metadata: timestamps, attempt count, response code (~50 B/delivery)
- [x] Response bodies from customer endpoints, truncated to 1 KB (~300 B avg)
- [ ] Full request payloads (~4 KB avg — this is the expensive one)
- [ ] TLS session diagnostics (only useful when debugging cert issues)
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q4" type="text" -->
**Q4 — Quarantine threshold.** Is 50 consecutive failures the right bar for
quarantine, and should the revive action require re-verifying the endpoint
(challenge request) before draining the backlog?
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

## Agent notes

<!-- wp:comment id="c1" exact="five times" prefix="retry failed webhooks " suffix=" with exponential backoff" -->
Five retries pushes the last attempt ~17 minutes out with our backoff curve.
Industry default is closer to three; flagging in case you want faster
dead-lettering.
<!-- wp:suggestion -->
three times
<!-- /wp:suggestion -->
<!-- /wp:comment -->

## Appendix: convention syntax (for reference)

The block below is a **code fence** — Waypoint must render it as code, not
parse it as a question:

```markdown
<!-- wp:question id="fake" type="text" -->
This should never become an interactive card.
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
```

One more mention of the dead-letter queue here, so there are two occurrences
in this document — useful for testing that a selection comment on *this* one
anchors here and not in the summary above.
