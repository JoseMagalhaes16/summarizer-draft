# 0002. Compute: AWS Lambda and API Gateway HTTP API with a lambdalith API and a separate Worker

- **Title:** Compute: AWS Lambda and API Gateway HTTP API with a lambdalith API and a separate Worker
- **Status:** Accepted
- **Date:** 2026-11-20

## Context

VetScribe's backend is a Python 3.13 service that exposes a JSON REST API under `/v1` and performs note generation by calling an LLM. Traffic is low and spiky: it follows clinic opening hours, with long idle periods overnight and at weekends. Generation is I/O-bound and can take tens of seconds for long transcripts. The team wants Python and does not want to operate servers or clusters.

The compute choice determines deployment shape, cold-start behaviour, cost at low utilisation, and how much routing code the team owns.

## Decision Drivers

* Pay-per-use economics for low, bursty traffic.
* Minimal operational overhead (no patching, capacity planning, or cluster management).
* A user requirement for Python and AWS Lambda.
* Acceptable cold-start footprint for an interactive UI.
* A single, testable routing layer for `/v1` endpoints.
* Generation latency must not be bound by the API Gateway integration timeout (see [ADR-0005](0005-async-generation-polling.md)).

## Considered Options

### Option A: Lambda per route

Each endpoint (or group) is a separate Lambda behind API Gateway.

* Good, because each function is small and independently scaled and permissioned.
* Good, because IAM can be scoped per route.
* Bad, because it multiplies deployment units, packaging, and shared-code duplication for about a dozen endpoints.
* Bad, because cold starts multiply across functions and local development is harder.

### Option B: Single "lambdalith" API Lambda with Powertools routing (chosen for the API)

One Lambda handles all API routes, using AWS Lambda Powertools `APIGatewayHttpResolver` for routing, validation hooks, and error mapping. Generation runs in a separate Worker Lambda.

* Good, because routing, validation, and error mapping live in one tested module shared with the local server.
* Good, because one deployment unit and one warm-container pool serve all routes.
* Good, because the routing layer is framework-light and matches the local stdlib server in [ADR-0008](0008-local-development-mock-mode.md).
* Bad, because a single function has a broader IAM surface, mitigated by keeping Bedrock and DynamoDB permissions scoped per function where possible.
* Bad, because a bug or heavy import can affect every route, mitigated by lazy imports and the Worker split.

### Option C: ECS Fargate with FastAPI

A containerised FastAPI service on Fargate behind an ALB or API Gateway.

* Good, because it is a conventional, portable web stack with mature tooling.
* Bad, because there is a baseline cost and a running task even with no traffic, which suits this load poorly.
* Bad, because it adds container build, networking, and scaling configuration.

### Option D: App Runner

* Good, because it is simpler than ECS for containers.
* Bad, because it still bills for provisioned capacity and offers less control over the async invocation path the design needs.

## Decision Outcome

Chosen option: **API Gateway HTTP API in front of one API Lambda (lambdalith, Powertools `APIGatewayHttpResolver`), plus a separate Worker Lambda** that performs LLM generation and is invoked asynchronously.

The split is deliberate: the API Lambda must return quickly (202 for generation), while the Worker can run for up to the Lambda maximum. Lambda's pay-per-invocation pricing matches clinic-hours traffic, and the lambdalith keeps route handling in one place that the local server can drive directly.

## Consequences

### Positive

* No idle compute cost; spend tracks usage.
* One routing and validation code path, exercised both in tests and in local development.
* Two deployment units total (API and Worker), both defined in the SAM template ([ADR-0010](0010-infrastructure-aws-sam.md)).

### Negative

* Cold starts occur after idle periods; the API Lambda must keep its import footprint small.
* Per-route IAM is coarser than in the Lambda-per-route option.

### Follow-ups

* Measure p95 cold-start on the API Lambda after first deployment; consider Provisioned Concurrency only if measured UX requires it.
* Keep Powertools Logger, Metrics, and Tracer initialisation in the handler module, not at import of shared code.

## Related

* [ADR-0005: Asynchronous generation](0005-async-generation-polling.md)
* [ADR-0008: Local development and mock mode](0008-local-development-mock-mode.md)
* [ADR-0010: Infrastructure as Code with AWS SAM](0010-infrastructure-aws-sam.md)
