"""Built-in, read-only templates (live in code; merged with custom templates at read time)."""

from __future__ import annotations

from vetscribe.domain.models import FieldDef, Section, Style, Template

_TS = "2025-01-01T00:00:00.000000Z"

PE_DEFAULTS = (
    "BAR. Well hydrated. MM pink and moist, CRT <2 s. Eyes, ears and nose clear/clean, no "
    "discharge. Oral cavity: no gross abnormalities. Peripheral lymph nodes normal size. "
    "Heart: regular rhythm, no murmur or arrhythmia ausculted. Lungs: clear bilaterally, normal "
    "bronchovesicular sounds, no cough elicited. Abdomen: soft, non-painful, no masses or "
    "organomegaly palpated. Musculoskeletal: ambulatory x4, no lameness, joints normal. Skin and "
    "coat: no lesions or ectoparasites noted. Neuro: appropriate mentation, no deficits noted. "
    "Urogenital: no abnormalities noted."
)

PE_INSTRUCTIONS = (
    "Physical examination by body system as stated by the clinician: general appearance/"
    "attitude, hydration, eyes/ears/nose/throat, oral cavity, lymph nodes, cardiovascular, "
    "respiratory, abdomen/GI, urogenital, musculoskeletal, integument, neurologic. Document every "
    "abnormal finding exactly as described, with location and severity. Systems the clinician "
    "did not mention are filled from the normal defaults and flagged for confirmation."
)


def _fields(*items: tuple[str, str, str]) -> list[FieldDef]:
    return [FieldDef(key=k, label=lbl, hint=h) for k, lbl, h in items]


VITALS = _fields(
    ("temperature", "T", "Rectal temperature with unit (F or C)"),
    ("heart_rate", "HR", "bpm; include rhythm/murmur grade only if stated"),
    ("resp_rate", "RR", "breaths/min; note effort or panting if stated"),
    ("weight", "Weight", "kg or lb exactly as stated; include change from last visit if stated"),
    ("bcs", "BCS", "Body condition score, e.g. 5/9"),
    ("mm", "MM", "Mucous membrane colour/moisture"),
    ("crt", "CRT", "Capillary refill time in seconds"),
    ("pain_score", "Pain score", "Pain score and scale used, if stated"),
)


def _vitals_section(title: str = "Objective - Vitals") -> Section:
    return Section(
        id="vitals",
        title=title,
        instructions=(
            "Record the vital signs and measurements exactly as stated. Leave a field blank if "
            "it was not measured or mentioned; never estimate a value."
        ),
        format="key_value",
        fields=VITALS,
        required=True,
        missing_behavior="state_not_discussed",
    )


def _pe_section(section_id: str = "physical_exam") -> Section:
    return Section(
        id=section_id,
        title="Physical Exam",
        instructions=PE_INSTRUCTIONS,
        format="paragraph",
        required=True,
        missing_behavior="use_normal_defaults",
        normal_defaults=PE_DEFAULTS,
    )


def _tpl(
    tid: str,
    name: str,
    description: str,
    appointment_type: str,
    sections: list[Section],
    *,
    species: list[str] | None = None,
    tone: str = "clinical",
    abbreviations: bool = True,
    custom: str = "",
) -> Template:
    return Template.model_validate(
        {
            "id": tid,
            "name": name,
            "description": description,
            "appointment_type": appointment_type,
            "species": species or [],
            "is_builtin": True,
            "sections": [s.model_dump() for s in sections],
            "style": {
                "tone": tone,
                "use_abbreviations": abbreviations,
                "custom_instructions": custom,
            },
            "version": 1,
            "created_at": _TS,
            "updated_at": _TS,
        }
    )


def _s(
    sid: str,
    title: str,
    instructions: str,
    fmt: str = "paragraph",
    *,
    required: bool = True,
    missing: str = "state_not_discussed",
    fields: list[FieldDef] | None = None,
    defaults: str = "",
) -> Section:
    return Section(
        id=sid,
        title=title,
        instructions=instructions,
        format=fmt,
        fields=fields or [],
        required=required,
        missing_behavior=missing,
        normal_defaults=defaults,
    )


