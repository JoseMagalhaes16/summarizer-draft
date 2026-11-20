# 0005. Asynchronous note generation: 202 Accepted with Worker invocation and client polling

- **Title:** Asynchronous note generation: 202 Accepted with Worker invocation and client polling
- **Status:** Accepted
- **Date:** 2026-11-20

## Context

Generating a note is an LLM call whose duration grows with transcript length and effort setting. A long consultation at medium effort can take well over 30 seconds. API Gateway HTTP APIs enforce an integration timeout of roughly 30 seconds, so a synchronous `POST /v1/notes` cannot reliably return the result. Python Lambda functions also do not support native response streaming, which rules out streaming the generation back over the HTTP response.

The API must still accept the request quickly, persist it, and let the client observe progress and completion.

## Decision Drivers

* Requests must never hit the API Gateway integration timeout.
* The user must see status transitions (`pending`, `processing`, `completed`, `failed`).
* Failed generations must be retried safely and captured for diagnosis.
* The mechanism should need no always-on infrastructure.
* Future growth to queued processing should be a bounded change.

## Considered Options

### Option A: Synchronous generation

* Good, because it is the simplest code path.
* Bad, because generation routinely exceeds the integration timeout, causing failures on long transcripts.

### Option B: Asynchronous Lambda invocation with client polling (chosen)

`POST /v1/notes` stores the note as `pending`, asynchronously invokes the Worker Lambda (`InvocationType=Event`) with one automatic retry and an SQS dead-letter queue on failure, and returns `202` with the note. The client polls `GET /v1/notes/{id}` every 1.5 seconds until a terminal status.

* Good, because the API responds in well under a second regardless of generation time.
* Good, because Lambda's built-in async retry and on-failure destination provide basic resilience with no extra services.
* Good, because polling works through any proxy and needs no connection management.
* Bad, because polling adds read traffic and a small display latency.
* Bad, because Lambda async invocation has no per-function concurrency queue; throughput control must come later.

### Option C: SQS queue plus Worker

* Good, because it provides explicit buffering, batching, and backpressure.
* Bad, because it adds a queue and an event-source mapping that are not yet needed at clinic-scale traffic.

### Option D: Step Functions

* Good, because it gives visual workflow state and retries.
* Bad, because a single-step generation does not justify a state machine and its cost and complexity.

### Option E: WebSocket API push

* Good, because the client receives completion without polling.
* Bad, because it introduces connection management and a second API surface for one event type.

### Option F: Lambda function URL response streaming

* Good, because it streams progress over HTTP.
* Bad, because native response streaming is available for Node.js runtimes only, not for Python.

## Decision Outcome

Chosen option: **Option B, asynchronous invocation of the Worker Lambda with client polling every 1.5 seconds**. The note record is the source of truth: the API writes `pending`, the Worker moves it to `processing` and then `completed` or `failed`, and the client reads it. The local dispatcher implements the same contract with a background thread (`JOB_DISPATCHER=inline`), so the frontend behaves identically in both environments.

## Consequences

### Positive

* Request handling is decoupled from LLM latency, removing the timeout failure mode.
* Failures are recorded on the note with an error code and message, never a stack trace.
* The interface is identical locally and in AWS.

### Negative

* The frontend must handle pending and processing states, and stop polling on navigation or completion.
* Polling generates read load proportional to open note pages; this is small at expected volumes.
* Retry semantics mean the Worker must be idempotent with respect to note status transitions.

### Follow-ups

* Move to an SQS queue ([Option C](#option-c-sqs-queue-plus-worker)) when batching, per-clinic concurrency limits, or backpressure become necessary.
* Consider WebSocket or AppSync push in a later release if polling load or perceived latency becomes a problem.
* Alarm on the DLQ depth and on notes stuck in `pending` or `processing` beyond the Worker timeout.

## Related

* [ADR-0002: Compute](0002-compute-lambda-lambdalith.md)
* [ADR-0006: Persistence](0006-persistence-dynamodb-single-table.md)
