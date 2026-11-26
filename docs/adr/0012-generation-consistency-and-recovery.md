# 0012. Generation consistency, failure recovery and item-size limits

- **Status:** Accepted
- **Date:** 2026-11-20
- **Supersedes in part:** [ADR-0005](0005-async-generation-polling.md) (failure handling), [ADR-0006](0006-persistence-dynamodb-single-table.md) (item layout)

## Context

An independent review of v1 found three failure modes in asynchronous generation
([ADR-0005](0005-async-generation-polling.md)), each reproduced:

1. **Wrong content on a note.** A regenerate while an earlier generation was
   still running let the slower, older run overwrite the newer result. A
   SOAP-shaped result was stored on a note whose snapshot was the dental
   template. Every write replaced the whole document with no guard.
2. **Notes stuck in `processing` forever.** The Bedrock retry and timeout budget
   (4 attempts of 280 s) exceeded the 300 s worker timeout. Exhausted async
   invokes went to the DLQ, but nothing marked the note failed. The final save
   was also outside the error handling.
3. **DynamoDB's 400 KB item limit.** A legal 200k-character transcript, plus the
   template snapshot, plus the result, could exceed it. Non-ASCII text made it
   worse, since the limit counts bytes and validation counted characters.

For a clinical record, (1) is the worst of these: content attached to the wrong
note or template is a patient-safety risk, not just a bug.

## Decision Drivers

* Never persist a result produced for an earlier generation.
* Every note reaches a terminal state (`completed` or `failed`) within a bounded time.
* Keep the single-table design and serverless operations.
* Fail with a clear, actionable error rather than a 500.

## Considered Options

* **A. Optimistic concurrency with a `generation_id` fencing token, plus layered
  recovery** (chosen).
* **B. Serialise per note with a lock item** (lease with TTL). This adds lock
  management and still needs recovery for expired leases.
* **C. Step Functions** for generation (built-in timeouts, retries and catch
  states). This is the strongest guarantee, but adds a service, cost per state
  transition and more IaC for a simple single-step job. It is kept as the path
  if the pipeline grows multiple steps (e.g. PII redaction, multiple outputs).

## Decision Outcome

Chosen **option A**.

* **Fencing token.** Each create or regenerate assigns a fresh `generation_id`,
  which is carried in the async payload. Every worker write is a conditional
  write (`ConditionExpression generation_id = :expected`). A stale worker gets
  `ConditionalCheckFailedException` and exits as a no-op. PATCH writes are fenced
  the same way.
* **No overlapping runs.** Regenerate returns `409 GENERATION_IN_PROGRESS` while
  a note is `pending` or `processing`.
* **Bounded time budget.** The boto read timeout is 240 s with 2 total attempts.
  The worker timeout is 900 s. The worker passes a deadline (Lambda remaining
  time minus 30 s), and the second tool-mode attempt only runs if the budget
  allows it.
* **Layered recovery:**
  1. Everything in the worker, including the final save, sits inside a handler
     that marks the note `failed`.
  2. A DLQ consumer Lambda marks notes from exhausted async invokes
     `failed / GENERATION_TIMEOUT`.
  3. A read-path safety net reports and persists `GENERATION_TIMEOUT` for notes
     whose `updated_at` is older than `STALE_GENERATION_SECONDS` (20 min).
* **Item layout.** The transcript moves to its own item (`SK = NOTETX#{ulid}`).
  Summary fields are duplicated as top-level attributes so list queries can use
  `ProjectionExpression`. Byte-size checks before each save return
  `413 PAYLOAD_TOO_LARGE`. Validation enforces both character and UTF-8 byte
  limits.

## Consequences

* **Positive:** a stale run can never overwrite newer content. Every note reaches
  a terminal state. Large transcripts fail early with a clear message. List
  reads are cheap.
* **Negative:** two items per note (transcript and note), so deletes touch both;
  more failure-path code; the DLQ consumer needs its own IAM and alarm.
* **Follow-ups:** if the payload grows past about 350 KB (multi-output notes,
  attachments), move transcript and result bodies to S3 with a pointer in
  DynamoDB. Revisit Step Functions (option C) when generation becomes multi-step.
