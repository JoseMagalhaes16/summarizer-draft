"""Deterministic offline generator.

Returns the *raw* JSON dict shaped like the structured-output schema (never a finished
``NoteResult``); the shared post-processor then validates it exactly like real model output.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
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

_NUM_WORDS = (
    "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|"
    "half|quarter"
)
_ACTION_RE = re.compile(
    r"\b(recheck|re-check|follow[- ]?up|come back|call (?:us|you)|schedule|book|bring|"
    r"continue|give (?:his|her|him|them|the|it|a)\b|return|retest|let us know)",
    re.I,
)
_ACTION_SKIP_RE = re.compile(r"\b(?:I'll|we'll|I will|we will|will)\s+give\b", re.I)
_LEAD_FILLER_RE = re.compile(
    r"^(?:so|okay|ok|well|alright|all right|right|yes|yeah|great|please|let's|let us)\b[,\s]*", re.I
)
_SPEAKER_RE = re.compile(
    r"^\s*(?P<who>Dr\.?\s+\w+|Vet|Veterinarian|Doctor|Owner|Client|Tech|Technician|Nurse|"
    r"[A-Z][a-z]+ \(owner\)|[A-Z][a-z]+)\s*:\s*"
)
_OWNER_ROLES = ("owner", "client")
_ABBREV_RE = re.compile(r"\b(Mr|Mrs|Ms|Dr|Prof|vs)\.")
_GREETING_RE = re.compile(
    r"^(?:hi\b|hello\b|hey\b|good (?:morning|afternoon|evening)|thanks?\b|thank you|"
    r"nice to meet|come on in|you're welcome|sounds good|that (?:all )?makes sense|"
    r"that's understandable|this (?:must be|is)\b|tell me\b|"
    r"let me (?:have a look|take a look|examine|check)|let's (?:examine|take a look)|"
    r"good,? thank|okay,? thank|great,? thank|see you|bye)",
    re.I,
)
_WORD_RE = re.compile(r"[a-z][a-z\-']+")

# -- vitals extraction ----------------------------------------------------------------------
_N = r"(\d+(?:\.\d+)?)"
_WEIGHT_RE = re.compile(_N + r"\s?(kilograms?|kilos?|kgs?|lbs?|pounds?)\b", re.I)
_WEIGHT_NOW_RE = re.compile(r"\b(?:today|now|currently|weighs)\b", re.I)
_TEMP_UNIT_RE = re.compile(
    r"\b(\d{2,3}(?:\.\d)?)\s?(?:°\s?([FC])\b|(?:degrees\s?)?(Fahrenheit|Celsius)\b|degrees\s?([FC])\b)",
    re.I,
)
_TEMP_WORD_RE = re.compile(r"\btemp(?:erature)?\s*(?:is|was|of|:)?\s*(\d{2,3}(?:\.\d)?)\b", re.I)
_FILL = r"(?:\s+(?:is|was|are|of|at|about|around|approximately|fast|slow|normal|elevated)){0,4}"
_HR_RES = (
    re.compile(r"\bheart rate" + _FILL + r"\s*:?\s*(\d{2,3})\b", re.I),
    re.compile(r"\b(\d{2,3})\s?(?:beats(?: per minute)?|bpm)\b", re.I),
    re.compile(r"\bHR\s*:?\s*(\d{2,3})\b"),
)
_RR_RES = (
    re.compile(r"\brespiratory rate" + _FILL + r"\s*:?\s*(\d{1,3})\b", re.I),
    re.compile(r"\b(\d{1,3})\s?(?:breaths(?: per minute)?|brpm)\b", re.I),
    re.compile(r"\bRR\s*:?\s*(\d{1,3})\b"),
)
_BCS_RES = (
    re.compile(r"\b(\d(?:\.\d)?)\s?(?:out of|/)\s?9\b", re.I),
    re.compile(r"\bBCS\s*(?:is|of|:)?\s*(\d(?:\.\d)?)\b", re.I),
)
_MM_WORDS = (
    "pink|pale|white|icteric|jaundiced|yellow|injected|red|cyanotic|blue|tacky|moist|dry|"
    "muddy|hyperemic|and|&"
)
_MM_RE = re.compile(
    r"\b(?:mucous membranes?|gums|MM)(?:\s+(?:are|is|look|appear))?\s+"
    r"((?:(?:" + _MM_WORDS + r")\b[\s,]*){1,6})",
    re.I,
)
_CRT_RE = re.compile(
    r"\b(?:capillary refill(?: time)?|CRT)[\s:=]*(?:is\s+|was\s+)?"
    r"((?:under|less than|greater than|over|about|around|approximately|<|>)?\s*"
    r"(?:\d(?:\.\d)?|one|two|three)\s*(?:s|secs?|seconds?)\b)",
    re.I,
)
_PAIN_RES = (
    re.compile(r"\bpain score\s*(?:is|of|:)?\s*(\d{1,2})(?:\s*(?:out of|/)\s*(\d{1,2}))?", re.I),
    re.compile(r"\b(\d{1,2})\s?(?:out of|/)\s?(4|10)\b", re.I),
)
_ASA_RE = re.compile(
    r"\bASA\s+(?:class\s+|status\s+|grade\s+)?(I{1,3}V?|IV|V|one|two|three|four|five|[1-5])\b",
    re.I,
)
_VITAL_RES: tuple[re.Pattern[str], ...] = (
    _WEIGHT_RE,
    _TEMP_UNIT_RE,
    _TEMP_WORD_RE,
    *_HR_RES[:2],
    *_RR_RES[:2],
    _BCS_RES[0],
    _MM_RE,
    _CRT_RE,
)

# -- people / patient inference -------------------------------------------------------------
_NAME_RES = (
    re.compile(r"(?i:\bthis (?:must be|is|would be))\s+([A-Z][a-z]+)\b"),
    re.compile(r"(?i:\bhi\b),?\s+([A-Z][a-z]+)\b"),
)
_NOT_NAMES = frozenset({"Mr", "Mrs", "Ms", "Dr", "There", "Everyone", "Folks", "The", "An", "Your"})
_SPECIES_WORDS: tuple[tuple[str, str], ...] = (
    (
        "canine",
        r"dog|canine|puppy|labrador|spaniel|retriever|terrier|poodle|bulldog|shepherd|"
        r"dachshund|beagle|husky|collie|chihuahua",
    ),
    ("feline", r"cat|feline|kitten|shorthair|longhair|siamese|persian|tabby|ragdoll|maine coon"),
)
_APPT_LABEL = {
    "general": "general consult",
    "wellness": "wellness exam",
    "sick": "sick visit",
    "recheck": "recheck",
    "dental": "dental consult",
    "surgery": "surgery",
    "euthanasia": "euthanasia",
    "emergency": "emergency visit",
    "phone": "phone consult",
    "other": "consult",
}
_PROBLEM_RE = re.compile(
    r"\b(lost|losing|shaking|scratching|scratch|itch\w*|vomit\w*|limp\w*|cough\w*|sneez\w*|"
    r"discharge|smelly|breath|drinking more|eating more|not eating|diarrh\w+|bleeding|lethargic|"
    r"painful|pain|swollen|swelling|lump|worse|yelped|licks?|paws?|drops? food|weight loss|"
    r"trouble|infection|squint\w*|limping|collapsed|seizure\w*)\b",
    re.I,
)
_LEAD_PRONOUN_RE = re.compile(
    r"^(?:I (?:think|noticed|have noticed|feel|see|saw)\s+(?:that\s+)?)?"
    r"(?:he|she|they|it)(?:'s| is| has been| has| was| have)\s+(?:been\s+)?",
    re.I,
)
_LOWER_LEADS = frozenset(
    {"His", "Her", "Their", "Its", "He", "She", "They", "The", "A", "My", "Our"}
)

# -- drug mentions --------------------------------------------------------------------------
_DRUG_RE = re.compile(
    r"\b([a-z]{3,}(?:profen|cillin|mycin|icam|pril|dan|pam|azole|floxacin|sone|solone|pentin|"
    r"phine|pitant|barbital|statin|thyroxine|ide|oxib|vecin))\b",
    re.I,
)
_DRUG_STOP = frozenset({"inside", "outside", "provide", "decide", "wide", "guide", "side", "ride"})
_DOSE_RE = re.compile(
    r"(?:\d+(?:\.\d+)?|" + _NUM_WORDS + r")\s+(?:\w+\s+){0,3}?"
    r"(?:mg|milligrams?|ml|milliliters?|mcg|micrograms?|tablets?|drops?|units?|cc|capsules?)\b",
    re.I,
)


@dataclass(frozen=True)
class _Sentence:
    text: str
    owner: bool


def _split(transcript: str) -> list[_Sentence]:
    """Every sentence with its speaker role; nothing filtered."""
    out: list[_Sentence] = []
    for line in transcript.splitlines():
        owner = False
        m = _SPEAKER_RE.match(line)
        if m:
            who = m.group("who").lower()
            owner = who.startswith(_OWNER_ROLES) or "(owner)" in who
            line = line[m.end() :]
        line = _ABBREV_RE.sub(r"\1§", line)
        for part in re.split(r"(?<=[.!?])\s+", line):
            text = " ".join(part.replace("§", ".").split())
            if text:
                out.append(_Sentence(text, owner))
    return out


def _normalize(text: str) -> str:
    """Drop leading filler words ("Okay,", "So", "Yes,")."""
    prev = None
    while prev != text:
        prev = text
        text = _LEAD_FILLER_RE.sub("", text).strip()
    return text[:1].upper() + text[1:] if text else text


def _is_vitals_sentence(text: str) -> bool:
    hits = sum(1 for p in _VITAL_RES if p.search(text))
    return hits >= 2 or (hits == 1 and len(text.split()) <= 8)


def _content_sentences(sentences: list[_Sentence], *, drop_vitals: bool) -> list[_Sentence]:
    """Sentences usable as narrative: no questions, greetings or fragments."""
    out: list[_Sentence] = []
    for s in sentences:
        text = _normalize(s.text)
        if (
            not text
            or text.endswith("?")
            or _GREETING_RE.match(text)
            or len(text.split()) < 4
            or (drop_vitals and _is_vitals_sentence(text))
        ):
            continue
        out.append(_Sentence(text, s.owner))
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


_KIND_WORDS: dict[str, tuple[str, ...]] = {
    "history": (
        "history",
        "subjective",
        "complaint",
        "concern",
        "interval",
        "reason",
        "caller",
        "why",
    ),
    "plan": (
        "plan",
        "treatment",
        "advice",
        "disposition",
        "home",
        "next",
        "medication",
        "follow",
        "counselling",
        "care",
        "vaccin",
        "parasite",
        "prevention",
    ),
    "assess": ("assessment", "diagnos", "problem", "triage", "differential", "think"),
    "exam": ("exam", "objective", "findings", "oral", "focused", "anesthe", "closure", "procedure"),
}
_CUES: dict[str, re.Pattern[str]] = {
    "plan": re.compile(
        r"^(?:i recommend|my recommendation|i'd (?:like|also like)|we(?:'ll| will)|please|use|"
        r"keep|start|give|bring|continue|fasting)\b|\b(?:recheck|dispense|prescribe|"
        r"booster|vaccine|blood panel|twice daily)\b",
        re.I,
    ),
    "assess": re.compile(
        r"\b(?:suspect|consistent with|likely|differential|suspicious|looks like|"
        r"on the list|down almost)\b",
        re.I,
    ),
    "exam": re.compile(
        r"\b(?:i (?:hear|feel|see|can feel)|palpation|soft|clear|erythema|exam shows|"
        r"swollen|looks|visible|canal)\b",
        re.I,
    ),
}


def _kind(section: Section) -> str:
    probe = f"{section.id} {section.title}".lower()
    for kind, words in _KIND_WORDS.items():
        if any(w in probe for w in words):
            return kind
    return ""


def _score(sent: _Sentence, section: Section, kws: set[str], kind: str) -> int:
    toks = set(_WORD_RE.findall(sent.text.lower()))
    title = {w for w in _WORD_RE.findall(section.title.lower()) if w not in _STOPWORDS}
    score = len(toks & kws) + 2 * len(toks & title)
    if kind == "history":
        score += 2 if sent.owner else -1
    elif kind and sent.owner:
        score -= 1
    cue = _CUES.get(kind)
    if cue and cue.search(sent.text):
        score += 2
    return score


def _assign(sentences: list[_Sentence], sections: list[Section]) -> dict[str, list[str]]:
    """Give each sentence to the single best-scoring narrative section (ties: earliest)."""
    kws = {s.id: _keywords(s) for s in sections}
    kinds = {s.id: _kind(s) for s in sections}
    scored: dict[str, list[tuple[int, int, str]]] = {s.id: [] for s in sections}
    for idx, sent in enumerate(sentences):
        best_id, best = None, 1  # a sentence needs a score of at least 2 to be used
        for sec in sections:
            score = _score(sent, sec, kws[sec.id], kinds[sec.id])
            if score > best:
                best_id, best = sec.id, score
        if best_id is not None:
            scored[best_id].append((best, idx, sent.text))
    out: dict[str, list[str]] = {}
    for sec in sections:
        limit = 3 if sec.format == "paragraph" else 5
        top = sorted(scored[sec.id], key=lambda t: (-t[0], t[1]))[:limit]
        out[sec.id] = [t[2] for t in sorted(top, key=lambda t: t[1])]
    return out


# -- key/value extraction -------------------------------------------------------------------


def _first(patterns: tuple[re.Pattern[str], ...], texts: list[str]) -> re.Match[str] | None:
    for pat in patterns:
        for t in texts:
            m = pat.search(t)
            if m:
                return m
    return None


def _weight(texts: list[str]) -> str:
    """Today's weight: a value near today/now/currently/weighs, else the last mention."""
    current: list[str] = []
    anywhere: list[str] = []
    for t in texts:
        marks = [m.start() for m in _WEIGHT_NOW_RE.finditer(t)]
        found = [
            (
                m.start(),
                f"{m.group(1)} {'lb' if m.group(2).lower().startswith(('lb', 'pound')) else 'kg'}",
            )
            for m in _WEIGHT_RE.finditer(t)
        ]
        anywhere += [v for _, v in found]
        if marks and found:
            current.append(min(found, key=lambda f: min(abs(f[0] - k) for k in marks))[1])
    if current:
        return current[-1]
    return anywhere[-1] if anywhere else ""