_SOAP = _tpl(
    "builtin-soap",
    "SOAP - General Consult",
    "Classic Subjective / Objective / Assessment / Plan note for any general consultation.",
    "general",
    [
        _s(
            "subjective",
            "Subjective",
            "Presenting complaint and history as reported by the owner: onset, duration and "
            "progression, appetite, thirst, vomiting/diarrhoea, urination/defecation, energy, "
            "cough/sneezing, pruritus, lameness, diet, preventive care, current medications and "
            "supplements, relevant past history, travel/exposure. Attribute statements to the "
            "owner. Do not include clinician findings here.",
        ),
        _vitals_section(),
        _pe_section(),
        _s(
            "assessment",
            "Assessment",
            "Problem list with the clinician's diagnoses or differentials, in order of "
            "clinical priority. Keep the clinician's certainty level (suspect / likely / "
            "confirmed). Include a brief rationale only if the clinician gave one.",
            "bullets",
        ),
        _s(
            "plan",
            "Plan",
            "Diagnostics performed or recommended (and whether accepted/declined), treatments "
            "given in clinic, medications dispensed or prescribed (drug, dose, route, frequency, "
            "duration - only if stated), diet/management advice, client communication and "
            "consent, and follow-up/recheck timing.",
            "bullets",
        ),
    ],
    custom="Keep the note concise and scannable; one idea per sentence.",
)

_WELLNESS = _tpl(
    "builtin-wellness",
    "Wellness / Vaccination",
    "Annual or periodic preventive-care exam with vaccines, parasite control and counselling.",
    "wellness",
    [
        _s(
            "history",
            "History",
            "Owner-reported health since last visit, appetite, water intake, elimination, "
            "activity, behaviour concerns, diet and feeding, dental home care, current "
            "medications/supplements, indoor/outdoor and exposure lifestyle, travel.",
        ),
        _vitals_section(),
        _pe_section(),
        _s(
            "vaccines",
            "Vaccinations Administered / Due",
            "Each vaccine given today (product, e.g. DHPP, rabies, Bordetella, FVRCP, FeLV; site "
            "if stated; lot/serial only if stated) and vaccines declined, deferred or coming "
            "due, with the reason when given.",
            "bullets",
        ),
        _s(
            "parasite_prevention",
            "Parasite Prevention & Screening",
            "Heartworm / flea / tick / intestinal parasite prevention products in use, "
            "compliance, tests run today (e.g. heartworm antigen, fecal) and results if "
            "reported, recommendations made.",
            "bullets",
        ),
        _s(
            "assessment",
            "Assessment",
            "Overall health assessment and any problems identified (e.g. weight change, dental "
            "disease, murmur, early signs of osteoarthritis).",
            "bullets",
        ),
        _s(
            "plan",
            "Plan & Counselling",
            "Recommendations discussed (diet, weight management, dental care, behaviour, "
            "lifestyle), diagnostics recommended (bloodwork, urinalysis, etc.) and client "
            "response, medications/preventives dispensed, and the next wellness visit.",
            "bullets",
        ),
    ],
)

_SICK = _tpl(
    "builtin-sick",
    "Sick Visit / Problem-focused",
    "Focused history and exam for an acute or chronic problem, with differentials and workup.",
    "sick",
    [
        _s(
            "presenting_complaint",
            "Presenting Complaint",
            "One or two sentences: the main problem and its duration, as the owner presented it.",
        ),
        _s(
            "history",
            "History of Present Illness",
            "Onset, duration, progression, severity, frequency, owner-attempted treatments and "
            "response, appetite, drinking, vomiting/diarrhoea, urination, energy, cough, "
            "pruritus, lameness, toxin/foreign-body exposure, diet change, other pets affected, "
            "relevant past medical history and current medications.",
        ),
        _vitals_section(),
        _pe_section(),
        _s(
            "problem_list",
            "Problem List & Differentials",
            "Numbered problems with differential diagnoses in order of likelihood, preserving "
            "the clinician's stated certainty.",
            "bullets",
        ),
        _s(
            "diagnostics",
            "Diagnostics",
            "Tests performed or recommended (CBC/chemistry, urinalysis, cytology, radiographs, "
            "ultrasound, etc.), results if reported, and whether the owner accepted or declined.",
            "bullets",
            missing="omit",
        ),
        _s(
            "treatment_plan",
            "Treatment Plan",
            "In-clinic treatments, medications (drug, dose, route, frequency, duration if "
            "stated), diet/activity restrictions, client education, red-flag signs the owner was "
            "told to watch for, and recheck timing.",
            "bullets",
        ),
    ],
)

