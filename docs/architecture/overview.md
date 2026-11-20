# VetScribe — How it works

VetScribe turns a veterinary consultation **transcript** into a **structured clinical
note** that follows a **template** the clinic controls. It assumes the transcript
already exists as one block of text, so speech-to-text is a separate, earlier step.

This page gives the high-level picture. The detailed contract is in
[`../design/spec.md`](../design/spec.md), and the decisions behind it are in the
[ADRs](../adr/README.md).

---

## 1. The big picture

```mermaid
flowchart LR
    subgraph Client["Browser"]
        UI["React SPA<br/>(Vite, TanStack Query)"]
    end

    subgraph AWS["AWS account (single region)"]
        CF["S3 + CloudFront<br/>(static SPA hosting)"]
        APIGW["API Gateway<br/>HTTP API"]
        API["API Lambda<br/>vetscribe.handlers.api<br/>(Powertools router)"]
        WRK["Worker Lambda<br/>vetscribe.handlers.worker"]
        DDB[("DynamoDB<br/>single table")]
        BR["Amazon Bedrock Runtime<br/>Claude (InvokeModel)"]
        DLQ[["SQS DLQ<br/>(failed async invokes)"]]
        CW["CloudWatch<br/>Logs · Metrics · X-Ray"]
    end

    UI -- "static assets" --> CF
    UI -- "JSON /v1/*" --> APIGW --> API
    API -- "CRUD templates & notes" --> DDB
    API -- "async invoke (Event)" --> WRK
    WRK -- "read note / write result" --> DDB
    WRK -- "invoke_model + JSON schema" --> BR
    WRK -. "on failure" .-> DLQ
    API & WRK -.-> CW
```

| Component | Responsibility |
|---|---|
| **React SPA** | Template editor, paste-transcript screen, note viewer and editor, history. Polls while a note is generating. |
| **API Lambda** | One function behind every `/v1/*` route (a "lambdalith"). Validates input, manages templates and notes, and hands generation off to the worker. Returns quickly. |
| **Worker Lambda** | Builds the prompt and JSON schema from the template, calls Claude on Bedrock, validates and post-processes the output, then stores the note. |
| **DynamoDB** | Holds custom templates and notes in one table, partitioned by clinic. |
| **Amazon Bedrock** | AWS-hosted Claude, called with `boto3` `bedrock-runtime.invoke_model`. Prompts and outputs stay inside AWS. |

---

## 2. Generating a note, end to end

```mermaid
sequenceDiagram
    autonumber
    actor Vet
    participant UI as React SPA
    participant API as API Lambda
    participant DB as DynamoDB
    participant W as Worker Lambda
    participant LLM as Claude on Bedrock

    Vet->>UI: Pick template, paste transcript, click Generate
    UI->>API: POST /v1/notes {template_id, transcript, patient}
    API->>DB: Load template (or built-in from code)
    API->>DB: Put Note{status: pending, template_snapshot}
    API-->>W: Invoke async (InvocationType=Event) {note_id}
    API-->>UI: 202 Accepted + Note(pending)

    loop every 1.5 s while pending/processing
        UI->>API: GET /v1/notes/{id}
        API->>DB: Get note
        API-->>UI: Note(status)
    end

    W->>DB: status = processing
    W->>W: Build system prompt + template block + JSON schema
    W->>LLM: invoke_model(output_config.format = json_schema)
    LLM-->>W: JSON matching the schema + usage
    W->>W: Check stop_reason, validate (pydantic), order sections, apply missing-data rules
    W->>DB: status = completed, result, model_info

    UI->>API: GET /v1/notes/{id}
    API-->>UI: Note(completed) + rendered_text / rendered_markdown
    Vet->>UI: Review flags, edit sections, Save (PATCH), Copy to PIMS
```

**Why asynchronous?** A long consultation with a large model can take longer than
API Gateway's roughly 30 s integration timeout, and Python Lambdas can't stream
responses natively. Returning `202` and polling keeps the API fast and simple. See
[ADR-0005](../adr/0005-asynchronous-generation.md).

---

## 3. How a template becomes a prompt and a schema

A template is an ordered list of **sections**. Each section says *what* to capture
(`instructions`), *how* to format it (`format`), and *what to do when the transcript
doesn't mention it* (`missing_behavior`).

