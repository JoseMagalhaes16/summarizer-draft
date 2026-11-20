# 0008. Local development and mock mode: pluggable providers with a Lambda-shaped local server

- **Title:** Local development and mock mode: pluggable providers with a Lambda-shaped local server
- **Status:** Accepted
- **Date:** 2026-11-20

## Context

The product must be runnable end to end without AWS credentials, Bedrock access, or cost. Contributors need to iterate on the UI and the API quickly, and CI must run tests without network calls. At the same time, the code that runs in Lambda should be the code that runs locally, so routing, validation, and error mapping are exercised in both places.

The provider choices that differ between environments are the LLM (`mock` or `bedrock`), storage (`memory` or `dynamodb`), and job dispatch (`inline` thread or `lambda` async invoke). These are selected by environment variables in `config.py`.

## Decision Drivers

* No AWS account, Docker, or Bedrock access required to run the full UI.
* Local runs must exercise the real API handler, not a parallel implementation.
* Generation must look realistic enough for UI work (latency, statuses, and shapes).
* Mock output must pass the same validation as real model output.
* Fast startup and simple tooling.

## Considered Options

### Option A: AWS SAM local

`sam local start-api` runs the Lambda in Docker.

* Good, because it runs the real Lambda runtime.
* Bad, because it requires Docker and is slow to start and reload.
* Bad, because the Worker's async invocation still needs emulation.

### Option B: LocalStack

* Good, because it emulates DynamoDB, Lambda, and API Gateway.
* Bad, because it is a large external dependency that must run in a container and adds setup friction.
* Bad, because Bedrock emulation is not sufficient for generation testing.

### Option C: FastAPI development app wrapping services

A separate FastAPI app calls the services directly.

* Good, because it is quick to write and debug.
* Bad, because it bypasses the Lambda handler, so routing and event parsing are not tested locally and two entry points drift.

### Option D: Stdlib HTTP server translating to API Gateway v2 events, with pluggable providers (chosen)

`local/server.py` is a standard-library HTTP server that converts each request into an API Gateway HTTP API v2 event and invokes `handlers.api.lambda_handler`. Providers are selected by `LLM_PROVIDER`, `STORAGE_BACKEND`, and `JOB_DISPATCHER`. The mock generator (`llm/mock.py`) is deterministic: it scores transcript sentences by keyword overlap with section titles and instructions, applies a small synonym map, extracts vitals by regex, respects `missing_behavior`, and sleeps for `MOCK_LATENCY_SECONDS`.

* Good, because the real handler, routing, and validation run locally.
* Good, because there are no external dependencies beyond the standard library and the project itself.
* Good, because the same `NoteGenerator` and repository protocols serve both environments.
* Bad, because the server is not a faithful Lambda runtime (no cold starts, no IAM, no timeouts).
* Bad, because the mock is heuristic and does not reflect real clinical language quality.

## Decision Outcome

Chosen option: **Option D**. Defaults are `LLM_PROVIDER=mock`, `STORAGE_BACKEND=memory`, and `JOB_DISPATCHER=inline`, so `make dev` works with no configuration.

Two additional mechanisms:

* The frontend has an MSW-based demo mode that runs entirely in the browser, for UI work without the backend.
* Persistence in memory can optionally write to `LOCAL_DATA_FILE` as JSON for session continuity.

Parity rule: mock output must pass the same Pydantic validation and post-processing as Bedrock output. A contract test asserts this for every built-in template.

## Consequences

### Positive

* A new contributor can run the full stack in minutes.
* Routing and validation bugs are caught locally before deployment.
* CI runs the complete API test suite without network access.

### Negative

* Behaviour specific to Lambda (timeouts, cold starts, async retries) is not reproduced locally.
* Mock quality does not predict real model quality; prompt changes must be validated against Bedrock in a smoke test.

### Follow-ups

* Run `scripts/smoke_bedrock.py` after any prompt or schema change.
* Add an integration test that runs the Worker handler with `JOB_DISPATCHER=lambda` against a stubbed Lambda client.
* Keep the provider matrix documented in `config.py` and in the README in sync with the spec.

## Related

* [ADR-0002: Compute](0002-compute-lambda-lambdalith.md)
* [ADR-0005: Asynchronous generation](0005-async-generation-polling.md)
* [ADR-0006: Persistence](0006-persistence-dynamodb-single-table.md)