def _temperature(texts: list[str]) -> str:
    ordered = [t for t in texts if re.search(r"\btemp", t, re.I)] + texts
    for t in ordered:
        m = _TEMP_UNIT_RE.search(t)
        if m:
            unit = (m.group(2) or m.group(4) or m.group(3) or "F")[0].upper()
            return f"{m.group(1)}°{unit}"
    for t in texts:
        m = _TEMP_WORD_RE.search(t)
        if m:
            return f"{m.group(1)}°"
    return ""


def _generic(label: str, key: str, text: str) -> str:
    """ "<label> is/was/of/: <up to 6 words>" else empty. Never dumps a whole sentence."""
    for name in dict.fromkeys([label.strip(), key.replace("_", " ")]):
        if not name:
            continue
        m = re.search(
            re.escape(name)
            + r"\s*(?:is|was|of|:)\s+((?:(?:\d+\.\d+|[\w'/\-]+)\s+){0,5}(?:\d+\.\d+|[\w'/\-]+))",
            text,
            re.I,
        )
        if m:
            return m.group(1).strip()
    return ""


def _extract_field(key: str, label: str, texts: list[str], transcript: str) -> str:
    probe = f"{key} {label}".lower()
    if "weight" in probe or key in {"wt", "bw"}:
        return _weight(texts)
    if "temp" in probe or key == "t":
        return _temperature(texts)
    if "heart" in probe or key == "hr":
        m = _first(_HR_RES, texts)
        return f"{m.group(1)} bpm" if m else ""
    if "resp" in probe or key == "rr":
        m = _first(_RR_RES, texts)
        return f"{m.group(1)} breaths/min" if m else ""
    if "bcs" in probe or "body condition" in probe:
        m = _first(_BCS_RES, texts)
        return f"{m.group(1)}/9" if m else ""
    if key == "crt" or "capillary" in probe:
        m = _first((_CRT_RE,), texts)
        return " ".join(m.group(1).split()) if m else ""
    if key == "mm" or "mucous" in probe:
        m = _first((_MM_RE,), texts)
        return re.sub(r"[\s,&]+$|\s+and$", "", " ".join(m.group(1).split()).lower()) if m else ""
    if "pain" in probe:
        for t in texts:
            if "pain" not in t.lower():
                continue
            m = _PAIN_RES[0].search(t) or _PAIN_RES[1].search(t)
            if m:
                return f"{m.group(1)}/{m.group(2)}" if m.group(2) else m.group(1)
        return ""
    if "asa" in probe:
        m = _first((_ASA_RE,), texts)
        roman = {"one": "I", "two": "II", "three": "III", "four": "IV", "five": "V"}
        roman |= {"1": "I", "2": "II", "3": "III", "4": "IV", "5": "V"}
        return roman.get(m.group(1).lower(), m.group(1).upper()) if m else ""
    return _generic(label, key, transcript)