```mermaid
flowchart TB
    T["Template<br/>name · style · sections[]"] --> PB["prompts/builder.py"]
    TR["Transcript<br/>(untrusted text)"] --> PB
    P["Patient info<br/>(optional)"] --> PB

    PB --> SYS["System prompt<br/>(static: vet scribe rules,<br/>no fabrication, injection guard)"]
    PB --> USR["User message<br/>&lt;template&gt; … &lt;patient&gt; … &lt;transcript&gt;"]
    PB --> SCH["JSON Schema<br/>(generated per template)"]

    SYS & USR & SCH --> REQ["invoke_model body<br/>anthropic_version: bedrock-2023-05-31<br/>output_config: {effort, format: json_schema}"]
```

The schema follows the template's own structure, so Claude has to return exactly
the sections the clinic defined:

| Section `format` | Schema shape returned by Claude | Rendered as |
|---|---|---|
| `paragraph` | `{content: string, not_discussed: bool, used_defaults: bool}` | Prose paragraph |
| `bullets` | `{items: string[], not_discussed, used_defaults}` | `- item` list |
| `key_value` | `{fields: {weight: string, temp: string, …}, not_discussed, used_defaults}` | `Weight: 32 kg` lines |

Every note also gets `visit_summary`, `action_items` (follow-ups, owner to-dos) and
`review_flags` (anything ambiguous the vet must check, such as an unclear dose).

### Missing-data semantics: the anti-hallucination rule

| `missing_behavior` | When the transcript is silent | Typical use |
|---|---|---|
| `omit` | Section is marked `not_discussed` and hidden from the final note | Optional sections like "Diet" |
| `state_not_discussed` | Prints "Not discussed." | Sections the record must always show |
| `use_normal_defaults` | Fills in the clinic's `normal_defaults` text, e.g. *"BAR, MM pink, CRT <2s"*, and sets `used_defaults: true`. The UI shows a **"Normal defaults — confirm"** badge. | Physical-exam body systems |

Findings mentioned in the transcript always override defaults. Defaults are never
applied silently.

---

## 4. Structured output strategies

```mermaid
flowchart LR
    A{"BEDROCK_STRUCTURED_MODE"} -->|output_config<br/>default| B["output_config.format = json_schema<br/>→ text block is guaranteed JSON"]
    A -->|tool| C["One strict tool 'record_clinical_note'<br/>tool_choice: auto + instruction<br/>→ read tool_use.input<br/>(retry once if no call)"]
    B & C --> V["Shared post-processor<br/>pydantic validation · ordering · missing-data rules"]
    V --> R["NoteResult"]
```

* `output_config` is the default: native constrained decoding, so the model's
  output is guaranteed to match the schema.
* `tool` mode is a fallback for models or regions where `output_config` isn't
  available. Forced `tool_choice` is rejected by current Claude models, so this
  mode uses `auto` and retries once if Claude doesn't call the tool.
* Before reading any output, the worker checks `stop_reason`. `refusal` becomes
  `MODEL_REFUSAL` and `max_tokens` becomes `OUTPUT_TRUNCATED`. Both are stored on
  the note and shown in the UI.

---

## 5. Note lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending: POST /v1/notes
    pending --> processing: worker picks up
    processing --> completed: valid output
    processing --> failed: refusal / truncated / invalid / Bedrock error
    completed --> completed: PATCH (vet edits) → edited=true
    completed --> pending: POST /regenerate
    failed --> pending: POST /regenerate
    completed --> [*]: DELETE
    failed --> [*]: DELETE
