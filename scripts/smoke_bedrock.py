#!/usr/bin/env python3
"""Run ONE real generation against Amazon Bedrock using the production adapter.

Requires AWS credentials with bedrock:InvokeModel on the chosen model. Not run in tests.

    backend/.venv/bin/python scripts/smoke_bedrock.py \\
        --template-id builtin-soap \\
        --transcript-file backend/tests/fixtures/transcripts/canine_otitis.txt \\
        --model-id us.anthropic.claude-opus-5-5 --region us-east-1 --mode output_config
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend" / "src"))

from vetscribe.config import DEFAULT_BEDROCK_MODEL_ID, Settings  # noqa: E402
from vetscribe.domain.builtin_templates import get_builtin  # noqa: E402
from vetscribe.domain.models import Patient  # noqa: E402
from vetscribe.domain.postprocess import postprocess  # noqa: E402
from vetscribe.domain.rendering import render_note_text  # noqa: E402
from vetscribe.errors import GenerationError  # noqa: E402
from vetscribe.llm.bedrock import BedrockNoteGenerator  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--template-id", default="builtin-soap")
    ap.add_argument("--transcript-file", required=True, type=Path)
    ap.add_argument("--model-id", default=DEFAULT_BEDROCK_MODEL_ID)
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument("--mode", choices=["output_config", "tool"], default="output_config")
    ap.add_argument("--effort", choices=["low", "medium", "high"], default="medium")
    ap.add_argument("--patient-name", default="")
    args = ap.parse_args()

    template = get_builtin(args.template_id)
    if template is None:
        print(f"Unknown built-in template: {args.template_id}", file=sys.stderr)
        return 2
    settings = Settings(
        llm_provider="bedrock",
        aws_region=args.region,
        bedrock_model_id=args.model_id,
        bedrock_structured_mode=args.mode,
        bedrock_effort=args.effort,
    )
    transcript = args.transcript_file.read_text(encoding="utf-8")
    try:
        gen = BedrockNoteGenerator(settings).generate(
            template, transcript, Patient(name=args.patient_name)
        )
        result = postprocess(gen.raw, template)
    except GenerationError as exc:
        print(json.dumps({"ok": False, "error": {"code": exc.code, "message": exc.message}}))
        return 1
    print(
        json.dumps(
            {
                "ok": True,
                "model_info": gen.model_info.model_dump(),
                "result": result.model_dump(),
                "rendered_text": render_note_text(result, template),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
