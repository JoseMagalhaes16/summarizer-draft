# Amazon Bedrock notes for VetScribe (bedrock-runtime InvokeModel + boto3)

Research date: 2026-11-20. Constraint: the research environment could not fetch docs.aws.amazon.com or aws.amazon.com (proxy blocked), so AWS-doc facts come from search-result summaries of those pages and are marked with lower confidence. Anthropic docs (platform.claude.com) were fetched directly. **Verify AWS-sourced items with `aws bedrock get-inference-profile` and a smoke call before release.**

## 1. Model IDs and inference profiles

Anthropic documents two Bedrock endpoints. We use `bedrock-runtime` (InvokeModel/Converse). The `bedrock-mantle` endpoint is out of scope ([bedrock-runtime page](https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy), [mantle page](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock)).

**Confirmed (high confidence):** Anthropic states that Claude Fable 5.1, Fable 5, Opus 5.5, Opus 5, Sonnet 5.5, Sonnet 5, Haiku 5.5, Opus 4.8 and Opus 4.7 "are reachable through `InvokeModel` on `bedrock-runtime`" and that the model table on that page omits them. The same page lists Fable 5.2 and Mythos 5.2 (Mythos is limited availability), which only `bedrock-runtime` serves ([source](https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy)).

**Base IDs (high confidence; listed for the mantle endpoint)** ([models overview](https://platform.claude.com/docs/en/models/overview), [mantle page](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock)):

| Model | Base ID | Notes |
|---|---|---|
| Claude Opus 5.5 | `anthropic.claude-opus-5-5` | $4/$20 per MTok, default effort `medium` |
| Claude Sonnet 5.5 | `anthropic.claude-sonnet-5-5` | $2/$10 per MTok, default effort `high` |
| Claude Haiku 5.5 | `anthropic.claude-haiku-5-5` | from $0.10/$0.50 per MTok, default effort `medium` |
| Claude Fable 5.2 | `anthropic.claude-fable-5-2` (overview lists `global.anthropic.claude-fable-5-2`) | $8/$40 |
| Claude Opus 5 / 4.8 / 4.7 | `anthropic.claude-opus-5`, `-opus-4-8`, `-opus-4-7` | |
| Claude Sonnet 5 | `anthropic.claude-sonnet-5` | |
| Claude Haiku 4.5 (older style) | `anthropic.claude-haiku-4-5-20251001-v1:0` on bedrock-runtime | prefixes global/us/eu |

Important: the new-generation IDs have **no `-v1:0` suffix**. The spec placeholder `us.anthropic.claude-opus-5-5-v1:0` is wrong. Older models use the suffix, e.g. `anthropic.claude-opus-4-6-v1`, `anthropic.claude-sonnet-4-6`.

**Inference profiles for Opus 5.5 (medium confidence, third-party test of Converse API):** `us.`, `eu.`, `jp.`, `au.` and `global.` prefixes exist, e.g. `us.anthropic.claude-opus-5-5`, `global.anthropic.claude-opus-5-5`. The base ID is inference-profile-only, so calling it directly fails with "Invocation of model ID anthropic.claude-opus-5-5 with on-demand throughput isn't supported" ([aws-samples/bedrock-chat #1160](https://github.com/aws-samples/bedrock-chat/issues/1160)). A search summary of the AWS model card shows `global.anthropic.claude-opus-5-5` as the boto3 `modelId` and says the bare ID is in-region only in eu-west-2 ([AWS model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html), not fetched directly).

**Not confirmed:** exact `us.`/`eu.`/`global.` strings for Sonnet 5.5 and Haiku 5.5. By the same pattern they should be `us.anthropic.claude-sonnet-5-5`, `global.anthropic.claude-sonnet-5-5`, `us.anthropic.claude-haiku-5-5`, and so on. Anthropic says `global` is available for Opus 5.5, Sonnet 5.5, Haiku 5.5 and others ([mantle regions](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock#regions)). AWS's authoritative list is [Supported Regions and models for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html), which could not be fetched.

**Endpoint types and price:** global routing has no premium; regional (US/EU/JP/AU) profiles carry a 10% premium ([source](https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy#global-vs-regional-endpoints)). Use a `us.`/`eu.` profile if data must stay in a geography.

**Recommended default:** `us.anthropic.claude-opus-5-5` (keeps the spec's US profile intent and is the variant most corroborated). Alternatives: `global.anthropic.claude-opus-5-5` (no premium, flexible residency); `us.anthropic.claude-sonnet-5-5` for roughly half the cost (confirm ID first). Opus 5.5 access criteria are set per account, see "See Access" in the console ([source](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock#access)).

## 2. Structured outputs, effort, beta headers

- **Structured outputs on InvokeModel: yes (documented, not independently tested).** Anthropic's structured-outputs page marks Amazon Bedrock and "Amazon Bedrock (bedrock-runtime)" as `stable`, lists Opus 5.5, Sonnet 5.5 and Haiku 5.5 as supported, and the bedrock-runtime page lists structured outputs under supported features. The request shape is `output_config.format = {"type":"json_schema","schema":...}` ([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)). The page does not show an InvokeModel body, so run `scripts/smoke_bedrock.py` to confirm in our region.
- **No beta header needed.** "`output_format` has moved to `output_config.format`, and beta headers are no longer required." The old `output_format` parameter is deprecated and needs the `structured-outputs-2025-11-13` beta ([same page](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)).
- **Schema rules:** only `additionalProperties:false`; no `minLength/maxLength/minimum/maximum`; `minItems` only 0 or 1; no recursion or `oneOf`. Limits: 24 optional parameters and 16 union-typed parameters per request, plus an internal "Schema is too complex" 400. Our all-required schema avoids the optional-parameter limit, but large templates (up to 30 sections) could hit the grammar-size limit. Dynamic-key objects must be listed explicitly (ours are). Enum casing is not guaranteed. Check `stop_reason` for `refusal` and `max_tokens`. Incompatible with citations and prefill. The first request with a new schema pays compile latency (schemas are cached up to 24 h). **Do not put PHI in schema property names or enums.** Template field labels are user-defined, so keep patient data out of them.
- **Effort: yes.** `output_config.effort` is listed as stable on "Amazon Bedrock (bedrock-runtime)" for Opus 5.5, Sonnet 5.5 and Haiku 5.5. Values: `low`, `medium`, `high`, `xhigh`, `max`. Opus 5.5 and Haiku 5.5 default to `medium`; Sonnet 5.5 defaults to `high` ([effort](https://platform.claude.com/docs/en/build-with-claude/effort)). Our `BEDROCK_EFFORT` setting should allow all five values, not just low/medium/high.
- **Opus 5.5 thinking:** adaptive thinking is always on and `thinking: {"type":"disabled"}` returns 400. Thinking tokens count toward `max_tokens`, so 16000 is adequate for notes at `medium` but leave headroom at higher effort ([effort](https://platform.claude.com/docs/en/build-with-claude/effort)). Opus 5.5 also rejects forced `tool_choice`, and `temperature`/`top_k` are rejected ([bedrock-chat #1160](https://github.com/aws-samples/bedrock-chat/issues/1160)), consistent with the spec's "no sampling params".
- **`anthropic_version`:** For raw boto3 `InvokeModel` "you set `anthropic_version` in the request body yourself" ("bedrock-2023-05-31" in Anthropic's boto3 example). The SDK's new `2026-10-21` default does not apply to raw boto3 requests ([source](https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy)). **Unclear:** whether 5.x models on bedrock-runtime require or accept a newer version string in the body; our smoke test should cover this.
- **Beta features** on InvokeModel go in an `anthropic_beta` array in the body (for example `mid-conversation-output-config-2026-07-01`), but we need none ([source](https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy)).
- **Not supported on Bedrock:** Files API, URL sources, server-side tools, Message Batches, the `fallbacks` parameter, and automatic top-level prompt caching (use explicit `cache_control` breakpoints) ([source](https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy#features-not-supported)). Our cache-friendly static system prompt should put `cache_control` on the system block explicitly. The payload limit is 20 MB.

## 3. IAM and access

**Actions:** `bedrock:InvokeModel` (and `bedrock:InvokeModelWithResponseStream` if streaming is ever added). The long-term bearer-token action for bedrock-runtime is `bedrock:CallWithBearerToken` (mantle uses `bedrock-mantle:*`, which we do not need) ([source](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock#block-long-term-bearer-tokens)).

**Resources (medium confidence; from AWS doc summaries, [global CRIS](https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html), [CRIS prerequisites](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference-prereq.html), [AWS ML blog](https://aws.amazon.com/blogs/machine-learning/securing-amazon-bedrock-cross-region-inference-geographic-and-global/)):**

1. Inference profile in the calling region: `arn:aws:bedrock:{region}:{account-id}:inference-profile/us.anthropic.claude-opus-5-5` (Anthropic documents the form `arn:aws:bedrock:{region}:{account-id}:inference-profile/{inference-profile-id}`).
2. Foundation model in each destination region the profile can route to. For a geographic profile: `arn:aws:bedrock:{us-east-1|us-east-2|us-west-2|...}::foundation-model/anthropic.claude-opus-5-5`. Wildcard form `arn:aws:bedrock:*::foundation-model/anthropic.claude-opus-5-5`, optionally with condition `bedrock:InferenceProfileArn` equal to the profile ARN.
3. For `global.` profiles, AWS describes a third statement: foundation model with an empty region, `arn:aws:bedrock:::foundation-model/anthropic.claude-opus-5-5`, with condition `aws:RequestedRegion: "unspecified"` (and the profile ARN condition). AWS pages conflict on whether this is written as Allow or as a deny example; confirm on the current page.

Least-privilege sketch for the worker role:

```yaml
- Effect: Allow
  Action: bedrock:InvokeModel
  Resource:
    - !Sub arn:aws:bedrock:${AWS::Region}:${AWS::AccountId}:inference-profile/us.anthropic.claude-opus-5-5
    - arn:aws:bedrock:*::foundation-model/anthropic.claude-opus-5-5
```

If org SCPs block unused regions, they must allow all destination regions for the profile (and `unspecified` for global).

**Model access and Marketplace:** Anthropic says to request access under Bedrock console "Model Access" and that availability varies by region ([source](https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy#subscribe-to-anthropic-models)). Access criteria are per model ("See Access" for Opus 5.5, Sonnet 5.5, Haiku 5.5; Fable 5.1, Fable 5, Opus 4.8, Sonnet 5, Opus 4.7 and Haiku 4.5 are listed as open to all) ([source](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock#access)). **AWS Marketplace subscription requirements for these models: not confirmed.** The `aws-marketplace:Subscribe`-style permissions, if any, were not found in fetched sources.

**Data-retention mode (check before launch):** Search results report that Claude Fable 5 / Mythos 5 require an explicit account or project data-retention opt-in (`provider_data_share` or `aws_review`), and that Opus 4.8 does not. Whether Opus/Sonnet/Haiku 5.5 require it was not found. Check `allowed_modes` for the model via the Bedrock API or the [data retention page](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html) (not fetched). This matters because clinical transcripts are sensitive.

## 4. Lambda and boto3

- **Bundled boto3 version for Python 3.13: not confirmed.** AWS docs state the bundled SDK version "depends on the runtime version and your AWS Region", and recommend a test function that logs `boto3.__version__` ([Lambda Python docs](https://docs.aws.amazon.com/lambda/latest/dg/lambda-python.html); [3.13 announcement](https://aws.amazon.com/blogs/compute/python-3-13-runtime-now-available-in-aws-lambda)). The managed runtime also updates automatically, so versions drift.
- **Recommendation:** package an explicit boto3/botocore in the deployment artifact (pin a recent version in `pyproject.toml`) rather than relying on the runtime copy, and log the versions at cold start. Anthropic's minimum for raw boto3 is `boto3>=1.28.59` ([source](https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy#install-an-sdk-for-accessing-bedrock)). Inference-based note: since new parameters (`output_config`) travel in the opaque JSON `body` and the model ID is a free string, a moderately old boto3 should work, but a newer one avoids surprises such as unrecognised service-model fields; test with the pinned version in the actual Lambda.
- **Timeouts and retries:** the default botocore read timeout is 60 s, which is too short for long non-streaming generations. Use `Config(read_timeout=300, connect_timeout=10, retries={"mode":"adaptive","max_attempts":4})` (matches the spec). Constraint: worst case is roughly `read_timeout x max_attempts`, so set the worker Lambda timeout above that (Lambda maximum 15 minutes) or lower `max_attempts`. Keep the API Lambda separate because API Gateway HTTP APIs time out at 30 s; generation must stay in the async worker as designed. These are general AWS/botocore behaviours, not stated in the fetched pages.
- Non-streaming `invoke_model` is acceptable for notes. Anthropic recommends streaming for very large outputs (the effort guide suggests streaming at `max_tokens` of 128K), not needed at 16K.

## 5. Pricing and privacy

- **Pricing:** Bedrock pricing page: <https://aws.amazon.com/bedrock/pricing/>; also [AWS pricing guide](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-pricing.html) and [Anthropic cloud-platform pricing](https://platform.claude.com/docs/en/about-claude/pricing#cloud-platform-pricing) (all linked from [the Anthropic Bedrock page](https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy#additional-resources)). Anthropic list prices per MTok: Opus 5.5 $4 in / $20 out; Sonnet 5.5 $2 / $10; Haiku 5.5 from $0.10 / $0.50 ([models overview](https://platform.claude.com/docs/en/models/overview)). Regional profiles add 10%. Cache reads are 5% of input price on Opus/Sonnet 5.5 and 10% on Haiku.
- **Privacy:** AWS's position (search summary of the [Bedrock data protection page](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html)) is that Bedrock does not store or log prompts and completions, does not use them to train models, and does not share them with model providers, who have no access to customer accounts. Anthropic defers to this page for Claude on Bedrock ("Amazon Bedrock governs data handling") ([source](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock#data-retention)). Caveat: newer models can require a retention opt-in (see section 3), and model-invocation logging is optional and under our control. Enabling it stores prompts in our account, so avoid it or lock down the log group. Confidence in the general statement: medium (secondary summary); confirm the model-specific retention mode before handling real clinical data.

## 6. Follow-ups for the spec

1. Change `BEDROCK_MODEL_ID` default to `us.anthropic.claude-opus-5-5` (no `-v1:0`).
2. Widen `BEDROCK_EFFORT` to `low|medium|high|xhigh|max`.
3. Add an explicit `cache_control` breakpoint on the system block.
4. Pin boto3 in the package; log versions at cold start.
5. Run `scripts/smoke_bedrock.py` against the real account: InvokeModel with `output_config.format`, `anthropic_version` handling, and the IAM policy above.
