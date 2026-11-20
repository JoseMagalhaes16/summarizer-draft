import { PageHead } from '../../../components/ui';
import { CodeRefs, Question } from '../DocBits';
import { Diagram } from '../Diagram';

const TODAY = `flowchart LR
  T["One transcript<br/>plus patient details"] --> G1["Bedrock call 1<br/>SOAP template"] --> A["Note A: SOAP<br/>clinical tone"]
  T -->|"Draft another note"| G2["Bedrock call 2<br/>Client discharge template"] --> B["Note B: client discharge<br/>client-friendly tone"]
  class A,B accent`;

const PLANNED = `flowchart LR
  V["Visit<br/>one transcript"] --> API["POST /v1/visits/{id}/outputs<br/>template_ids"]
  API --> W1["Worker: SOAP"]
  API --> W2["Worker: Client discharge"]
  W1 --> N1["Note A"]
  W2 --> N2["Note B"]
  class V,API flag`;

const LAYOUT = `flowchart TB
  subgraph TODAY["Today: template before transcript"]
    direction LR
    a1["System prompt"] --> a2["Template block"] --> a3["Transcript"]
  end
  subgraph PLAN["Planned: stable prefix first"]
    direction LR
    b1["System prompt"] --> b2["Transcript"] --> b3["Cache breakpoint"] --> b4["Template block"]
  end
  TODAY ~~~ PLAN
  class a2 quiet
  class b3 flag
  class b1,b2 accent`;

export function MultipleOutputsPage() {
  return (
    <div className="doc">
      <PageHead title="SOAP and client note from one transcript" subtitle="How to get both from a single recording, today and in future." />

      <Question
        id="q-both"
        title="How can I record a single note but then generate both a SOAP and a client note?"
        answer={
          <>
            Paste the transcript once and generate the SOAP note. Then, on the note page, choose <strong>Draft another note</strong> and pick &ldquo;Client Discharge
            Summary&rdquo;.
          </>
        }
      >
        <p>
          VetScribe creates a second note from the same transcript and patient details. Each note has its own template snapshot and its own Bedrock call, and both appear in
          Notes. (<strong>Regenerate</strong> with a different template replaces the current note instead of adding one.)
        </p>
        <Diagram
          source={TODAY}
          caption="One transcript, two notes, two separate calls."
          description="One transcript with patient details goes into a first Bedrock call using the SOAP template, producing note A with a clinical tone. Using Draft another note, the same transcript goes into a second Bedrock call with the Client Discharge template, producing note B with a client-friendly tone."
        />
      </Question>

      <Question
        id="q-planned"
        title="Planned: one-click multiple outputs (not built yet)"
        answer="A visit would group the notes made from one transcript, and one request would generate all the outputs you pick in parallel."
      >
        <ul className="doc-list">
          <li>
            A <strong>Visit</strong> groups notes from one transcript.
          </li>
          <li>
            <code>POST /v1/visits/{'{id}'}/outputs {'{template_ids:[…]}'}</code> generates them in parallel, one call per template.
          </li>
          <li>
            Reorder the prompt so the stable prefix is the system prompt plus the transcript, put a prompt-cache breakpoint after the transcript, and place the template block
            after it. The second and later outputs then read the transcript from cache, which makes input cheaper and the first token faster.
          </li>
        </ul>
        <Diagram
          source={PLANNED}
          caption="Planned: one request, one call per template."
          description="Planned flow. A visit holds one transcript. A request to POST /v1/visits/id/outputs with a list of template ids starts one worker per template in parallel, one for the SOAP note and one for the client discharge note, producing note A and note B."
        />
        <p>
          Today the template comes before the transcript, so two outputs from the same transcript do not share a cacheable prefix.
        </p>
        <Diagram
          source={LAYOUT}
          caption="Prompt layout today and as planned, with the cache breakpoint."
          description="Two prompt layouts. Today: system prompt, then template block, then transcript, so the part that differs comes first. Planned: system prompt, then transcript, then a cache breakpoint, then the template block, so every output shares the same cached prefix."
        />
      </Question>

      <Question
        id="q-rejected"
        title="Why not one call that writes both notes?"
        answer="It was considered and rejected. It makes the output longer, ties both notes to one failure, and mixes two tones in a single generation."
      >
        <ul className="doc-list">
          <li>A combined schema means a longer output and a longer wait for either note.</li>
          <li>One failure sinks both notes.</li>
          <li>Clinical and client-friendly tone in one generation tends to bleed into each other.</li>
        </ul>
      </Question>

      <CodeRefs
        files={[
          ['frontend/src/features/notes/DraftAnotherDialog.tsx', 'Draft another note'],
          ['frontend/src/features/notes/NotePage.tsx', 'Action on the note page'],
          ['backend/src/vetscribe/services/notes.py', 'Note creation'],
          ['backend/src/vetscribe/prompts/builder.py', 'Prompt layout'],
        ]}
        adrs={['ADR-0005 Async generation and polling', 'ADR-0007 Template model']}
      />
    </div>
  );
}
