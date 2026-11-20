"""Deterministic graders: one pure function per metric returning ``(score | None, details)``.

``None`` means "not applicable" (nothing was expected), never "failed". Text is normalised
(spec section 3) before matching; matching is word-start anchored so ``yeast`` matches
``yeasts`` but ``cat`` does not match ``location``.
"""

from __future__ import annotations

import re
from typing import Any

from vetscribe.domain.models import NoteResult, ResultSection, Template
from vetscribe.evals.models import EvalCase

GraderOutput = tuple[float | None, dict[str, Any]]

# ----------------------------------------------------------------------------- normalisation

_NUM_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90,
}  # fmt: skip
_TENS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety"
_ONES = "one|two|three|four|five|six|seven|eight|nine"
_COMPOSITE_RE = re.compile(rf"\b({_TENS})[\s-]({_ONES})\b")
_WORD_RE = re.compile(r"\b(" + "|".join(sorted(_NUM_WORDS, key=len, reverse=True)) + r")\b")

_UNIT_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(p), r)
    for p, r in [
        (r"\b(?:kilograms?|kilos?|kgs)\b", "kg"),
        (r"\b(?:pounds?|lbs)\b", "lb"),
        (r"°\s*f\b|\bdegrees?\s+f(?:ahrenheit)?\b|\bfahrenheit\b", "f"),
        (r"°\s*c\b|\bdegrees?\s+c(?:elsius)?\b|\bcelsius\b", "c"),
        (r"\bbeats?\s*(?:per|/)\s*min(?:ute)?s?\b", "bpm"),
        (r"\bbreaths?\s*(?:per|/)\s*min(?:ute)?s?\b|\bbrpm\b", "breaths/min"),
        (r"\bmilligrams?\b", "mg"),
        (r"\b(?:micrograms?|µg|ug)\b", "mcg"),
        (r"\b(?:milliliters?|millilitres?|mls|mils?)\b", "ml"),
        (r"\b(?:grams?|gms?)\b", "g"),
        (r"\b(?:seconds?|secs?)\b", "s"),
        (r"\b(mg|mcg|ml|g)\s*(?:per|/)\s*(kg|lb)\b", r"\1/\2"),
        (r"(\d)\s*(?:percent|%)", r"\1%"),
        (r"(\d+)\s+out\s+of\s+(\d+)", r"\1/\2"),
        (r"(\d)\s*/\s*(\d)", r"\1/\2"),
        (r"\b(?:under|less than)\s+(?=\d)", "<"),
        (r"<\s+(?=\d)", "<"),
        (r"\ba\.m\.?", "am"),
        (r"\bp\.m\.?", "pm"),
        (r"(\d)\s*(am|pm)\b", r"\1 \2"),
        (r"(?<=[a-z0-9])-(?=[a-z0-9])", " "),
    ]
]
_ROMAN = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5"}
_NUMERIC_RE = re.compile(
    r"^(?P<cmp>[<>~]?)\s*(?P<num>-?\d+(?:\.\d+)?)\s*(?P<unit>[a-z%]+(?:/[a-z]+)?)?$"
)


def normalize_text(s: str) -> str:
    """Lower-case, unify units, spell numbers as digits, collapse whitespace."""
    t = s.lower()
    t = _COMPOSITE_RE.sub(lambda m: str(_NUM_WORDS[m.group(1)] + _NUM_WORDS[m.group(2)]), t)
    t = _WORD_RE.sub(lambda m: str(_NUM_WORDS[m.group(1)]), t)
    for pat, repl in _UNIT_RULES:
        t = pat.sub(repl, t)
    return re.sub(r"\s+", " ", t).strip()


def normalize_value(s: str) -> str:
    """Canonical form of a key_value field value (spec section 3)."""
    t = normalize_text(s)
    t = re.sub(r"[,;]", " ", t)
    t = re.sub(r"\b(?:and)\b", " ", t)
    t = re.sub(r"\s+", " ", t).strip().rstrip(".").strip()
    m = re.match(r"^(?:asa\s+)?(?:(?:class|grade|status)\s+)?([ivx]+|\d)$", t)
    if m:
        return _ROMAN.get(m.group(1), m.group(1))
    return t