```

---

## 6. Data model (DynamoDB single table)

```mermaid
erDiagram
    CLINIC ||--o{ TEMPLATE : owns
    CLINIC ||--o{ NOTE : owns
    TEMPLATE ||--o{ NOTE : "generated with (snapshot copied)"

    TEMPLATE {
        string PK "CLINIC#{clinic_id}"
        string SK "TEMPLATE#{uuid}"
        string name
        json sections "ordered Section[]"
        json style
        int version
    }
    NOTE {
        string PK "CLINIC#{clinic_id}"
        string SK "NOTE#{ulid}  (time-sortable)"
        string status "pending|processing|completed|failed"
        json template_snapshot
        string transcript
        json result "NoteResult"
        json model_info
    }
```

* **Built-in templates** (SOAP, Wellness, Sick visit, Recheck, Dental/COHAT,
  Surgery, Euthanasia, Phone consult, Client discharge) live in code, ship with
  each release, and are read-only. Duplicate one to customise it.
* **Template snapshot.** Each note stores a copy of the template it was generated
  with, so editing a template later never changes how an existing note is read.
* `clinic_id` is `default` until authentication lands. The planned approach is a
  Cognito JWT authorizer with the claim feeding the partition key.

---

## 7. Code structure (backend)

```mermaid
flowchart TB
    subgraph handlers
        H1["handlers/api.py<br/>HTTP routing, validation, error mapping"]
        H2["handlers/worker.py<br/>async job entry point"]
    end
    subgraph services
        S1["services/templates.py"]
        S2["services/notes.py<br/>create · generate · patch · regenerate"]
    end
    subgraph ports["ports (interfaces)"]
        P1["repositories/base.py"]
        P2["llm/base.py · NoteGenerator"]
        P3["jobs/dispatcher.py"]
    end
    subgraph adapters
        A1["repositories/dynamodb.py"]
        A2["repositories/memory.py"]
        A3["llm/bedrock.py (boto3)"]
        A4["llm/mock.py"]
        A5["LambdaAsyncDispatcher"]
        A6["InlineThreadDispatcher"]
    end
    D["domain/models.py · builtin_templates.py"]
    PR["prompts/builder.py"]

    H1 --> S1 & S2
    H2 --> S2
    S2 --> PR
    S1 & S2 --> P1
    S2 --> P2
    S2 --> P3
    P1 -.-> A1 & A2
    P2 -.-> A3 & A4
    P3 -.-> A5 & A6
    S1 & S2 & PR --> D
```

The ports-and-adapters split is what makes the **mock mode** possible. Each
adapter is chosen by an environment variable:

| Concern | AWS | Local / mock |
|---|---|---|
| LLM (`LLM_PROVIDER`) | `bedrock` → `llm/bedrock.py` | `mock` → `llm/mock.py` (keyword extraction, simulated latency) |
| Storage (`STORAGE_BACKEND`) | `dynamodb` | `memory` (+ optional JSON file) |
| Jobs (`JOB_DISPATCHER`) | `lambda` → async invoke of the worker | `inline` → background thread |
| HTTP entry | API Gateway → Lambda | `local/server.py` turns HTTP into API Gateway v2 events and calls the **same** `lambda_handler` |

---

## 8. Running modes

```mermaid
flowchart LR
    subgraph M1["make dev  (full mocked stack)"]
        V1["Vite :5173"] -- "/v1 proxy" --> L1["local/server.py :8000<br/>mock LLM · memory store · inline worker"]
    end
    subgraph M2["make dev-mock-fe  (frontend only)"]
        V2["Vite :5173 + MSW<br/>in-browser fake API"]
    end
    subgraph M3["AWS  (sam deploy)"]
        V3["SPA"] --> G3["API GW → Lambdas → Bedrock + DynamoDB"]
    end
```

* **`make dev`** runs the real backend code paths (routing, validation, services,
  post-processing) with a fake LLM. Use it for most local work.
* **`make dev-mock-fe`** needs no Python. It's useful for UI-only iteration and demos.
* **Real Bedrock locally:** run `LLM_PROVIDER=bedrock AWS_PROFILE=… make dev-backend`,
  or try a single call with `scripts/smoke_bedrock.py`.

---

## 9. Security and privacy, in brief

* Transcripts and note contents are **never logged**. Logs carry only ids, sizes,
  timings and token counts.
* **Prompt-injection hardening:** the transcript is delimited and declared
  untrusted, the model is told to ignore instructions inside it, and the output
  is constrained by schema.
* **Least privilege:** the worker can call `bedrock:InvokeModel` only on the
  configured model and inference-profile ARNs. The API function can only
  read/write the table and invoke the worker.
* **Encryption** at rest (DynamoDB SSE, PITR) and in transit (TLS).
* **Data stays in AWS:** Bedrock doesn't use prompts or outputs to train models.
* **Clinician in the loop:** `review_flags` and `used_defaults` badges make the vet
  confirm uncertain content. VetScribe is a documentation aid, not a diagnostic tool.

See [ADR-0011](../adr/0011-security-and-privacy.md).
