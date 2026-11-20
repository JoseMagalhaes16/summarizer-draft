# 0006. Persistence: DynamoDB single table with clinic-scoped keys and template snapshots

- **Title:** Persistence: DynamoDB single table with clinic-scoped keys and template snapshots
- **Status:** Accepted
- **Date:** 2026-11-20

## Context

VetScribe stores custom templates, generated notes, and their edit history. Access patterns are simple: list templates for a clinic, list notes newest first, fetch one note or template by id, and update or delete single items. Traffic is low. Authentication is deferred, but the data model must be ready for multi-clinic tenancy without rework.

Two semantic requirements shape the model. Built-in templates ship with the product and must not be editable in the database. And a note must remain interpretable after its template is edited, because a clinician may later open or regenerate an old note.

## Decision Drivers

* Operational simplicity and pay-per-request cost at low volume.
* Tenancy-ready keys before authentication exists.
* Time-ordered listing of notes without secondary sorting logic.
* Stable interpretation of historical notes when templates change.
* Local testability with an in-memory repository and `moto` in tests.

## Considered Options

### Option A: Amazon RDS or Aurora Serverless v2 (PostgreSQL)

* Good, because relational queries and constraints are familiar.
* Bad, because it needs VPC networking for Lambda, connection management, and a minimum capacity cost even when idle.
* Bad, because the access patterns do not need joins.

### Option B: DynamoDB, one table per entity

* Good, because each entity has an obvious home.
* Bad, because it multiplies tables, IAM statements, and infrastructure for three simple patterns.

### Option C: JSON objects in S3

* Good, because it is cheap and simple to store.
* Bad, because listing, ordering, and conditional updates are awkward and eventually consistent for listings.

### Option D: DynamoDB single table (chosen)

One table with partition key `CLINIC#{clinic_id}` and sort key `TEMPLATE#{id}` or `NOTE#{ulid}`. Each item carries an `entity` attribute and the full document in `data`.

* Good, because one table, one IAM policy, and one backup configuration serve all entities.
* Good, because a `begins_with(SK, "NOTE#")` query with `ScanIndexForward=false` returns notes newest first.
* Good, because the clinic prefix in the partition key makes multi-tenant access a query-scope change, not a schema change.
* Bad, because the single-table design is less self-describing and requires discipline in key construction.

## Decision Outcome

Chosen option: **Option D, DynamoDB single table**, with `PAY_PER_REQUEST` billing, point-in-time recovery, and server-side encryption enabled.

Keys:

* Notes use a ULID in the sort key. ULIDs are lexicographically time-ordered, so sorting needs no secondary index and ids remain sortable across the local and AWS backends.
* `clinic_id` defaults to `DEFAULT_CLINIC_ID` until authentication supplies it from a Cognito JWT claim ([ADR-0011](0011-security-privacy-baseline.md)).

Built-in templates are code, not rows. They are versioned with releases and merged into the template list at read time, and they are read-only. A user who wants to change one duplicates it into a custom template.

Template snapshots: every note stores `template_snapshot`, a frozen copy of the template at generation time. Edits to the source template never change how an existing note is interpreted, displayed, or regenerated unless the user explicitly regenerates against a new template.

## Consequences

### Positive

* Historical notes are reproducible: the stored snapshot, not the current template, governs their structure.
* Built-in templates cannot be corrupted by data writes and are updated by deployment.
* Listing and tenancy need no extra indexes.

### Negative

* Notes duplicate template content, increasing item size; a 30-section template is stored once per note.
* Items are stored as JSON documents, so DynamoDB cannot enforce field-level constraints; validation lives in the application layer.
* Changing key design later requires a migration.

### Follow-ups

* Add a GSI on `entity` plus `updated_at` only if a cross-clinic admin view is introduced.
* Enforce item size monitoring; alert if notes approach the 400 KB item limit.
* Confirm the `data` attribute encoding (string versus map) in the repository tests before the first production write.

## Related

* [ADR-0007: Template model](0007-template-model-structured-sections.md)
* [ADR-0011: Security and privacy](0011-security-privacy-baseline.md)
