"""Deterministic offline generator.

Returns the *raw* JSON dict shaped like the structured-output schema (never a finished
``NoteResult``); the shared post-processor then validates it exactly like real model output.
"""

from __future__ import annotations

import re
import time
from typing import Any

from vetscribe.domain.models import ModelInfo, Patient, Section, Template
from vetscribe.llm.base import GenerationResult

_STOPWORD_TEXT = (
    "a an and are as at be by for from if in is it of on or that the this to with was were "
    "any all not no only about into than then them their there these those will can may use "
    "used using include included including section note notes should must per each also such "
    "stated mentioned discussed else other when what which who how"
)
_STOPWORDS = frozenset(_STOPWORD_TEXT.split())

_SYNONYMS: dict[str, tuple[str, ...]] = {
    "subjective": (
        "history",
        "owner",
        "says",
        "eating",
        "drinking",
        "vomiting",
        "since",
        "noticed",
    ),
    "history": ("owner", "since", "noticed", "eating", "drinking", "days", "weeks"),
    "objective": ("exam", "temperature", "heart", "weight", "lungs", "abdomen", "palpation"),
    "exam": ("temperature", "heart", "lungs", "abdomen", "palpation", "auscultation", "ears"),
    "assessment": ("suspect", "diagnosis", "likely", "differential", "consistent", "looks"),
    "diagnosis": ("suspect", "likely", "consistent", "cytology", "differential"),
    "plan": ("recommend", "prescribe", "recheck", "mg", "start", "schedule", "return", "drops"),
    "treatment": ("recommend", "prescribe", "mg", "start", "cleaner", "drops", "medication"),
    "vaccination": ("vaccine", "vaccines", "rabies", "fvrcp", "dhpp", "booster", "due"),
    "dental": ("teeth", "tooth", "gingivitis", "tartar", "calculus", "extraction", "cleaning"),
    "anesthesia": ("anesthesia", "anesthetic", "bloodwork", "fasting", "sedation", "intubate"),
    "owner": ("owner", "home", "client", "concern", "wants"),
    "communication": ("owner", "understands", "questions", "estimate", "consent"),
    "follow": ("recheck", "return", "schedule", "follow", "weeks", "days"),
    "medications": ("mg", "tablet", "tablets", "drops", "prescribe", "dispense", "twice", "daily"),
    "home": ("home", "owner", "monitor", "watch", "call", "feed", "keep"),
}

_ACTION_RE = re.compile(
    r"\b(recheck|re-check|follow[- ]?up|come back|bring (?:her|him|them|bella|max)? ?back|return|"
    r"schedule|book|booked|call us|let us know|retest|repeat|bloodwork|drop off)\b",
    re.I,
)
_SPEAKER_RE = re.compile(
    r"^\s*(?:Dr\.?\s+\w+|Vet|Veterinarian|Doctor|Owner|Client|Tech|Technician|"
    r"[A-Z][a-z]+ \(owner\)|[A-Z][a-z]+)\s*:\s*",
    re.M,
)
_WEIGHT_RE = re.compile(r"\b\d+(?:\.\d+)?\s?(?:kilograms?|kilos?|kgs?|lbs?|pounds?)\b", re.I)
_TEMP_RE = re.compile(
    r"\b\d{2,3}(?:\.\d)?\s?(?:°\s?[FC]\b|(?:degrees\s?)?(?:Fahrenheit|Celsius)\b|[FC]\b)"
)
_HR_RE = re.compile(r"\b\d{2,3}\s?(?:bpm|beats(?: per minute)?)", re.I)
_RR_RE = re.compile(r"\b\d{1,3}\s?(?:breaths(?: per minute)?|brpm|bpm resp)", re.I)
_BCS_RE = re.compile(r"\b\d(?:\.\d)?\s?(?:/|out of)\s?9\b", re.I)
_CRT_RE = re.compile(
    r"\b(?:crt|capillary refill(?: time)?)[^.\n]{0,25}?"
    r"(?:<|less than )?\s?\d(?:\.\d)?\s?(?:s|sec|seconds)\b",
    re.I,
)
_MM_RE = re.compile(
    r"\b(?:pink|pale|icteric|injected|cyanotic|tacky|moist)\b"
    r"(?:[ ,&]+(?:and )?(?:pink|pale|moist|tacky|icteric)\b)*",
    re.I,
)
_GREETING_RE = re.compile(
    r"^(?:good (?:morning|afternoon)|hi\b|hello|thanks|thank you|come on in)", re.I
)
_WORD_RE = re.compile(r"[a-z][a-z\-']+")


def _sentences(transcript: str) -> list[str]:
    text = _SPEAKER_RE.sub("", transcript)
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    out: list[str] = []
    for p in parts:
        p = " ".join(p.split())
        if len(p.split()) >= 4 and not p.endswith("?"):
            out.append(p)
    return out


