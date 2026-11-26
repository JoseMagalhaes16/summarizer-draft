# Architecture Decision Records

Decisions that shape VetScribe's architecture are recorded here, one file per decision, in MADR-style Markdown. See [ADR-0001](0001-record-architecture-decisions.md) for the conventions.

Records are never deleted or rewritten. A decision that is reversed gets a new record that supersedes the old one, and the old record's status is updated to `Superseded by NNNN`.

| Number | Title | Status | Date |
|---|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions using MADR | Accepted | 2026-11-20 |
| [0002](0002-compute-lambda-lambdalith.md) | Compute: AWS Lambda and API Gateway HTTP API with a lambdalith API and a separate Worker | Accepted | 2026-11-20 |
| [0003](0003-llm-access-bedrock-invoke-model.md) | LLM access: Claude on Amazon Bedrock via the Bedrock Runtime InvokeModel API | Accepted | 2026-11-20 |
| [0004](0004-structured-output-json-schema.md) | Structured output: per-template JSON Schema via output_config.format | Accepted | 2026-11-20 |
| [0005](0005-async-generation-polling.md) | Asynchronous note generation: 202 Accepted with Worker invocation and client polling | Accepted | 2026-11-20 |
| [0006](0006-persistence-dynamodb-single-table.md) | Persistence: DynamoDB single table with clinic-scoped keys and template snapshots | Accepted | 2026-11-20 |
| [0007](0007-template-model-structured-sections.md) | Template model: structured sections with explicit missing-data semantics | Accepted | 2026-11-20 |
| [0008](0008-local-development-mock-mode.md) | Local development and mock mode: pluggable providers with a Lambda-shaped local server | Accepted | 2026-11-20 |
| [0009](0009-frontend-react-vite-plain-css.md) | Frontend: React 19, TypeScript, Vite, and plain CSS design tokens | Accepted | 2026-11-20 |
| [0010](0010-infrastructure-aws-sam.md) | Infrastructure as Code: AWS SAM | Accepted | 2026-11-20 |
| [0011](0011-security-privacy-baseline.md) | Security and privacy baseline for clinical transcripts | Accepted | 2026-11-20 |
| [0012](0012-generation-consistency-and-recovery.md) | Generation consistency (fencing token), failure recovery and item-size limits | Accepted | 2026-11-20 |
| [0013](0013-evaluation-approach.md) | Evaluation approach: atomic deterministic graders plus an optional judge | Accepted | 2026-11-20 |
| [0014](0014-manual-notes.md) | Manual notes and AI-off mode | Accepted | 2026-11-26 |