def values_match(expected: str, got: str) -> bool:
    """Exact comparison after normalisation; numbers compare numerically.

    ``""`` expected means "must be empty"; an empty value never matches a non-empty expectation.
    """
    e, g = normalize_value(expected), normalize_value(got)
    if not e or not g:
        return e == g
    me, mg = _NUMERIC_RE.match(e), _NUMERIC_RE.match(g)
    if me and mg:
        return (
            me["cmp"] == mg["cmp"]
            and abs(float(me["num"]) - float(mg["num"])) < 1e-9
            and (me["unit"] or "") == (mg["unit"] or "")
        )
    return e == g


def find_term(haystack_norm: str, term: str) -> re.Match[str] | None:
    """Word-start anchored search of ``term`` (normalised here) in an already-normalised text."""
    nt = normalize_text(term)
    if not nt:
        return None
    return re.search(r"(?<![a-z0-9])" + re.escape(nt), haystack_norm)


# ----------------------------------------------------------------------------- note text


def section_text(sec: ResultSection) -> str:
    parts = [sec.content, *sec.items, *(f.value for f in sec.fields)]
    return "\n".join(p for p in parts if p.strip())


def _strip_defaults(text: str, defaults: str) -> str:
    """Drop sentences copied from a section's normal-defaults text (they are not findings)."""
    known = {normalize_text(x) for x in _SENT_SPLIT.split(defaults) if x.strip()}
    keep = [x for x in _SENT_SPLIT.split(text) if x.strip() and normalize_text(x) not in known]
    return "\n".join(keep)


def _parts(
    note: NoteResult, *, include_flags: bool, template: Template | None = None
) -> list[tuple[str, str]]:
    parts = [("visit_summary", note.visit_summary)]
    defaults = {s.id: s.normal_defaults for s in template.sections} if template else {}
    for sec in note.sections:
        text = section_text(sec)
        if sec.used_defaults and defaults.get(sec.section_id):
            text = _strip_defaults(text, defaults[sec.section_id])
        parts.append((sec.section_id, text))
    parts.append(("action_items", "\n".join(note.action_items)))
    if include_flags:
        parts.append(("review_flags", "\n".join(note.review_flags)))
    return [(name, normalize_text(text)) for name, text in parts]


def _snippet(text: str, m: re.Match[str], width: int = 40) -> str:
    return text[max(0, m.start() - width) : m.end() + width].strip()


# ----------------------------------------------------------------------------- graders


def grade_schema_valid(valid: bool) -> GraderOutput:
    return (1.0 if valid else 0.0), {}


def grade_field_accuracy(case: EvalCase, note: NoteResult) -> GraderOutput:
    exps = case.expectations.fields
    if not exps:
        return None, {"field_mismatches": []}
    secs = {s.section_id: s for s in note.sections}
    mismatches: list[dict[str, str]] = []
    ok = 0
    for fe in exps:
        sec = secs.get(fe.section_id)
        got = next((f.value for f in sec.fields if f.key == fe.key), "") if sec else ""
        if values_match(fe.expected, got):
            ok += 1
        else:
            mismatches.append(
                {"section_id": fe.section_id, "key": fe.key, "expected": fe.expected, "got": got}
            )
    return ok / len(exps), {"field_mismatches": mismatches}


def grade_fact_recall(
    case: EvalCase, note: NoteResult, template: Template | None = None
) -> GraderOutput:
    """Facts must come from findings: normal-defaults boilerplate does not count."""
    facts = case.expectations.facts
    if not facts:
        return None, {"missed_facts": []}
    parts = dict(_parts(note, include_flags=False, template=template))
    anywhere = "\n".join(parts.values())
    missed: list[str] = []
    for fact in facts:
        text = anywhere if fact.section_id is None else parts.get(fact.section_id, "")
        if not any(find_term(text, t) for t in fact.any_of):
            missed.append(fact.id)
    return (len(facts) - len(missed)) / len(facts), {"missed_facts": missed}


