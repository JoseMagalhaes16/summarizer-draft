# 0004. Structured output: per-template JSON Schema via output_config.format

- **Title:** Structured output: per-template JSON Schema via output_config.format
- **Status:** Accepted
- **Date:** 2026-11-20

## Context

The product returns a clinical note whose shape is defined by a user-editable template. Each template has an ordered list of sections, each with a `format` (`paragraph`, `bullets`, or `key_value` with fields), plus a `visit_summary`, `action_items`, and `review_flags`. The frontend renders sections per format and allows inline editing, so the backend must return a predictable, machine-parseable structure. Free text cannot be trusted to contain every section, use the right keys, or stay within the expected shape.

The schema therefore has to be generated per request from the template snapshot, and the model's output has to conform to it.

## Decision Drivers

* Output must parse reliably on every generation, with no regex-scraping of prose.
* Every template section must appear, keyed by its stable section id.
* The schema must be expressible in the supported structured-output subset.
* Validation failures must map to typed error codes (`INVALID_MODEL_OUTPUT`), not stack traces.
* The mechanism must work with the Bedrock path chosen in [ADR-0003](0003-llm-access-bedrock-invoke-model.md).

## Considered Options

### Option A: Free-text Markdown with regex parsing

* Good, because it needs no schema and is simple to prompt.
* Bad, because parsing headings and bullets from prose is brittle and fails silently.
* Bad, because missing sections are hard to detect.

### Option B: JSON requested in the prompt, no constraint

* Good, because it is trivial to implement.
* Bad, because the model may add prose, wrap JSON in fences, omit keys, or vary key names; every run needs repair logic.

### Option C: Forced tool use

Define a tool whose `input_schema` is the note schema and force the model to call it.

* Good, because the tool input is structured by construction.
* Bad, because forced `tool_choice` is rejected by current Claude models, so the call cannot be guaranteed.

### Option D: Structured outputs with `output_config.format` (default) and a single strict tool (alternative)

Default mode sends `output_config.format` with `type: json_schema`. The alternative `tool` mode defines one strict tool, `record_clinical_note`, with `strict: true` and `tool_choice: {"type": "auto"}`, and takes the first `tool_use` input.

* Good, because the API constrains decoding to the schema in default mode.
* Good, because `tool` mode is available as a fallback if a model or deployment rejects `output_config.format`.
* Bad, because the default mode depends on the schema subset supported by structured outputs.
* Bad, because `tool` mode relies on the model choosing to call the tool, which needs an instruction and a retry path.

## Decision Outcome

Chosen option: **Option D**, with `BEDROCK_STRUCTURED_MODE=output_config` as the default and `tool` as the alternative.

The schema is built in `prompts/builder.py` from the template snapshot:

* Top level: `visit_summary` (string), `sections` (object keyed by section id), `action_items` (string array), `review_flags` (string array), all required, `additionalProperties: false`.
* Per format: paragraph sections use `{content, not_discussed, used_defaults}`; bullets use `{items, ...}`; key_value uses `{fields: {<key>: string}, ...}` where an empty string means not mentioned.
* Schema restriction: no `minLength`, `maximum`, or similar keywords, which are unsupported. Length and shape constraints are enforced after decoding.

After the response, the backend parses JSON, validates it with a Pydantic v2 model, and post-processes the dictionary of sections into an ordered list in template order, filling titles and labels from the template and applying `missing_behavior`. Any validation failure becomes `INVALID_MODEL_OUTPUT`. Refusal and truncation are checked from `stop_reason` before the content is read.

## Consequences

### Positive

* Section presence and key names are guaranteed by the decoder, and the post-processor restores template order.
* Clinician-facing flags (`used_defaults`, `not_discussed`, `review_flags`) are first-class fields rather than inferred text.
* The two modes share one schema builder, so switching is a configuration change.

### Negative

* Schemas for large templates (up to 30 sections) increase input tokens per request.
* Pydantic validation is still required; structured output does not replace it.
* Tests must cover the schema subset restriction, because unsupported keywords fail only at runtime against the real model.

### Follow-ups

* Snapshot each generated schema in a unit test per built-in template to catch accidental unsupported keywords.
* Re-check `output_config.format` availability for each model on Bedrock during model migration.
* Remove the `tool` mode if it is unused after one release cycle.

## Related

* [ADR-0003: LLM access via Bedrock](0003-llm-access-bedrock-invoke-model.md)
* [ADR-0007: Template model](0007-template-model-structured-sections.md)
