# VetScribe — UI design direction (v1.1)

Produced from a UI/UX review of v1 that used two skills: `ui-ux-pro-max` (UX rule
database and design-system search) and `frontend-design` (avoiding generic,
templated choices). Screenshots of v1 were reviewed against both.

## Brief

* **Subject:** veterinary clinical records.
* **Audience:** vets and vet techs, usually between appointments, often standing,
  under time pressure. Accuracy matters more than delight.
* **Primary job:** get a trustworthy draft record entry, check what the AI wasn't
  sure about, then paste it into the practice-management system (PIMS).

## What the review found in v1

| # | Finding | Source rule |
|---|---|---|
| 1 | The generated note is cut into 9 identical rounded cards with the same shadow, so it reads as a dashboard rather than a medical record | frontend-design: "SaaS-card kit" tell |
| 2 | All-caps eyebrow labels ("VISIT SUMMARY", "ACTION ITEMS") | frontend-design: template chrome |
| 3 | Format badges ("Paragraph", "Key value") on every note section expose system internals to clinicians | frontend-design §writing: name things by what users understand |
| 4 | Note body lines run to about 110 characters | frontend-design: line length < 80ch |
| 5 | Inter, the default UI face, gives no help with dose legibility (Il1, O0) | ui-ux-pro-max design-system → Atkinson Hyperlegible for healthcare |
| 6 | Review flags sit mid-page and scroll away; follow-ups at the bottom | ui-ux-pro-max: feedback/visibility |
| 7 | Loading a sample transcript silently switches the template the user picked | ui-ux-pro-max: no surprise state changes |
| 8 | The template editor exposes "Section id" and "Instructions for the AI" as primary fields | frontend-design §writing |
| 9 | The 9-card template picker is visually heavy for a choice made in two seconds | frontend-design: SaaS-card kit |
| 10 | Generation status needs `role="status"` / `aria-busy`, and errors need `role="alert"` | ui-ux-pro-max: a11y "Loading Indicators", "Error Messages" |

The ui-ux-pro-max `--design-system` result suggested *Hero + Testimonials* and
*Neumorphism*. Both were **rejected**. The first is a marketing-page pattern, and
the skill itself flags the second as high accessibility risk. Only the typeface
and the clinical-green direction were kept.

## Design plan

### Concept: "the record sheet"
The one memorable element is the **note itself**, rendered as a single
continuous record sheet, like a page in a patient chart. Section headings sit in a
left margin column with ruled lines between entries, and annotations ("check
before filing", "normal defaults: confirm") sit in the margin beside the entry
they refer to. Everything around the sheet stays quiet: plain chrome, few
borders, no decorative shadows.

### Color (named)
| Name | Light | Dark | Role |
|---|---|---|---|
| Drape green | `#2F6B4F` | `#7FC3A0` | Primary actions, selection, links. Named after surgical drapes, which belong to the subject and differ from the generic SaaS teal. |
| Ink | `#1E2A28` | `#E6ECE9` | Text |
| Exam table | `#EEF2EF` | `#121816` | App background |
| Sheet | `#FFFFFF` | `#1A211F` | Record sheet and inputs |
| Rule | `#D5DCD8` | `#2E3834` | Hairlines between record entries |
| Flag amber | `#8A5300` on `#FCF1DA` | `#F2C46D` on `#2D2414` | "Check before filing" annotations and defaults badges |
| Alert red | `#B42318` | `#F97066` | Destructive actions and failures |

All text/background pairs must meet WCAG AA (4.5:1).

### Type
* **Atkinson Hyperlegible Next** (self-hosted via `@fontsource`, so the app makes
  no third-party font requests): all UI and note text. It was designed for
  character disambiguation, which matters for doses.
* **Atkinson Hyperlegible Mono**: only for raw source text (the transcript box and
  the "Original transcript" view). The visual difference marks it as raw input,
  not the composed record.
* Scale: 1.2 ratio from 16px (13.3 / 16 / 19.2 / 23 / 27.6 / 33). Note body
  16/1.6, `max-width: 68ch`. Sentence case everywhere, no all-caps labels.

### Layout

```
Note page (≥ 1100px)
┌ Notes / Biscuit ─────────────────────────────────────────────────────────────┐
│ Biscuit                                    [Copy note] [Edit] [More ▾]       │
│ Labrador Retriever, 6 years, male neutered, 34.2 kg                          │
│ Sick visit · drafted 20 Nov 2026, 18:26 · ● Completed                        │
├──────────────────────────────────────────────────────┬───────────────────────┤
│ ┌ record sheet ─────────────────────────────────────┐│ Check before filing (2)│
│ │ Summary      │ Biscuit seen for 3 weeks of …       ││ ▸ Carprofen dose …    │
│ │──────────────┼─────────────────────────────────────││ ▸ Physical exam uses  │
│ │ Presenting   │ Head shaking and scratching …  copy ││   normal defaults     │
│ │ complaint    │                                     ││                       │
│ │──────────────┼─────────────────────────────────────││ Follow-ups            │
│ │ Vitals       │ T 101.6 °F   HR not stated  …       ││ ☐ Recheck in 2 weeks  │
│ │──────────────┼─────────────────────────────────────││                       │
│ │ Physical     │ ⚑ normal defaults, confirm          ││ (rail is sticky)      │
│ │ exam         │ …                                   ││                       │
│ └───────────────────────────────────────────────────┘│                       │
│ ▸ Original transcript                                │                       │
│ mock-v1 · 551 in / 462 out tokens · 2.5 s            │                       │
└──────────────────────────────────────────────────────┴───────────────────────┘
< 1100px: rail moves above the sheet. < 640px: margin headings stack above entries.
```

* Left-aligned throughout. Record-entry text is ragged-right, never justified.
* Vitals and other `key_value` sections render as an inline grid of
  `label value` pairs (2–4 columns). An empty value shows a muted "not stated"
  instead of being hidden, because absence is clinical information.
* New note: keep the numbered 1 → 2 → 3 steps, since that really is a sequence.
  The template picker becomes a compact list of radio rows (name + one-line
  description, selected row marked by a drape-green left bar) in 2 columns on
  wide screens.
* Template editor: the preview pane reuses the **same record-sheet component**,
  so "what you configure" and "what you get" look identical. Section id moves
  into an "Advanced" disclosure, and "Instructions for the AI" is renamed
  "What to capture".

### Principles
1. **The record sheet is the hero.** Spend visual boldness there and nowhere else.
2. **Uncertainty is never hidden.** Flags and defaults sit beside the content
   they refer to and are summarised in the rail.
3. **Say it in clinic language.** "Follow-ups", not "action items". "Check before
   filing", not "review_flags". No format names.
4. **One motion moment:** when a draft finishes, the skeleton cross-fades into the
   sheet (200 ms, disabled under `prefers-reduced-motion`). No other ambient motion.
5. **Radius by hierarchy:** sheet 10px, inputs/buttons 6px, chips fully rounded.
   Shadows only on overlays (menus, dialogs, toasts).

### Plan check against the brief
* *Teal accent on grey:* this was the first-instinct default for "healthcare
  SaaS". It was **revised** to drape green on exam-table grey, which comes from
  the clinic itself.
* *Hairline rules:* this risks the "broadsheet" default. It is **kept
  deliberately** because ruled entries are the native form of a medical record
  card, applied only inside the sheet. Radius stays at 10px, not zero.
* *Mono face:* this risks the "mono for data labels" tell. It is **limited** to
  raw transcript text, where it carries meaning (source vs. record).
* *Cards everywhere:* **removed** from the note. Remaining surfaces (forms, lists)
  share one quiet surface style.
