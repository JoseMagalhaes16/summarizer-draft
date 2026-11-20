# 0001. Record architecture decisions using MADR

- **Title:** Record architecture decisions using MADR
- **Status:** Accepted
- **Date:** 2026-11-20

## Context

VetScribe is a veterinary AI scribe that turns consultation transcripts into structured clinical notes. Its architecture spans AWS Lambda, API Gateway, DynamoDB, Amazon Bedrock, a React frontend, and AWS SAM infrastructure. Several choices in the design (compute model, LLM access path, structured output, persistence, template semantics) are non-obvious and carry real trade-offs. Future contributors, human or agent, need to understand why these choices were made, not just what they are, so they do not silently reverse them.

The design specification (`docs/design/spec.md`) is the implementation contract, but it describes the resulting system rather than the alternatives that were weighed. Decisions made in chat, pull request threads, or commit messages are easy to lose.

## Decision Drivers

* Decisions must be discoverable from the repository, next to the code they govern.
* Each record must capture the options considered, including rejected ones, so reversals are informed.
* The format must be lightweight enough that writing a record does not block implementation.
* Records must be versioned with the code and reviewed like any other change.

## Considered Options

### Option A: Architecture Decision Records in MADR format (chosen)

Markdown files under `docs/adr/`, numbered sequentially, using the MADR (Markdown Architectural Decision Records) template structure.

* Good, because it is plain Markdown that renders on any Git host and needs no tooling.
* Good, because MADR's explicit "Considered Options" and "Decision Outcome" sections force the alternatives to be written down.
* Good, because one file per decision keeps history diffable and allows superseding a decision without rewriting the record.
* Bad, because it relies on discipline: nothing enforces that a significant change gets a record.
* Bad, because a numbered index must be maintained by hand in `docs/adr/README.md`.

### Option B: Wiki or Notion pages

* Good, because it is easy to edit and search in a browser.
* Bad, because it drifts from the repository and is not reviewed with code changes.
* Bad, because access and history are controlled outside Git.

### Option C: Decisions embedded in the design spec only

* Good, because there is a single document to read.
* Bad, because the spec records the outcome, not the rejected alternatives or the reasoning, and it grows unwieldy as decisions accumulate.

## Decision Outcome

Chosen option: **Option A, MADR-style ADRs in `docs/adr/`**, because it keeps decision records in the same repository and review process as the code they describe, and the MADR structure captures alternatives and consequences, which is what future maintainers need.

Conventions:

* Files are named `NNNN-kebab-title.md` with a zero-padded four-digit number.
* Each record contains Title, Status, Date, Context, Decision Drivers, Considered Options, Decision Outcome, and Consequences, with links to related records.
* Status values are `Proposed`, `Accepted`, `Deprecated`, or `Superseded by NNNN`. A superseded record is never deleted or rewritten; a new record is added.
* `docs/adr/README.md` holds the index table.

## Consequences

### Positive

* Rationale for the compute, LLM, persistence, and template choices is preserved next to the code.
* Reversing a decision requires an explicit new record, which makes the cost of the change visible.

### Negative

* Authors must spend time writing records for significant decisions.
* The index can fall out of date if records are added without updating `README.md`.

### Follow-ups

* Add a pull request checklist item: significant architectural changes require an ADR.
* Revisit the format if records become too numerous to scan in one table.

## Related

* [ADR-0002: Compute](0002-compute-lambda-lambdalith.md) (first decision recorded under this convention)
* Index: [README.md](README.md)
