# 0003. LLM access: Claude on Amazon Bedrock via the Bedrock Runtime InvokeModel API

- **Title:** LLM access: Claude on Amazon Bedrock via the Bedrock Runtime InvokeModel API
- **Status:** Accepted
- **Date:** 2026-11-20

## Context

Note generation calls a Claude model with a clinical transcript. Veterinary transcripts contain identifiable client and patient information, so where the data is processed and under what contract matters as much as model quality. The backend is AWS-native and the team wants access controlled by IAM and billed through the existing AWS account.

Several routes to Claude exist: the first-party API, the Anthropic SDK's Bedrock clients, and the vendor-neutral Bedrock Converse API. The chosen route must support Anthropic-specific structured output and effort controls ([ADR-0004](0004-structured-output-json-schema.md)).

## Decision Drivers

* Patient-adjacent data should stay inside the AWS account boundary and region geography.
* Access must be governed by IAM roles and policies, with no long-lived vendor API keys.
* The stack should stay AWS-native, with few third-party runtime dependencies.
* Anthropic-specific request features (`output_config.format`, `output_config.effort`) must be usable.
* Changing model is configuration, not code, so cost and quality can be tuned later.

## Considered Options

### Option A: Anthropic first-party API

Call `api.anthropic.com` directly with the Anthropic SDK and an API key.

* Good, because it gets new Claude features first and with the widest feature set.
* Good, because the SDK is first-party and idiomatic.
* Bad, because transcript data leaves the AWS account boundary and needs a separate vendor contract and data-processing review.
* Bad, because API keys must be stored and rotated outside IAM.

### Option B: Anthropic SDK Bedrock clients

Use the `anthropic` SDK's Bedrock client classes to call Claude on Bedrock.

* Good, because it keeps the Anthropic Messages interface.
* Bad, because it adds a dependency and an abstraction layer over boto3 that the team does not need.
* Bad, because it conflicts with the requirement to stay AWS-native, with credentials and signing handled by boto3.

### Option C: Bedrock Converse API

Use boto3 `converse`, which gives one request shape across model vendors.

* Good, because the request format is portable across providers.
* Bad, because it lags Anthropic-specific features such as structured outputs (`output_config`) and effort, which the design relies on.

### Option D: Bedrock Runtime `invoke_model` with the Anthropic Messages body (chosen)

Call `boto3.client("bedrock-runtime").invoke_model` with an Anthropic Messages body, `anthropic_version: "bedrock-2023-05-31"`.

* Good, because data stays in the AWS account and region, covered by the AWS agreement.
* Good, because access is IAM-scoped (`bedrock:InvokeModel`) and needs no vendor key.
* Good, because it exposes the full Anthropic request body, including `output_config`.
* Bad, because new Claude features may appear on the first-party API before Bedrock, and the Bedrock body is more manual to build.
* Bad, because the request code is hand-written and must be kept aligned with Anthropic's documentation.

## Decision Outcome

Chosen option: **Option D, Bedrock Runtime `invoke_model` with the Anthropic Messages body**, implemented in `llm/bedrock.py` behind the `NoteGenerator` protocol.

The model is configuration, not code. `BEDROCK_MODEL_ID` selects a model or cross-region inference profile. The default is the latest Claude Opus-tier model. Sonnet or Haiku can be selected for cost. **Exact model IDs must be verified in the target account and region before deployment**, because model availability and inference-profile names differ by region and change over time. The current default is the US cross-region inference profile `us.anthropic.claude-opus-5-5` (see [docs/research/bedrock-notes.md](../research/bedrock-notes.md)); IAM must allow `bedrock:InvokeModel` on both the inference-profile ARN and the underlying foundation-model ARNs in every region the profile routes to.

Operational requirements:

* Model access must be enabled in the Bedrock console for the account.
* IAM policy scopes `bedrock:InvokeModel` to the model and inference-profile ARNs only.
* Sampling parameters (`temperature`, `top_p`, `top_k`) and `thinking.budget_tokens` are not sent.

## Consequences

### Positive

* Transcript data is processed inside AWS, under the existing account, IAM, and logging controls.
* No vendor API key exists to leak or rotate.
* Model selection is a deploy-time configuration change.

### Negative

* Bedrock feature availability can lag the first-party API; some features may be unavailable on a given model or region.
* Model IDs and inference-profile identifiers are operational facts that can drift; they require checking during each model change.
* Request construction is manual and must be covered by tests (`botocore.stub.Stubber`).

### Follow-ups

* Add `scripts/smoke_bedrock.py` to validate model access, the inference profile, and a minimal structured-output call in each target account.
* Evaluate Anthropic's Mantle-based Messages endpoint client for Bedrock, which is the recommended path for new code in the current Anthropic SDK documentation, once it is generally available in the target region. This would be a new ADR superseding this one for the transport layer, not a silent change.
* Re-verify the Bedrock Messages body and `anthropic_version` before each model migration.

## Related

* [ADR-0004: Structured output](0004-structured-output-json-schema.md)
* [ADR-0011: Security and privacy](0011-security-privacy-baseline.md)
