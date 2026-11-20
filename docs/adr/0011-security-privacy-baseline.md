# 0011. Security and privacy baseline for clinical transcripts

- **Title:** Security and privacy baseline for clinical transcripts
- **Status:** Accepted
- **Date:** 2026-11-20

## Context

VetScribe processes veterinary consultation transcripts. These contain client names, contact details, patient identifiers, and clinical history, and they are input to a generative model whose output becomes part of a medical record. Transcripts are untrusted input: a speaker, or text pasted from elsewhere, may contain instructions aimed at the model. The product is documentation assistance, not diagnosis, and a clinician must review every note before it is used.

Authentication is deferred to a later release, so v1 must hold a secure baseline without user identity while leaving a defined path to multi-clinic access control.

## Decision Drivers

* Minimise the spread of client and patient data across logs, storage, and third parties.
* Resist prompt injection from transcript content.
* Enforce least privilege across IAM, storage, and the model endpoint.
* Encrypt data at rest and in transit by default.
* Keep clinician review as the final control on every generated record.
* Provide a clear route to authentication and tenancy.

## Considered Options

### Option A: Minimal controls, add security later

* Good, because it defers effort.
* Bad, because logging and storage habits set early are hard to reverse, and clinical data would be exposed in the interim.

### Option B: Full enterprise controls up front (custom identity provider, field-level encryption, SIEM)

* Good, because it is maximally protective.
* Bad, because it delays delivery and exceeds the risk profile of a v1 with no user accounts.

### Option C: Layered baseline now, authentication later (chosen)

Apply data-minimisation, injection-hardening, least-privilege, and encryption controls in v1, and plan authentication with Cognito and an HTTP API JWT authorizer carrying a `clinic_id` claim that feeds the DynamoDB partition key ([ADR-0006](0006-persistence-dynamodb-single-table.md)).

* Good, because the highest-impact controls are in place from the first deployment.
* Good, because the tenancy key already exists, so authentication adds a claim check rather than a schema change.
* Bad, because v1 must be explicitly documented as not safe for multi-user production use until authentication lands.

## Decision Outcome

Chosen option: **Option C**. Specific controls:

* **Data minimisation in logs:** logs record identifiers, sizes, and timings only. Transcripts and note content are never logged, including in error paths. Errors are stored as typed codes with messages that omit stack traces and content.
* **Prompt-injection hardening:** the transcript is wrapped in `<transcript>` delimiters and declared untrusted in the system prompt, which instructs the model to ignore instructions inside it. Output is constrained by the JSON schema ([ADR-0004](0004-structured-output-json-schema.md)) and validated afterwards.
* **Input limits:** `MAX_TRANSCRIPT_CHARS` defaults to 200,000 characters, enforced at the API boundary.
* **Least privilege:** `bedrock:InvokeModel` on the configured model and inference-profile ARNs only; DynamoDB access to one table.
* **Encryption:** DynamoDB server-side encryption and point-in-time recovery; TLS for all client and AWS API traffic.
* **Model data handling:** Amazon Bedrock does not use prompts or outputs to train models, and processing stays in the configured region or inference-profile geography ([ADR-0003](0003-llm-access-bedrock-invoke-model.md)).
* **Clinician review:** every note carries `review_flags` and `used_defaults` markers, and the UI requires review before copying. The product is documentation assistance and does not provide diagnosis.
* **Authentication (planned):** Cognito user pool, HTTP API JWT authorizer, `clinic_id` claim replacing `DEFAULT_CLINIC_ID`, with CORS restricted from `*` for production.

## Consequences

### Positive

* Sensitive content is kept out of observability tooling by default.
* Injection risk is reduced at the prompt and output layers.
* The authentication path requires no data migration.

### Negative

* Logs are less useful for debugging content-specific generation problems, so debugging needs a separate, approved, and short-lived method.
* Until authentication exists, v1 must not be deployed for multiple clinics or exposed publicly.
* Injection hardening reduces but does not eliminate the risk of a manipulated note; clinician review is the backstop.

### Follow-ups

* Set `CORS_ALLOW_ORIGIN` to the frontend origin before any non-local deployment.
* Add a test that asserts no transcript text appears in captured log output.
* Complete a data-protection impact assessment and confirm the Bedrock data-processing terms with the clinic's compliance team before production use.
* Implement Cognito and the JWT authorizer before any multi-clinic deployment.

## Related

* [ADR-0003: LLM access via Bedrock](0003-llm-access-bedrock-invoke-model.md)
* [ADR-0004: Structured output](0004-structured-output-json-schema.md)
* [ADR-0006: Persistence](0006-persistence-dynamodb-single-table.md)
* [ADR-0007: Template model](0007-template-model-structured-sections.md) (review semantics)
