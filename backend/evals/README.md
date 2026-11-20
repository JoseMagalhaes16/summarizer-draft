# Eval cases

One JSON file per case in `cases/`, transcripts in `transcripts/` (or inline). Format and the
authoring checklist are in [docs/evals/README.md](../../docs/evals/README.md); the schema is
`vetscribe.evals.models.EvalCase`. Always run `python -m vetscribe.evals.cli validate-cases`
after editing. Ground truth must be human-written; never copy expectations from model output.