# -- section builders -----------------------------------------------------------------------


def _mock_section(
    section: Section, picked: list[str], texts: list[str], transcript: str
) -> dict[str, Any]:
    out: dict[str, Any] = {"not_discussed": False, "used_defaults": False}
    defaults = section.normal_defaults.strip()
    use_defaults = section.missing_behavior == "use_normal_defaults" and bool(defaults)
    if section.format == "key_value":
        values = {f.key: _extract_field(f.key, f.label, texts, transcript) for f in section.fields}
        out["fields"] = values
        out["not_discussed"] = not any(values.values())
        return out
    rest = f"Other systems not mentioned: {defaults}"
    if section.format == "paragraph":
        text = " ".join(picked)
        if use_defaults:
            text = f"{text} {rest}" if text else defaults
            out["used_defaults"] = True
        out["content"] = text
        out["not_discussed"] = not text
    else:
        items = list(picked)
        if use_defaults:
            items = [*items, rest] if items else [defaults]
            out["used_defaults"] = True
        out["items"] = items
        out["not_discussed"] = not items
    return out


def _infer_name(transcript: str) -> str:
    plain = "\n".join(_SPEAKER_RE.sub("", ln) for ln in transcript.splitlines())
    for pat in _NAME_RES:
        for m in pat.finditer(plain):
            if m.group(1) not in _NOT_NAMES:
                return m.group(1)
    return ""


