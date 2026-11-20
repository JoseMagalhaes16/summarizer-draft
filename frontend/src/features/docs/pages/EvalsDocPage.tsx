import { Link } from 'react-router';
import { PageHead } from '../../../components/ui';
import { CodeRefs, Question } from '../DocBits';
import { Diagram } from '../Diagram';

const PIPE = `flowchart LR
  C["Cases<br/>human-written expectations"] --> G["Production generator<br/>same prompt builder"] --> P["Post-processor<br/>same as production"] --> GR["Graders"] --> S["Stats and CI"] --> ST["Store"] --> U["UI and CLI"]
  G -.->|"infrastructure error"| E["errors.jsonl<br/>not scored"]
  class G,P accent
  class E quiet`;

export function EvalsDocPage() {
  return (
    <div className="doc">
      <PageHead title="Evaluations in brief" subtitle="How we know a prompt, template or model change helped." />

      <Question
        id="q-measure"
        title="What do evaluations measure?"
        answer={
          <>
            Specific, dangerous failures: invented findings, dropped doses, converted units, filled-in sections nobody discussed, and obeying text inside the transcript. Results
            live in the <Link to="/evals">Evaluations</Link> tab.
          </>
        }
      >
        <p>
          Each metric is checked against expectations a person wrote from the transcript, and each is reported separately with its confidence interval. There is no blended
          score, because a gain in recall could hide a new hallucination.
        </p>
      </Question>

      <Question
        id="q-pipeline"
        title="How does a run work?"
        answer="Cases go through the same generator and post-processor as production, then deterministic graders score the result and the stats are stored for the UI and CLI."
      >
        <Diagram
          source={PIPE}
          caption="The evaluation pipeline."
          description="Pipeline: cases go to the production generator, then the production post-processor, then graders, then statistics with confidence intervals, then the store, which feeds the Evaluations tab and the CLI. Infrastructure errors from the generator go to an errors file and are not scored."
        />
      </Question>

      <Question
        id="q-selftest"
        title="How do we know the graders themselves work?"
        answer="Two fake generators check them. The oracle writes a perfect note from each case's expectations and must score full marks, and the null generator returns an empty note and must score zero."
      >
        <p>
          If a change lets an empty note pass, or the oracle drops below full marks, the harness is broken, not the model. Both checks run in the test suite and in CI.
        </p>
      </Question>

      <Question id="q-run" title="How do I run one?" answer="Use make eval for the offline run, or the CLI to point it at Bedrock.">
        <pre className="codeblock-pre doc-pre" tabIndex={0}>
          {`make eval\npython -m vetscribe.evals.cli run --provider bedrock …`}
        </pre>
      </Question>

      <CodeRefs
        files={[
          ['backend/src/vetscribe/evals/', 'Runner, graders, stats, store, CLI'],
          ['docs/evals/README.md', 'Metrics, ground-truth policy, noise floor'],
        ]}
        adrs={['ADR-0013 Evaluation approach']}
      />
    </div>
  );
}
