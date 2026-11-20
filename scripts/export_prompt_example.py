"""Export real Bedrock request bodies (built by the production prompt builder) for the
in-app documentation, so the Docs tab always shows what the code actually sends.

Usage:  backend/.venv/bin/python scripts/export_prompt_example.py
Writes: frontend/src/features/docs/generated/bedrock-request.example.json
"""

from __future__ import annotations

import json
from pathlib import Path

from vetscribe.config import Settings
from vetscribe.domain.builtin_templates import get_builtin
from vetscribe.domain.models import Patient
from vetscribe.llm.bedrock import BedrockNoteGenerator

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend/src/features/docs/generated/bedrock-request.example.json"

TRANSCRIPT = (
    "Vet: Hi, this must be Biscuit. What brings you in today?\n"
    "Owner: He's been shaking his head and scratching his left ear for about three weeks.\n"
    "Vet: His temperature is 101.6, he weighs 34.2 kilograms. The left canal is red with "
    "dark waxy discharge. Cytology shows lots of yeast.\n"
    "Vet: I'll dispense an ear ointment, one pump in each ear twice a day for fourteen days, "
    "and carprofen for pain. Let's recheck in two weeks."
)


def main() -> None:
    patient = Patient(name="Biscuit", species="canine", breed="Labrador Retriever")
    out: dict[str, object] = {"transcript_excerpt": TRANSCRIPT}
    for template_id in ("builtin-soap", "builtin-discharge"):
        template = get_builtin(template_id)
        if template is None:
            continue
        for mode in ("output_config", "tool"):
            settings = Settings.from_env({"BEDROCK_STRUCTURED_MODE": mode})
            gen = BedrockNoteGenerator(settings, client=object())
            body = gen.build_request_body(template, TRANSCRIPT, patient)
            out[f"{template_id}:{mode}"] = {
                "model_id": settings.bedrock_model_id,
                "body": body,
            }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes, keys={list(out)})")


if __name__ == "__main__":
    main()