def _keywords(section: Section) -> set[str]:
    words = {
        w
        for w in _WORD_RE.findall(f"{section.title} {section.instructions}".lower())
        if w not in _STOPWORDS and len(w) > 2
    }
    expanded = set(words)
    for w in words:
        expanded.update(_SYNONYMS.get(w, ()))
    for key, syns in _SYNONYMS.items():
        if key in section.id.lower():
            expanded.update(syns)
    return expanded


def _top(sentences: list[str], keywords: set[str], n: int) -> list[str]:
    scored: list[tuple[int, int, str]] = []
    for idx, sent in enumerate(sentences):
        toks = set(_WORD_RE.findall(sent.lower()))
        score = len(toks & keywords)
        if score:
            scored.append((score, idx, sent))
    scored.sort(key=lambda t: (-t[0], t[1]))
    chosen = sorted(scored[:n], key=lambda t: t[1])
    return [s for _, _, s in chosen]


def _extract_field(key: str, label: str, hint: str, transcript: str, sentences: list[str]) -> str:
    probe = f"{key} {label}".lower()
    patterns: list[re.Pattern[str]] = []
    if "weight" in probe or key in {"wt", "bw"}:
        patterns = [_WEIGHT_RE]
    elif "temp" in probe or key == "t":
        patterns = [_TEMP_RE]
    elif "heart" in probe or key == "hr":
        patterns = [_HR_RE]
    elif "resp" in probe or key == "rr":
        patterns = [_RR_RE]
    elif "bcs" in probe or "body condition" in probe:
        patterns = [_BCS_RE]
    elif key == "crt" or "capillary" in probe:
        patterns = [_CRT_RE]
    elif key == "mm" or "mucous" in probe:
        patterns = [_MM_RE]
    for pat in patterns:
        m = pat.search(transcript)
        if m:
            return m.group(0).strip()
    # Generic: the sentence that mentions the label words.
    tokens = [w for w in _WORD_RE.findall(f"{label} {hint}".lower()) if w not in _STOPWORDS]
    for sent in sentences:
        low = sent.lower()
        if tokens and any(t in low for t in tokens[:2]):
            return sent[:200]
    return ""


def _mock_section(section: Section, transcript: str, sentences: list[str]) -> dict[str, Any]:
    kws = _keywords(section)
    out: dict[str, Any] = {"not_discussed": False, "used_defaults": False}
    if section.format == "paragraph":
        picked = _top(sentences, kws, 3)
        text = " ".join(picked)
        if (
            picked
            and section.missing_behavior == "use_normal_defaults"
            and section.normal_defaults.strip()
        ):
            text += f" Not otherwise mentioned (defaults): {section.normal_defaults.strip()}"
            out["used_defaults"] = True
        out["content"] = text
        out["not_discussed"] = not text
    elif section.format == "bullets":
        picked = _top(sentences, kws, 5)
        out["items"] = picked
        out["not_discussed"] = not picked
    else:
        values = {
            f.key: _extract_field(f.key, f.label, f.hint, transcript, sentences)
            for f in section.fields
        }
        out["fields"] = values
        out["not_discussed"] = not any(values.values())
    return out


def build_mock_output(template: Template, transcript: str, patient: Patient) -> dict[str, Any]:
    sentences = _sentences(transcript)
    sections = {s.id: _mock_section(s, transcript, sentences) for s in template.sections}
    substantive = [x for x in sentences if not _GREETING_RE.match(x)]
    first = (substantive or sentences or ["Consultation transcript recorded."])[0]
    summary = first if len(first) <= 160 else first[:157].rstrip() + "..."
    if patient.name.strip() and patient.name.strip().lower() not in summary.lower():
        summary = f"{patient.name.strip()}: {summary}"[:160]
    actions = [s for s in sentences if _ACTION_RE.search(s)][:5]
    return {
        "visit_summary": summary,
        "sections": sections,
        "action_items": actions,
        "review_flags": [
            "Generated by the offline mock generator - verify all content against the transcript."
        ],
    }


class MockNoteGenerator:
    def __init__(self, latency_seconds: float = 0.0) -> None:
        self._latency = latency_seconds

    def generate(
        self,
        template: Template,
        transcript: str,
        patient: Patient,
        clinician: str = "",
    ) -> GenerationResult:
        started = time.monotonic()
        if self._latency > 0:
            time.sleep(self._latency)
        raw = build_mock_output(template, transcript, patient)
        return GenerationResult(
            raw=raw,
            model_info=ModelInfo(
                provider="mock",
                model_id="mock-v1",
                input_tokens=len(transcript.split()),
                output_tokens=sum(len(str(v).split()) for v in raw["sections"].values()),
                latency_ms=int((time.monotonic() - started) * 1000),
            ),
        )
