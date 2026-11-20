# 0013. Evaluation approach: atomic deterministic graders plus an optional judge

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

VetScribe turns consultation transcripts into clinical notes that a vet signs. Prompt,
template and model changes are frequent, and the worst failures are silent: an invented drug, a
dropped dose, a converted unit, filler in a section nobody discussed, obeying text inside the
transcript. We need evidence that a change is better or worse, a way to choose a Bedrock model
and effort for quality, cost and latency, and a regression gate for CI. Model output is
variable, so single comparisons mislead.

## Decision Drivers

* Catch safety-relevant failures specifically; do not average them away.
* Ground truth must be human-authored, never model-derived.
* Exercise the production code path.
* Distinguish infrastructure failures from model failures.
* Cheap to run locally and in CI; AWS use opt-in.
* Honest about statistical noise.

## Considered Options

* **A. No evals** (rely on unit tests and spot checks).
* **B. Ad-hoc manual review** of a few notes per change.
* **C. Reference similarity** (ROUGE/BLEU/embedding similarity against a gold note).
* **D. LLM-judge only.**
* **E. Atomic deterministic graders on human-written expectations, plus an optional judge**
  (chosen).
* **F. Hosted evaluation platform** (e.g. a SaaS eval or observability product).

## Decision Outcome

Chosen **option E**, implemented in `vetscribe.evals` ([eval-spec](../design/eval-spec.md)).

* Cases are JSON files with human-written expectations: exact normalised fields, any-of facts,
  forbidden terms (hallucination traps), not-discussed and default-filled sections, review
  flags and action items. A subset is adversarial (prompt injection, sparse input, ambiguous
  dose, unit preservation).
* Each metric is a separate pure function; there is deliberately no blended score.
  `hallucination_free` is fail-on-any.
* The runner calls the real prompt builder, `NoteGenerator` and post-processor. Infra errors go
  to `errors.jsonl` and are never scored. Reps, Wilson and seeded bootstrap intervals, a noise
  floor and a paired compare give verdicts better / worse / within noise.
* Oracle and null generators self-test the harness in tests and CI.
* An LLM judge (Bedrock, structured output, inputs treated as untrusted, told not to reward
  length) is optional and advisory until calibrated against vet labels.
* Results are stored as files locally or in S3 (`EVAL_STORE=s3`). Full runs happen from the CLI
  or a GitHub Actions workflow with OIDC; the API Lambda only reads (`EVALS_ALLOW_TRIGGER=false`
  in AWS).

### Consequences

* Good: failures are specific and explainable; cheap and deterministic to grade; CI regression
  gate via `--fail-under`; no extra vendor.
* Good: the self-test catches a broken or gameable grader.
* Bad: substring matching misses paraphrase and negation; expectations need upkeep; the
  proxy for faithfulness is crude; v1 cases are not vet-verified.
* Bad: small case set means wide intervals (about 1/sqrt(n x R)).
* Follow-ups: vet verification, production-sampled consented cases, judge calibration,
  pairwise judge, Step Functions or Batch for long runs.

## Pros and Cons of the Options

* **A. No evals.** Free, but regressions reach clinicians; rejected.
* **B. Manual review.** Realistic but slow, subjective, not repeatable, no statistics.
* **C. Reference similarity.** Rewards length and wording overlap, not correctness: a note that
  invents a drug can score higher than a terse correct one; wrong for a safety-critical task.
* **D. Judge only.** Flexible but unvalidated, biased towards length, costs money per run, and
  can be fooled by content in the transcript; useful only as a supplement.
* **E. Atomic graders plus judge.** Chosen, see above.
* **F. Hosted platform.** Good tooling, but sends clinical transcripts to another vendor
  (conflicts with [ADR-0011](0011-security-privacy-baseline.md)) and adds cost and lock-in; may
  be revisited for dashboards once the data policy allows.