_RECHECK = _tpl(
    "builtin-recheck",
    "Recheck / Progress",
    "Follow-up of a known problem: response to treatment, current status and plan changes.",
    "recheck",
    [
        _s(
            "reason_for_recheck",
            "Reason for Recheck",
            "The original problem, date or context of the previous visit, and what treatment "
            "was started.",
        ),
        _s(
            "interval_history",
            "Interval History",
            "Owner-reported change since the last visit: improvement, no change or worsening; "
            "medication compliance and tolerance, adverse effects, appetite, energy and "
            "problem-specific signs.",
        ),
        _vitals_section("Vitals"),
        _s(
            "focused_exam",
            "Focused Exam",
            "Examination findings relevant to the problem being rechecked, compared with the "
            "previous visit where the clinician made that comparison. Include any additional "
            "abnormalities noted.",
            missing="state_not_discussed",
        ),
        _s(
            "diagnostics",
            "Diagnostic Results",
            "Repeat tests run or results reviewed today, with values as stated.",
            "bullets",
            missing="omit",
        ),
        _s(
            "assessment",
            "Assessment",
            "Status of the problem (resolved, improving, static, worsening) and any new problems.",
        ),
        _s(
            "plan",
            "Plan",
            "Medication changes (continue / adjust / stop, with doses if stated), further "
            "diagnostics, and next recheck date or discharge from care.",
            "bullets",
        ),
    ],
)

_DENTAL = _tpl(
    "builtin-dental",
    "Dental (COHAT)",
    "Comprehensive oral health assessment and treatment: charting, anesthesia, procedures, "
    "extractions and home care.",
    "dental",
    [
        _s(
            "pre_anesthetic",
            "Pre-anesthetic Assessment",
            "Indication for the dental procedure, pre-anesthetic exam and bloodwork results as "
            "stated, ASA status if stated, fasting status, relevant comorbidities and "
            "medications, owner consent and estimate discussion.",
        ),
        _s(
            "anesthesia",
            "Anesthesia & Monitoring",
            "Premedication, induction agents, maintenance, intubation, IV catheter/fluids, "
            "regional dental nerve blocks (agent, dose, sites), monitoring (ECG, SpO2, ETCO2, "
            "BP, temperature) and any intra-operative events. Record only what was stated.",
            "bullets",
        ),
        _s(
            "oral_findings",
            "Oral Exam & Charting Findings",
            "Findings from the conscious and anesthetized oral exam and full-mouth radiographs: "
            "plaque/calculus grade, gingivitis, periodontal disease stage and pocket depths, "
            "furcation exposure, tooth mobility, missing/fractured/discoloured teeth, "
            "resorptive lesions (feline), oral masses, and radiographic findings. Reference "
            "teeth by the modified Triadan number as stated.",
            "bullets",
        ),
        _s(
            "procedures",
            "Procedures Performed",
            "Supragingival and subgingival scaling, polishing, irrigation, root planing, "
            "fluoride or sealant, local antibiotic placement, biopsies, and any other "
            "procedure, with the teeth involved.",
            "bullets",
        ),
        _s(
            "extractions",
            "Extractions",
            "Each tooth extracted (Triadan number), the reason (e.g. stage 4 periodontal "
            "disease, fracture with pulp exposure, resorption), the technique (simple / "
            "surgical, sectioned), and the closure (suture material) if stated.",
            "bullets",
            missing="omit",
        ),
        _s(
            "recovery",
            "Recovery & Post-op Pain Control",
            "Recovery quality, extubation time, analgesia given or sent home (drug, dose, "
            "duration if stated), antibiotics and monitoring instructions.",
        ),
        _s(
            "home_care",
            "Home Care & Follow-up",
            "Diet (soft food duration), oral hygiene recommendations (brushing, VOHC-accepted "
            "products), medications at home, signs that need a call, and recheck interval.",
            "bullets",
        ),
    ],
)