def grade_hallucination_free(case: EvalCase, note: NoteResult) -> GraderOutput:
    forb = case.expectations.forbidden
    if not forb:
        return None, {"forbidden_found": []}
    parts = _parts(note, include_flags=True)
    found: list[dict[str, Any]] = []
    for item in forb:
        for term in item.any_of:
            for name, text in parts:
                m = find_term(text, term)
                if m:
                    found.append(
                        {
                            "id": item.id,
                            "term": term,
                            "section_id": name,
                            "snippet": _snippet(text, m),
                        }
                    )
    return (0.0 if found else 1.0), {"forbidden_found": found}


def _raw_used_defaults(raw: dict[str, Any] | None, section_id: str) -> bool | None:
    if raw is None:
        return None
    sec = (raw.get("sections") or {}).get(section_id)
    if not isinstance(sec, dict):
        return None
    return bool(sec.get("used_defaults"))


def grade_missing_data(
    case: EvalCase, note: NoteResult, raw: dict[str, Any] | None = None
) -> GraderOutput:
    """``not_discussed`` sections must stay empty; ``defaults_expected`` sections must be
    default-filled *and* the model must have declared ``used_defaults`` (the post-processor
    fills defaults for any empty section, so the raw flag is what shows the model followed
    the template contract)."""
    ex = case.expectations
    total = len(ex.not_discussed) + len(ex.defaults_expected)
    if total == 0:
        return None, {"not_discussed_errors": []}
    secs = {s.section_id: s for s in note.sections}
    errors: list[str] = []
    for sid in ex.not_discussed:
        sec = secs.get(sid)
        if sec is None or not sec.not_discussed or sec.used_defaults or section_text(sec):
            errors.append(f"{sid}: expected not discussed")
    for sid in ex.defaults_expected:
        sec = secs.get(sid)
        declared = _raw_used_defaults(raw, sid)
        if sec is None or not sec.used_defaults or sec.not_discussed or declared is False:
            errors.append(f"{sid}: expected normal defaults")
    return (total - len(errors)) / total, {"not_discussed_errors": errors}


def _keyword_recall(items: list[Any], haystack: list[str], key: str) -> GraderOutput:
    if not items:
        return None, {key: []}
    text = normalize_text("\n".join(haystack))
    missing = [i.id for i in items if not any(find_term(text, t) for t in i.any_of)]
    return (len(items) - len(missing)) / len(items), {key: missing}


def grade_flag_recall(case: EvalCase, note: NoteResult) -> GraderOutput:
    return _keyword_recall(case.expectations.review_flags, note.review_flags, "missing_flags")


def grade_action_recall(case: EvalCase, note: NoteResult) -> GraderOutput:
    return _keyword_recall(case.expectations.action_items, note.action_items, "missing_actions")


# ----------------------------------------------------------------------------- faithfulness

_STOPWORDS = frozenset(
    [
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "been",
        "being",
        "but",
        "by",
        "can",
        "could",
        "did",
        "do",
        "does",
        "for",
        "from",
        "had",
        "has",
        "have",
        "he",
        "her",
        "his",
        "i",
        "if",
        "in",
        "into",
        "is",
        "it",
        "its",
        "may",
        "might",
        "no",
        "not",
        "of",
        "on",
        "or",
        "our",
        "she",
        "should",
        "so",
        "than",
        "that",
        "the",
        "their",
        "them",
        "then",
        "there",
        "these",
        "they",
        "this",
        "to",
        "too",
        "was",
        "we",
        "were",
        "what",
        "when",
        "which",
        "while",
        "who",
        "will",
        "with",
        "would",
        "you",
        "your",
        "also",
        "about",
        "after",
        "before",
        "over",
        "under",
        "up",
        "down",
        "out",
        "off",
        "all",
        "any",
        "each",
        "more",
        "most",
        "some",
        "such",
        "only",
        "own",
        "same",
        "very",
        "just",
        "per",
        "via",
    ]
)
# Scaffolding words a note uses that a transcript rarely contains verbatim.
_SCAFFOLD = frozenset(
    [
        "patient",
        "owner",
        "client",
        "reported",
        "reports",
        "report",
        "noted",
        "note",
        "observed",
        "history",
        "presented",
        "presents",
        "today",
        "visit",
        "consult",
        "consultation",
        "exam",
        "examination",
        "finding",
        "findings",
        "recommended",
        "recommend",
        "discussed",
        "discuss",
        "plan",
        "assessment",
        "appears",
        "appeared",
        "consistent",
    ]
)
_TOKEN_RE = re.compile(r"\d+(?:\.\d+)?(?:/\d+)?%?|[a-z]+(?:'[a-z]+)?")
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")