def _infer_species(transcript: str) -> str:
    for species, words in _SPECIES_WORDS:
        if re.search(rf"\b(?:{words})s?\b", transcript, re.I):
            return species
    return ""


def _reason(sentences: list[_Sentence], fallback: list[_Sentence]) -> str:
    """First owner-reported problem clause (at most 90 characters)."""
    best: tuple[int, str] = (0, "")
    for s in sentences:
        text = _normalize(s.text)
        if not s.owner or text.endswith("?") or text.lower().startswith("no "):
            continue
        score = len(_PROBLEM_RE.findall(text))
        if score > best[0]:
            best = (score, text)
    text = best[1] or (fallback[0].text if fallback else "consultation recorded")
    text = _LEAD_PRONOUN_RE.sub("", text, count=1)
    text = re.split(r"[,;.]\s|[.!]$", text)[0].strip(" .,;")
    if text.split(" ", 1)[0] in _LOWER_LEADS:
        text = text[0].lower() + text[1:]
    if len(text) > 90:
        text = text[:90].rsplit(" ", 1)[0].rstrip(" ,;")
    return text or "consultation recorded"


def _visit_summary(
    template: Template,
    transcript: str,
    patient: Patient,
    sentences: list[_Sentence],
    fallback: list[_Sentence],
) -> str:
    name = patient.name.strip() or _infer_name(transcript) or "Patient"
    species = patient.species.strip().lower() or _infer_species(transcript)
    who = f"{name}, {species}" if species else name
    label = _APPT_LABEL.get(template.appointment_type, "consult")
    summary = f"{who}: {label} \u2014 {_reason(sentences, fallback)}"
    return summary if len(summary) <= 160 else summary[:157].rstrip() + "..."