_SURGERY = _tpl(
    "builtin-surgery",
    "Surgery Report",
    "Operative report: pre-op status, anesthesia, procedure, closure, complications and "
    "post-operative plan.",
    "surgery",
    [
        _s(
            "preoperative",
            "Pre-operative Assessment",
            "Procedure planned and indication, patient status, pre-op bloodwork/imaging as "
            "stated, ASA physical status classification if stated, fasting, medications and "
            "owner consent.",
            fields=None,
        ),
        _s(
            "asa_status",
            "ASA Status",
            "ASA physical status class (I-V, with E if emergency) only if the clinician stated "
            "it; otherwise leave blank.",
            "key_value",
            fields=_fields(
                ("asa_class", "ASA class", "I-V, add E for emergency"),
                ("rationale", "Rationale", "Reason given for the classification"),
            ),
        ),
        _s(
            "anesthetic_protocol",
            "Anesthetic Protocol",
            "Premedication, induction, maintenance, analgesia (including local/regional "
            "blocks and CRIs), fluids, monitoring and anesthesia duration, each with doses "
            "only as stated.",
            "bullets",
        ),
        _s(
            "procedure",
            "Surgical Procedure",
            "Patient positioning and prep, approach/incision, key steps in order, findings "
            "(including organ or lesion description and samples collected for histopathology or "
            "culture), haemostasis and any implants or devices used.",
        ),
        _s(
            "closure",
            "Closure",
            "Layers closed with suture material, size and pattern; skin closure; bandage or "
            "drain placement. Include swab/instrument counts only if stated.",
            "bullets",
        ),
        _s(
            "complications",
            "Intra-operative Complications / Findings",
            "Any complication, haemorrhage, hypotension, arrhythmia or deviation from plan and "
            "how it was managed. State clearly if none were reported.",
            missing="state_not_discussed",
        ),
        _s(
            "post_op",
            "Post-operative Plan",
            "Recovery, analgesia, antibiotics, E-collar, activity restriction, wound care, "
            "diet, monitoring, histopathology pending, suture removal and recheck dates, and "
            "owner instructions.",
            "bullets",
        ),
    ],
)

_EUTHANASIA = _tpl(
    "builtin-euthanasia",
    "Euthanasia",
    "Compassionate, factual record of euthanasia: consent, sedation, method and aftercare.",
    "euthanasia",
    [
        _s(
            "reason",
            "Reason & Clinical Background",
            "The clinical history and quality-of-life considerations that led to the decision, "
            "as discussed. Use respectful, factual language.",
        ),
        _s(
            "consent",
            "Owner Consent & Discussion",
            "Who consented (name and relationship if stated), confirmation that the owner "
            "understood the procedure and that it is irreversible, options discussed "
            "(including alternatives), and who was present.",
        ),
        _s(
            "sedation",
            "Pre-euthanasia Sedation / Catheter",
            "Sedative or anesthetic agents, dose, route, time, quality of sedation, and IV "
            "catheter placement, only as stated.",
            "bullets",
            missing="omit",
        ),
        _s(
            "method",
            "Method & Confirmation of Death",
            "Euthanasia agent (e.g. pentobarbital), dose, route, time, and how death was "
            "confirmed (absence of heartbeat, respiration, corneal reflex) as stated.",
            "key_value",
            fields=_fields(
                ("agent", "Agent", "Drug name"),
                ("dose_route", "Dose / route", "Only as stated"),
                ("time", "Time", "Time of administration/death if stated"),
                ("confirmation", "Confirmation of death", "Checks performed by clinician"),
            ),
        ),
        _s(
            "owner_wishes",
            "Owner Wishes & Aftercare",
            "Owner's wishes: presence during the procedure, keepsakes (paw print, fur clip), "
            "and aftercare arrangements (private or communal cremation, home burial, body "
            "release), plus any account or paperwork matters mentioned.",
            "bullets",
        ),
        _s(
            "support",
            "Client Support",
            "Grief support offered or resources provided, and any follow-up call or card.",
            missing="omit",
        ),
    ],
    abbreviations=False,
    custom="Use gentle, respectful wording. Do not editorialise or add sentiment not expressed.",
)

