# 0007. Template model: structured sections with explicit missing-data semantics

- **Title:** Template model: structured sections with explicit missing-data semantics
- **Status:** Accepted
- **Date:** 2026-11-20

## Context

Veterinary practices write notes in different styles: SOAP for general consults, COHAT for dental procedures, surgery reports, euthanasia records, and client-facing discharge summaries. Clinicians expect to shape the output: which sections exist, what each contains, how abbreviations read, and what tone is used. Competing vet scribe products (CoVet, ScribbleVet, Talkatoo, VetRec, Heidi) let clinicians configure notes; the landscape is summarised in `docs/research/competitors.md`.

The highest-risk behaviour is a model filling an unexamined body-system section with plausible "normal" findings that were never performed. In a clinical record, a fabricated normal exam is a patient-safety and liability problem. Templates must therefore make missing-data handling explicit, not left to the prompt.

## Decision Drivers

* Clinicians must be able to define and reorder sections without code changes.
* The model must not invent findings, doses, or values.
* Missing-data behaviour must be a per-section, reviewable setting.
* Anything the system fills in must be visibly flagged for clinician confirmation.
* The structure must map onto the structured-output schema ([ADR-0004](0004-structured-output-json-schema.md)).

## Considered Options

### Option A: Free-form prompt-only templates

A template is a block of prose instructions.

* Good, because it is maximally flexible.
* Bad, because the output shape is unpredictable, and missing-data behaviour is whatever the prompt happens to say.
* Bad, because the frontend cannot render or edit sections reliably.

### Option B: Rigid fixed SOAP

Every note is Subjective, Objective, Assessment, Plan.

* Good, because it is predictable and matches common practice.
* Bad, because dental, surgery, and euthanasia records do not fit SOAP, and customising it is impossible.

### Option C: Structured sections (chosen)

A template has metadata, a list of sections, and style settings. Each section has a `format` (`paragraph`, `bullets`, or `key_value` with `fields`), `required`, `instructions`, and `missing_behavior`: `omit`, `state_not_discussed`, or `use_normal_defaults` with `normal_defaults` text.

* Good, because the structure is machine-checkable and renders consistently.
* Good, because `missing_behavior` makes the default for unmentioned findings an explicit, reviewable choice.
* Good, because `use_normal_defaults` output is flagged `used_defaults=true` and surfaced to the clinician.
* Bad, because the model is more complex to author than a prompt, and the editor needs validation mirroring the server rules.

## Decision Outcome

Chosen option: **Option C, structured sections**, enforced in the domain model (`domain/models.py`) and in the editor.

Rules:

* Sections are ordered, with unique ids matching `^[a-z][a-z0-9_]{0,39}$`, between 1 and 30 per template.
* `key_value` sections must define at least one field; other formats must not.
* `omit` marks a section `not_discussed=true` with empty content, and the final note hides it.
* `state_not_discussed` renders "Not discussed." so absence is visible.
* `use_normal_defaults` fills unmentioned findings with `normal_defaults`, sets `used_defaults=true`, and abnormal findings in the transcript always override the defaults.

Template-level `style` covers `tone` (`clinical` or `client_friendly`), `use_abbreviations`, and free-text `custom_instructions` of up to 2000 characters.

Built-in templates (at least nine) use these settings: for example, the Objective section uses `key_value` for vitals and a body-systems paragraph with `use_normal_defaults`.

## Consequences

### Positive

* Clinicians control structure and missing-data policy without developer involvement.
* The default-filled exam findings are always visible and cannot pass silently into a record.
* The same model drives generation, rendering, and editing.

### Negative

* Authoring a custom template requires understanding the four missing-data options; sensible defaults and a preview pane are needed.
* The `use_normal_defaults` option carries residual clinical risk if a clinic configures it carelessly; the review UI and documentation must make the risk clear.

### Follow-ups

* Add a warning in the template editor when `use_normal_defaults` is set on a non-body-system section.
* Create `docs/research/competitors.md`, which this ADR cites; it is not present in the repository yet.
* Review built-in default text with a veterinarian before release.

## Related

* [ADR-0004: Structured output](0004-structured-output-json-schema.md)
* [ADR-0006: Persistence](0006-persistence-dynamodb-single-table.md) (template snapshots)
* [ADR-0011: Security and privacy](0011-security-privacy-baseline.md) (clinician review)
