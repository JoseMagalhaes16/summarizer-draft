import { PageHead } from '../../../components/ui';
import { CodeRefs, Question } from '../DocBits';
import { Diagram } from '../Diagram';

const ARCH = `flowchart LR
  B["Browser SPA"] -->|HTTPS| G["API Gateway<br/>HTTP API"]
  G --> A["API Lambda<br/>Powertools router"]
  A <--> D[("DynamoDB")]
  A -->|"async invoke"| W["Worker Lambda"]
  W -->|"one call"| R["Bedrock Runtime<br/>Claude"]
  W -->|"save note"| D
  W -.->|"failed async invokes"| Q["SQS dead-letter queue"]
  Q --> H["DLQ handler Lambda"]
  H -->|"mark failed"| D
  class R accent
  class Q flag`;

const SEQ = `sequenceDiagram
  autonumber
  actor Vet
  participant UI as Browser
  participant API as API Lambda
  participant DB as DynamoDB
  participant W as Worker Lambda
  participant BR as Bedrock
  Vet->>UI: Pick template and paste transcript
  UI->>API: POST /v1/notes
  API->>DB: Save note as pending with template snapshot and generation_id
  API-)W: Invoke asynchronously
  API-->>UI: 202 with the note
  W->>DB: Status processing
  W->>BR: One Bedrock call
  BR-->>W: Structured note
  W->>W: Validate and post-process
  W->>DB: Status completed
  loop every 1.5 s until completed or failed
    UI->>API: GET /v1/notes/{id}
    API-->>UI: Current status and note
  end`;

const STATES = `stateDiagram-v2
  [*] --> pending: POST /v1/notes
  pending --> processing: worker starts
  processing --> completed: valid note stored
  processing --> failed: error or timeout
  pending --> failed: timeout
  completed --> pending: regenerate
  failed --> pending: regenerate
  completed --> completed: edits keep completed`;

export function HowItWorksPage() {
  return (
    <div className="doc">
      <PageHead title="How VetScribe works" subtitle="From a pasted transcript to a draft note, step by step." />

      <Question
        id="q-flow"
        title="What happens when I press Generate?"
        answer="The browser saves your transcript as a pending note and gets an answer right away. A separate worker then makes one Bedrock call and stores the draft, while the page checks for it every 1.5 seconds."
      >
        <p>
          The API never waits for the model. Drafting can take longer than an HTTP request should stay open, so the API Lambda saves the note, starts the worker Lambda
          asynchronously and returns <code>202</code>. The note carries a copy of the template as it was at that moment (its template snapshot) and a{' '}
          <code>generation_id</code> that identifies this attempt.
        </p>
        <Diagram
          source={SEQ}
          caption="One note from request to finished draft."
          description="Sequence: the vet picks a template and pastes a transcript. The browser posts to the API, which saves the note as pending, invokes the worker asynchronously and returns 202. The worker sets the status to processing, makes one Bedrock call, validates and post-processes the result and sets the status to completed. Meanwhile the browser polls the note every 1.5 seconds."
        />
      </Question>

      <Question
        id="q-parts"
        title="Which parts of AWS are involved?"
        answer="A static web app, an HTTP API, two main Lambdas (API and worker), DynamoDB for notes and templates, Bedrock for the model, and an SQS dead-letter queue that catches failed background runs."
      >
        <Diagram
          source={ARCH}
          caption="Components and how they talk to each other."
          description="Architecture: the browser calls API Gateway, which calls the API Lambda. The API Lambda reads and writes DynamoDB and asynchronously invokes the Worker Lambda. The worker makes one call to Bedrock Runtime and saves the result in DynamoDB. Failed asynchronous invokes go to an SQS dead-letter queue, whose handler Lambda marks the note failed in DynamoDB."
        />
      </Question>

      <Question
        id="q-states"
        title="What do the note statuses mean?"
        answer="A note is pending until the worker picks it up, processing while the model works, then completed or failed. Regenerating sends it back to pending; editing a completed note keeps it completed."
      >
        <Diagram
          source={STATES}
          caption="Note status changes."
          description="State diagram: a new note is pending. It moves to processing when the worker starts, then to completed when a valid note is stored, or to failed on an error or timeout. A pending note can also fail on timeout. Completed and failed notes return to pending when regenerated. Editing a completed note leaves it completed."
        />
      </Question>

      <Question
        id="q-local"
        title="Can I try it without AWS?"
        answer="Yes. Local mock mode runs the same code with a mock LLM and in-memory storage, so you can click through everything offline."
      >
        <p>
          The mock generator is deterministic and offline, which is why the app shows a Mock mode pill. The request and response shapes are identical to production, so what
          you see here is what the real thing does, minus the model.
        </p>
      </Question>

      <CodeRefs
        files={[
          ['backend/src/vetscribe/handlers/api.py', 'API Lambda and router'],
          ['backend/src/vetscribe/handlers/worker.py', 'Worker Lambda'],
          ['backend/src/vetscribe/handlers/dlq.py', 'Dead-letter queue handler'],
          ['backend/src/vetscribe/services/notes.py', 'Note lifecycle and status rules'],
          ['infra/template.yaml', 'AWS SAM template'],
          ['frontend/src/api/hooks.ts', 'Polling (useNote)'],
        ]}
        adrs={['ADR-0002 Compute: Lambda', 'ADR-0005 Async generation and polling', 'ADR-0008 Local development and mock mode']}
      />
    </div>
  );
}