_PHONE = _tpl(
    "builtin-phone",
    "Phone Consult",
    "Telephone or message advice: caller concern, triage, advice given and follow-up.",
    "phone",
    [
        _s(
            "caller",
            "Caller & Patient",
            "Who called (name/relationship if stated) and the patient concerned.",
        ),
        _s(
            "concern",
            "Concern / History",
            "Reason for the call and the history as reported by the caller (onset, duration, "
            "signs, what they have tried). No examination was performed - do not state or "
            "imply any findings.",
        ),
        _s(
            "triage",
            "Triage Assessment",
            "The clinician's assessment of urgency and the possible causes discussed, with the "
            "stated level of certainty and any limits of a remote assessment.",
        ),
        _s(
            "advice",
            "Advice Given",
            "Home-care instructions, medication advice (drug and dose only as stated), "
            "red-flag signs to watch for and what to do if they occur.",
            "bullets",
        ),
        _s(
            "disposition",
            "Disposition & Follow-up",
            "Whether an appointment or emergency referral was arranged, timing, caller's "
            "agreement, and any callback to be made.",
            "bullets",
        ),
    ],
)

_DISCHARGE = _tpl(
    "builtin-discharge",
    "Client Discharge Summary",
    "Plain-language summary and home-care instructions to send home with the owner.",
    "other",
    [
        _s(
            "visit_summary",
            "Why You Visited Today",
            "A short plain-language explanation of why the pet came in and what the "
            "veterinary team found, avoiding jargon.",
        ),
        _s(
            "what_we_did",
            "What We Did Today",
            "Examinations, tests, treatments and procedures completed today, each in simple words.",
            "bullets",
        ),
        _s(
            "diagnosis",
            "What We Think Is Going On",
            "The diagnosis or most likely cause(s) explained simply, honestly reflecting any "
            "uncertainty the veterinarian expressed.",
        ),
        _s(
            "medications",
            "Medications",
            "Each medication to give at home: name, what it is for, the amount, how often and "
            "for how long, plus any key tips (with food, finish the course). Only include what "
            "the veterinarian stated; if an amount or duration was not stated, say to confirm "
            "with the clinic.",
            "bullets",
            missing="omit",
        ),
        _s(
            "home_care",
            "Caring for Your Pet at Home",
            "Feeding, activity, wound or ear/eye care, and what to monitor.",
            "bullets",
        ),
        _s(
            "warning_signs",
            "When to Call Us Right Away",
            "Warning signs the veterinarian told the owner to watch for, and when to seek "
            "emergency care.",
            "bullets",
        ),
        _s(
            "next_steps",
            "Next Steps",
            "Recheck appointments, pending test results, and when the clinic will be in touch.",
            "bullets",
        ),
    ],
    tone="client_friendly",
    abbreviations=False,
    custom="Warm, reassuring, 6th-8th grade reading level. Address the owner as 'you' and the "
    "pet by name if known.",
)

BUILTIN_TEMPLATES: tuple[Template, ...] = (
    _SOAP,
    _WELLNESS,
    _SICK,
    _RECHECK,
    _DENTAL,
    _SURGERY,
    _EUTHANASIA,
    _PHONE,
    _DISCHARGE,
)

_BY_ID = {t.id: t for t in BUILTIN_TEMPLATES}


def get_builtin(template_id: str) -> Template | None:
    t = _BY_ID.get(template_id)
    return t.model_copy(deep=True) if t else None


def list_builtins() -> list[Template]:
    return [t.model_copy(deep=True) for t in BUILTIN_TEMPLATES]


# Re-exported for tests / callers that want the shared style default.
DEFAULT_STYLE = Style()
