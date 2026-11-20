import { PageHead } from '../../../components/ui';
import { CodeRefs, Question } from '../DocBits';
import { Diagram } from '../Diagram';

const COMPARE = `flowchart LR
  subgraph NOW["What VetScribe does"]
    direction LR
    t1["Transcript + template"] --> c1["One Bedrock call"] --> n1["Note"]
  end
  subgraph NOT["Not used: extract, then write"]
    direction LR
    t2["Transcript"] -.-> e["Call 1<br/>extract facts"] -.-> w["Call 2<br/>write the note"] -.-> n2["Note"]
  end
  class c1,n1 accent
  class t2,e,w,n2 quiet`;

export function CallsPage() {
  return (
    <div className="doc">
      <PageHead title="One call or two?" subtitle="Why a note needs a single model call, and when that might change." />

      <Question
        id="q-two"
        title="Does it run things through two prompts or a single one?"
        answer="A single Bedrock call per note: one transcript and one template go in, one note comes out. There is no extract-then-write chain."
      >
        <p>There are only two exceptions, and neither changes the design:</p>
        <ul className="doc-list">
          <li>In tool mode, the adapter may retry once if Claude does not call the tool.</li>
          <li>Evaluation runs can optionally call a second model as a judge. That happens in evals only, never when generating a note.</li>
        </ul>
        <Diagram
          source={COMPARE}
          caption="The single call we use, next to a two-step chain we do not."
          description="Two flows. What VetScribe does: transcript and template go into one Bedrock call, which produces the note. Not used: a transcript goes to a first call that extracts facts, then a second call that writes the note. The two-step flow is drawn dashed and labelled not used."
        />
      </Question>

      <Question
        id="q-why"
        title="Why one call?"
        answer="It is faster, cheaper and easier to trust. The schema already forces the structure, so a separate extraction step would add cost without adding control."
      >
        <ul className="doc-list">
          <li>
            <strong>Lower latency and cost.</strong> One round trip and one pass over the transcript.
          </li>
          <li>
            <strong>One source of truth.</strong> The note is written straight from the transcript. A chain adds an intermediate summary that can drop or distort a dose before
            the second call ever sees it.
          </li>
          <li>
            <strong>Structure is already enforced.</strong> The JSON schema decides which sections and fields exist, so there is nothing for an extraction step to organise.
          </li>
        </ul>
      </Question>

      <Question
        id="q-later"
        title="When would a second call make sense?"
        answer="Only if a clear need appears. None of these is built today."
      >
        <ul className="doc-list">
          <li>Several outputs for one visit, such as a SOAP note and a client note (see the SOAP + client note tab).</li>
          <li>Extract-then-verify for very long transcripts that do not fit comfortably in one request.</li>
          <li>A self-check pass that compares the note against the transcript.</li>
        </ul>
      </Question>

      <CodeRefs
        files={[
          ['backend/src/vetscribe/llm/bedrock.py', 'The single invoke_model call'],
          ['backend/src/vetscribe/prompts/builder.py', 'Builds the one request'],
          ['backend/src/vetscribe/evals/judge.py', 'Optional judge, evals only'],
        ]}
        adrs={['ADR-0004 Structured output with JSON schema', 'ADR-0013 Evaluation approach']}
      />
    </div>
  );
}
