# 0014. Manual notes and AI-off mode

- **Status:** Accepted
- **Date:** 2026-11-26
- **Builds on:** [ADR-0012](0012-generation-consistency-and-recovery.md) (fencing token), [ADR-0007](0007-template-model-structured-sections.md) (templates)

## Context

Vets must be able to keep working without AI. Reasons seen in practice:

* **Outages.** Bedrock throttling or a regional incident must not stop record keeping.
* **Clinic policy.** Some clinics or owners do not allow AI processing of a consult.
* **Cost.** Short, routine visits may not justify a model call.
* **Trust.** A vet may prefer to write the note and only use the template structure.

The same templates, history, editing, copy-to-PIMS and rendering should work for a
hand-written note. Today every note starts as a `pending` generation job.

## Decision Drivers

* Reuse the template snapshot, PATCH validation, rendering and history; avoid a second note model.
* Keep the fencing guarantee of ADR-0012 (no lost updates).
* Never overwrite hand-written content by accident.
* AI-off must be a deployment decision, not a code change.

## Considered Options

* **A. A separate manual-note entity** (own table items, own endpoints). Clean separation, but
  duplicates listing, editing, rendering and the frontend's note page.
* **B. Reuse `Note` with a `source: "ai" | "manual"` field** (chosen). A manual note is created
  already `completed`, with a fresh `generation_id`, `model_info: null` and the same result shape.
* **C. Client-only drafts** (localStorage until the vet saves). No server change, but drafts are
  lost with the browser, are not in history, and cannot be shared across devices.

## Decision Outcome

Chosen **option B**.

* `POST /v1/notes/manual` creates a `completed` note with `source: "manual"`. `result` is optional
  and, when given, goes through the same validation as PATCH (shared
  `check_result_matches_template`). Without it the server builds a blank result from the template;
  `prefill_defaults` fills `use_normal_defaults` sections with `used_defaults: true` so the
  "confirm" marker behaves like an AI note. The transcript is optional reference text.
* **Regenerate is blocked** for manual notes (`409 MANUAL_NOTE`) because it would replace
  hand-written content. To get an AI draft of the same visit, create a new AI note from the transcript.
* Post-processor automatic flags are not applied: there is no model output to check.
* Existing stored notes have no `source`; they read as `"ai"`. `source` is also a top-level
  DynamoDB attribute so list queries can project it. No migration is needed.
* **AI-off is a configuration switch** (`LLM_PROVIDER=none`), not a per-user toggle: the decision is
  made by the operator (policy, cost, outage runbook), it needs no new data model, and it is
  reversible by redeploying with a different value. No generator is constructed; `GET /v1/health`
  reports `ai_enabled`; `POST /v1/notes`, regenerate and `mock`/`bedrock` eval runs return
  `409 AI_DISABLED`. Manual notes, templates, history, editing, copy and oracle/null eval runs keep working.

## Consequences

* **Positive:** one note model, one editor and one history for both sources; AI can be turned off
  with one variable; the fencing logic is unchanged.
* **Negative:** a note's `transcript` can be empty, so readers must not assume it is present; the
  frontend must hide or disable AI actions based on `ai_enabled` and `source`.
* **Follow-ups:** a per-clinic switch once clinics have their own configuration; an explicit
  "draft AI note from this manual note's transcript" action if users ask for it.
