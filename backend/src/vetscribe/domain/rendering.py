"""Render a completed note as Markdown / plain text (for copy-to-PIMS)."""

from __future__ import annotations

from vetscribe.domain.models import NoteResult, ResultSection, Template

NOT_DISCUSSED = "Not discussed."


def _is_empty(sec: ResultSection) -> bool:
    if sec.format == "paragraph":
        return not sec.content.strip()
    if sec.format == "bullets":
        return not any(i.strip() for i in sec.items)
    return not any(f.value.strip() for f in sec.fields)


def _section_body(sec: ResultSection) -> str:
    if sec.format == "paragraph":
        return sec.content.strip()
    if sec.format == "bullets":
        return "\n".join(f"- {i.strip()}" for i in sec.items if i.strip())
    return "\n".join(f"{f.label}: {f.value.strip()}" for f in sec.fields if f.value.strip())


def _visible(result: NoteResult, template: Template | None) -> list[tuple[ResultSection, str]]:
    """Sections to display with their body text, applying missing_behavior."""
    behaviors = {s.id: s.missing_behavior for s in template.sections} if template else {}
    out: list[tuple[ResultSection, str]] = []
    for sec in result.sections:
        if sec.not_discussed or _is_empty(sec):
            if behaviors.get(sec.section_id, "state_not_discussed") == "omit":
                continue
            out.append((sec, NOT_DISCUSSED))
        else:
            out.append((sec, _section_body(sec)))
    return out


def render_note_markdown(result: NoteResult, template: Template | None = None) -> str:
    blocks: list[str] = []
    if result.visit_summary.strip():
        blocks.append(f"_{result.visit_summary.strip()}_")
    for sec, body in _visible(result, template):
        heading = f"## {sec.title}" + (" (defaults - confirm)" if sec.used_defaults else "")
        blocks.append(f"{heading}\n{body}")
    if result.action_items:
        blocks.append("## Action items\n" + "\n".join(f"- [ ] {a}" for a in result.action_items))
    if result.review_flags:
        blocks.append("## Review flags\n" + "\n".join(f"- {f}" for f in result.review_flags))
    return "\n\n".join(blocks).strip() + "\n"


def render_note_text(result: NoteResult, template: Template | None = None) -> str:
    blocks: list[str] = []
    if result.visit_summary.strip():
        blocks.append(result.visit_summary.strip())
    for sec, body in _visible(result, template):
        suffix = " (defaults - confirm)" if sec.used_defaults else ""
        blocks.append(f"{sec.title.upper()}{suffix}\n{body}")
    if result.action_items:
        blocks.append("ACTION ITEMS\n" + "\n".join(f"- {a}" for a in result.action_items))
    if result.review_flags:
        blocks.append("REVIEW FLAGS\n" + "\n".join(f"- {f}" for f in result.review_flags))
    return "\n\n".join(blocks).strip() + "\n"