def _covered(tok: str, vocab: set[str]) -> bool:
    """Exact match, or one word is a prefix of the other (plural/inflection tolerant)."""
    if tok in vocab:
        return True
    if tok[0].isdigit():
        return False
    for v in vocab:
        short, long_ = (tok, v) if len(tok) <= len(v) else (v, tok)
        if long_.startswith(short) and (len(short) >= 4 or (len(short) == 3 and len(long_) <= 5)):
            return True
    return False


def _tokens(text: str) -> list[str]:
    out = []
    for tok in _TOKEN_RE.findall(normalize_text(text)):
        if tok[0].isdigit() or (tok not in _STOPWORDS and tok not in _SCAFFOLD):
            out.append(tok)
    return out


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT_SPLIT.split(text) if s.strip()]


def grade_faithfulness(
    case: EvalCase, note: NoteResult, template: Template, threshold: float = 0.6
) -> GraderOutput:
    """Offline proxy: share of note sentences whose content tokens are >= 60% present in the
    transcript (numbers must all match exactly). Default-filled sections may also use that
    section's normal-defaults text. A proxy, not a judge: it cannot see paraphrase or logic."""
    base = set(_tokens(case.transcript)) | set(
        _tokens(" ".join(case.patient.model_dump().values()))
    )
    defaults = {s.id: set(_tokens(s.normal_defaults)) for s in template.sections}
    candidates: list[tuple[str, set[str]]] = [(note.visit_summary, base)]
    for sec in note.sections:
        vocab = base | defaults.get(sec.section_id, set()) if sec.used_defaults else base
        texts = [sec.content, *sec.items, *(f.value for f in sec.fields)]
        candidates += [(t, vocab) for t in texts]
    candidates += [(a, base) for a in note.action_items]

    total = 0
    unsupported: list[str] = []
    for text, vocab in candidates:
        for sentence in _sentences(text):
            toks = _tokens(sentence)
            if not toks:
                continue
            total += 1
            numbers_ok = all(t in vocab for t in toks if t[0].isdigit())
            covered = sum(1 for t in toks if _covered(t, vocab)) / len(toks)
            if not numbers_ok or covered < threshold:
                unsupported.append(sentence)
    if total == 0:
        return None, {"unsupported_sentences": []}
    return (total - len(unsupported)) / total, {"unsupported_sentences": unsupported[:25]}


# ----------------------------------------------------------------------------- aggregate

EMPTY_DETAILS: dict[str, Any] = {
    "missed_facts": [],
    "forbidden_found": [],
    "field_mismatches": [],
    "not_discussed_errors": [],
    "missing_flags": [],
    "missing_actions": [],
    "unsupported_sentences": [],
}


def grade_all(
    case: EvalCase,
    template: Template,
    note: NoteResult,
    raw: dict[str, Any] | None = None,
) -> tuple[dict[str, float | None], dict[str, Any]]:
    scores: dict[str, float | None] = {"schema_valid": 1.0}
    details: dict[str, Any] = {k: list(v) for k, v in EMPTY_DETAILS.items()}
    for metric, (score, det) in (
        ("field_accuracy", grade_field_accuracy(case, note)),
        ("fact_recall", grade_fact_recall(case, note, template)),
        ("hallucination_free", grade_hallucination_free(case, note)),
        ("missing_data_handling", grade_missing_data(case, note, raw)),
        ("flag_recall", grade_flag_recall(case, note)),
        ("action_recall", grade_action_recall(case, note)),
        ("faithfulness_proxy", grade_faithfulness(case, note, template)),
    ):
        scores[metric] = score
        details.update(det)
    return scores, details