def _action_items(sentences: list[_Sentence]) -> list[str]:
    out: list[str] = []
    for s in sentences:
        if s.text.endswith("?") or not _ACTION_RE.search(s.text) or _ACTION_SKIP_RE.search(s.text):
            continue
        text = _normalize(s.text).rstrip(".!")
        if len(text.split()) >= 3 and text not in out:
            out.append(text[:300])
    return out[:6]


def _review_flags(sentences: list[_Sentence]) -> list[str]:
    flags = ["Generated by the offline mock generator - verify all content against the transcript."]
    drugs: dict[str, bool] = {}
    for s in sentences:
        has_dose = bool(_DOSE_RE.search(s.text))
        for m in _DRUG_RE.finditer(s.text):
            word = m.group(1)
            if word.lower() in _DRUG_STOP:
                continue
            drugs[word.lower()] = drugs.get(word.lower(), False) or has_dose
    flags.extend(f"Confirm dose for: {d}" for d, dosed in drugs.items() if not dosed)
    return flags[:6]


def build_mock_output(template: Template, transcript: str, patient: Patient) -> dict[str, Any]:
    sentences = _split(transcript)
    texts = [s.text for s in sentences]
    has_kv = any(s.format == "key_value" for s in template.sections)
    content = _content_sentences(sentences, drop_vitals=has_kv)
    narrative = [s for s in template.sections if s.format != "key_value"]
    assigned = _assign(content, narrative)
    sections = {
        s.id: _mock_section(s, assigned.get(s.id, []), texts, transcript) for s in template.sections
    }
    return {
        "visit_summary": _visit_summary(template, transcript, patient, sentences, content),
        "sections": sections,
        "action_items": _action_items(sentences),
        "review_flags": _review_flags(sentences),
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
        deadline: float | None = None,
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
