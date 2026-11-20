# Competitor research: template models in veterinary AI scribes

Research date: 2026-11-20. Method: web search summaries plus a few fetched pages. Most vendor sites (co.vet, instinct.vet, scribenote.com, talkatoo.com, aws.amazon.com) were not directly fetchable from the research environment, so many facts below come from search-result summaries of vendor pages, help centres and third-party listings. Anything marked **not publicly documented** or **unverified** was not found. Vendor marketing claims are not independently verified, and pricing varies by source.

## 1. Product-by-product findings

### CoVet
- **Templates:** Claims 95+ ready-made templates across general practice, emergency, surgery, dentistry, equine and exotics (an earlier post said 70+) ([customizable SOAP](https://www.co.vet/customizable-soap-notes), [comparison](https://co.vet/post/veterinary-software-comparison/)).
- **Customisation:** Users can personalise an existing template or build one from scratch by defining sections, body text and instructions ([creating custom templates](https://intercom.help/covet/en/articles/14122509-creating-custom-templates)). "Coco", an AI template assistant, drafts or edits templates from text, audio, files or screen recordings ([Coco guide](https://intercom.help/covet/en/articles/14122519-how-to-use-coco-ai-template-assistant)). There is a separate "custom instructions" layer. CoVet says it does not maintain custom templates, so it recommends custom instructions on top of its own templates to keep receiving improvements ([search summary of help centre](https://www.co.vet/customizable-soap-notes)).
- **Defaults, abbreviations, tone:** Not publicly documented in the sources reached.
- **Marketplace/sharing:** Not publicly documented.
- **Other outputs:** Client visit/discharge summaries (about 20-30 s, multiple languages), follow-up emails and draft referral letters from the same consult ([visit summaries help](https://intercom.help/covet/en/articles/14122487-generating-client-visit-and-discharge-summaries), [client communication post](https://co.vet/post/how-do-veterinary-ai-scribes-help-with-client-communication/)).
- **PIMS:** Vendor lists ~11 PIMS (AVImark, Cornerstone, ImproMed, Instinct, Vetspire, ezyVet and others). Light integrations are included on all plans, deeper API "Connections" are a paid add-on ([integrations](https://co.vet/integrations), [ezyVet](https://www.ezyvet.com/integration/covet)).
- **Pricing (vendor-authored comparison):** Essentials from about US$63/mo and Unlimited from about US$136/mo, billed annually, with a 14-day trial ([comparison](https://co.vet/post/veterinary-software-comparison/)). The vendor's own pricing page says plans scale with the clinic.
- **Privacy/compliance:** Not found in the sources reached.

### ScribbleVet (Instinct)
- **Templates:** Customisable across specialties and species, including dental charts, exotics and equine. Instinct publishes 5 free templates to copy ([Instinct product page](https://instinct.vet/products/scribblevet/), [free templates](https://instinct.vet/blog/free-scribblevet-templates/)).
- **Customisation:** An AI template builder creates a custom template from an uploaded existing note (PDF/JPG/PNG) on a chosen base template such as SOAP. The result is a separate template and existing ones are untouched. Web app only ([help article](https://intercom.help/scribblevet-help-center/en/articles/16103078-create-a-custom-template-from-existing-notes-and-documents)).
- **Other outputs:** Client summary emails, Care Cards and visual dental charts (the Essential plan caps these at 20 emails, 2 dental charts, 5 Care Cards per month) ([subscription plans](https://intercom.help/scribblevet-help-center/en/articles/14811702-subscription-plans)).
- **Pricing:** Unleashed $169/mo per vet monthly or $129/mo annually. Essential $40/mo with 150 SOAP generations. 14-day trial. Sources conflict, so confirm with the vendor ([plans](https://intercom.help/scribblevet-help-center/en/articles/14811707-full-time-part-time-and-relief-veterinarian-unleashed-plan-pricing)).
- **PIMS, privacy, section-level options, sharing:** Not found.

### Talkatoo
- **Templates:** Custom templates, "Auto-SOAP" and specialised templates (equine, rechecks, multi-pet visits). Annual plan lists a Custom Template Builder with unlimited templates. The product fills templates by voice dictation ([Talkatoo on App Store](https://apps.apple.com/app/id1591619032), [Capterra](https://www.capterra.com/p/198507/Talkatoo/)). A Capterra reviewer notes custom templates need setup, and Customer Success helps set them up.
- **Names "VetMate" and "Mia":** Not found in any Talkatoo source. Treat as unconfirmed.
- **Other outputs:** Call summaries, client communications and an AI assistant (marketing summary).
- **PIMS:** ezyVet, Cornerstone and AVImark, with IDEXX-published pages ([ezyVet](https://software.idexx.com/integration/talkatoo-ezyvet), [Cornerstone](https://software.idexx.com/integration/talkatoo-cornerstone)).
- **Pricing:** Conflicting ($40 per user SOAP plan in a competitor's comparison, $139/mo on a promo page). Not reliably documented.
- **Differentiator:** Dictation-first (clinician speaks into structured fields) rather than ambient capture.

### VetRec
- **Templates:** 30+ specialty templates (SOAP, canine dental chart, discharge instructions, procedure-specific) and custom templates ([Capterra](https://www.capterra.com/p/10020824/VetRec/), [vendor](https://www.vetrec.io/?r=0)).
- **Other outputs:** "Records Recap" summarises prior records before a consult. Client-facing summary: unverified. Phone-call recording logged to patient records.
- **PIMS:** Claims the broadest PIMS support, cloud and on-premise.
- **Pricing:** Conflicting listings ($99 to $150 per vet per month). 14-day trial; nonprofit and student discounts ([pricing](https://vetrec.io/pricing)).

### HappyDoc
- **Templates:** Customisable to the vet's writing style; one listing says built from 200+ pre-configured data points. The in-app assistant "Scout" can create custom templates and edit notes ([TAAFT listing](https://theresanaiforthat.com/ai/happydoc/), [Capterra](https://www.capterra.com/p/10032227/HappyDoc/)).
- **Other outputs:** SOAP notes and discharge instructions; in-app call recording.
- **PIMS:** AVImark, ImproMed, Cornerstone and others (listing claim).
- **Pricing:** Conflicting ($90 to $149 per month).

### Scribenote
- **Templates:** "Adaptive Templates" (Pro) build custom templates for consult types (allergy, ER rounds, surgery) and can be created by uploading a PDF ([adaptive templates](https://scribenote.com/adaptive-templates), [template library](https://scribenote.com/template-library)). Free tier has unlimited notes with default templates and Teams Mode. Custom templates, Client Summaries, Multilingual Mode and a writing assistant are Pro ([press release](https://www.citybiz.co/?p=710137)).
- **PIMS:** Says it works with all PIMS (copy-paste "Copy All", widget mode) ([enterprise](https://www.scribenote.com/enterprise)).
- **Pricing:** Free tier; Pro price not found.

### PetsApp (AI Scribe)
- Real-time transcription to SOAP notes, client-friendly summaries and "editable templates that learn and adapt based on vet preferences". Pilot/early-access at launch; general availability date not confirmed ([PetsApp blog](https://petsapp.com/blog/introducing-petsapps-ai-scribe-a-game-changing-note-taking-assistant-for), [Vet Times](https://www.vettimes.com/news/business/digital/petsapp-launches-ai-note-taking-tool)). Template granularity, pricing, privacy: not publicly documented.

### PIMS-native scribes
- **Digitail (Tails AI Scribe):** Built into the PIMS on Mobile and Growth tiers (1-month trial); standalone "Tails VIP" for non-Digitail clinics ([Digitail plans](https://digitail.com/plans), [Digitail guide](https://digitail.com/blog/the-ultimate-guide-to-the-best-ai-scribes-for-veterinary-clinics/)). Template detail: not found.
- **Shepherd:** No AI scribe information found.
- **Vetspire:** No native scribe found; third-party scribes (CoVet, Scribenote) integrate with it (unconfirmed for Scribenote).
- **Instinct:** Owns ScribbleVet (above).
- **Vetster:** DAP-format scribe whose standard templates "flag or leave blank" sections not addressed ([Vetster](https://vetster.com/en/blog/for-vets/ai-scribe)).
- **Others seen:** VetNotes ([custom templates](https://vetnotes.com/product/custom-templates)), Whippet Notes, PetDesk Scribe.

### Human-medicine references
- **Heidi Health:** The best-documented template system. Template Builder lets you describe a template in text or upload an example or PDF, then refine through chat or by editing the example, and every change creates a new version. Visibility can be private, team or Community; Community templates are searchable by specialty/region/category and added to your library with "Use template". Team-wide sharing is on request ([creating/editing](https://support.heidihealth.com/en/articles/13123938-creating-and-editing-templates), [community](https://www.heidihealth.com/template-community), [community help](https://support.heidihealth.com/en/articles/9747185-getting-started-with-community-templates), [team templates](https://support.heidihealth.com/en/articles/9587992-managing-templates-in-your-team)). Its vet templates (Vet SOAP, Vet Medical Consult, ultrasonography report) ship with pre-written normal findings that the user must confirm ([example](https://www.heidihealth.com/en-sg/templates/main-ghc-template-81ac57fd)).
- **Microsoft DAX / Dragon Copilot:** Specialty chosen in the profile selects the underlying model. Customisable templates are attached to six note sections (HPI, Allergies, Physical Exam, Results, Procedure, Assessment and Plan). Each has a default the user can edit, source can be transcript, AI note or both, and templates can insert standard text for sections not discussed (default exam statements). Auto-run versus on-demand application. Microsoft warns output varies and must be reviewed ([overview](https://support.microsoft.com/en-us/dax-copilot/dax-copilot-customizable-template-overview), [edit defaults](https://support.microsoft.com/topic/cc37e322-c86b-41b4-80a7-850d777f9021)).
- **Abridge:** No template documentation found.

## 2. Comparison table

| Product | Built-in library | User-created templates | AI-assisted template creation | Per-section control (public) | Template sharing | Client-facing outputs | PIMS |
|---|---|---|---|---|---|---|---|
| CoVet | 95+ | Yes | Yes (Coco) | Sections, body, instructions, plus custom instructions | Not documented | Discharge/visit summary, emails, referral letter | ~11 |
| ScribbleVet | Yes (5 free packs) | Yes | Yes (from uploaded note) | Not documented | Not documented | Client emails, Care Cards, dental charts | Not found |
| Talkatoo | Yes | Yes (builder, setup help) | Not found | Voice-filled fields | Not documented | Call summaries, client comms | ezyVet, Cornerstone, AVImark |
| VetRec | 30+ | Yes | Not found | Not documented | Not documented | Records Recap; client summary unverified | Many |
| HappyDoc | Yes | Yes | Yes (Scout) | "200+ data points" | Not documented | Discharge instructions | AVImark, ImproMed, Cornerstone |
| Scribenote | Library | Pro only | Yes (PDF upload) | Not documented | Not documented | Client Summaries (Pro), multilingual | Copy/paste, "all" |
| PetsApp | Not documented | "Editable, learning" | Not documented | Not documented | Not documented | Client-friendly summaries | Not documented |
| Digitail | Not documented | Not documented | Not documented | Not documented | Not documented | Not documented | Native |
| Heidi | Large library | Yes | Yes (chat/example/PDF) | Free-form template text, versioned | Private/team/Community | Letters/documents | Human-med EHRs |
| DAX/Dragon | Specialty models | Section-level | n/a | 6 sections, source selection | Org-level | n/a | Epic |

## 3. Common patterns

1. **Template = a named skeleton plus free-text instructions.** Nearly all products let users define sections and write natural-language guidance per section. Few document structured field types.
2. **Start from a library, then customise.** Built-ins cover SOAP, dental, surgery, euthanasia, wellness, emergency, equine, exotics. Users clone and edit.
3. **AI-assisted template authoring is now table stakes.** Upload an existing note or PDF (ScribbleVet, Scribenote, Heidi) or describe it in chat (CoVet Coco, Heidi, HappyDoc Scout).
4. **Custom templates are often gated** to a paid tier (Scribenote Pro, ScribbleVet plans).
5. **One consult, multiple outputs.** The medical record is joined by client summary/discharge, follow-up email and referral letter, often multilingual.
6. **Review-before-save workflow.** Notes are editable, and PIMS delivery is mostly copy/paste or light integration, with deeper API connections as an add-on.
7. **Normal-findings defaults exist** (Heidi vet templates, DAX exam defaults) and every source warns they must be clinician-confirmed.
8. **Sharing is rare in veterinary** and mature only in Heidi (Community/team libraries, versioning).
9. **Pricing clusters at $100-$170 per vet per month**, with free or low tiers (Scribenote free, ScribbleVet Essential).

## 4. Design implications for VetScribe

Mapping to our template model (spec section 4):

- **Sections and instructions.** Our per-section `instructions` matches the market. Keep it as the primary control and give it a generous editor with example text.
- **`format` (paragraph/bullets/key_value).** Competitors mostly rely on free-text instructions to imply layout. Our structured formats are a differentiator because they make exams and vitals parseable and renderable consistently. Keep `key_value` fields with hints.
- **`missing_behavior`.** `use_normal_defaults` is the competitive norm (Heidi, DAX). Keep our explicit `used_defaults` flag and UI badge so clinicians must confirm, which is stricter than competitors. `state_not_discussed` and `omit` map to the Vetster behaviour (flag or leave blank). Consider also a hybrid, "omit unless abnormal", for body-system sections.
- **Style.** Tone (clinical vs client_friendly), abbreviation toggle and custom instructions cover what CoVet-style "custom instructions" provide. Consider splitting `custom_instructions` into clinic-wide and per-template layers, since CoVet recommends a separate instructions layer to survive template changes.
- **Built-ins (9 planned).** Matches the expected core. Gaps compared with the market: emergency/triage, equine, exotics, ultrasound/radiology report, specialty referral. Add emergency and a specialist referral template first.
- **Duplicate-to-customise** for read-only built-ins matches "personalise an existing template".

Gaps worth planning for v2, roughly by value:
1. **AI template authoring** (upload an existing note/PDF or describe it, then generate a template). Seen in 5 products and the biggest onboarding lever.
2. **Multi-output per visit** (client discharge summary, follow-up email, referral letter) from one transcript. v1 treats the client summary as a separate template; v2 should generate several outputs in one run.
3. **Template versioning and sharing** (private, clinic, community), following Heidi. We already store `version` and `template_snapshot`, so history is cheap to add.
4. **Per-species and per-appointment defaults.** Normal findings differ by species (CRT, resting HR, temperature). Allow `normal_defaults` keyed by species, with the patient species selecting which applies.
5. **Dictation of exam findings** into key_value fields (Talkatoo's niche) and a "source" option per section (transcript only vs transcript plus patient info), as DAX does.
6. **Language/localisation** of client outputs (CoVet, Scribenote Pro).
7. **PIMS delivery.** Competitors treat copy-to-PIMS as the baseline. Our `rendered_text` covers v1; integration (ezyVet, Cornerstone, AVImark, Vetspire) is a v2+ item.
8. **Prior-record recap** (VetRec) as an optional input block.

Risks to note: custom/AI-authored templates make prompts less predictable, so keep our schema-constrained output and review flags. Default-normal text is the main medico-legal risk, so keep the explicit flag, never silent.
