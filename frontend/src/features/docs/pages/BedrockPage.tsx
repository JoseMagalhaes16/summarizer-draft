import { Link } from 'react-router';
import { PageHead } from '../../../components/ui';
import { CodeRefs, DocTable, Question } from '../DocBits';
import { Diagram } from '../Diagram';

const LAYERS = `flowchart TB
  L1["1 botocore client<br/>adaptive retries, 2 attempts"] -->|"still failing"| L2["2 Adapter<br/>stop_reason checks, tool-mode extra attempt"]
  L2 -->|"error raised"| L3["3 Worker Lambda<br/>900 s timeout, deadline, conditional writes"]
  L3 -->|"worker crashed or timed out"| L4["4 Async invoke<br/>1 automatic retry, then SQS DLQ"]
  L4 -->|"DLQ handler marks failed"| L5["5 Read path<br/>pending or processing for 20 min becomes failed"]
  L5 --> V["Vet sees a clear message and can regenerate"]
  class V accent`;

const SEQ = `sequenceDiagram
  participant W as Worker Lambda
  participant C as boto3 client
  participant BR as Bedrock Runtime
  W->>C: invoke_model with the request body
  C->>BR: Attempt 1
  BR-->>C: ThrottlingException
  Note over C: Adaptive mode slows down, client-side rate limiting
  C->>BR: Attempt 2
  BR-->>C: 200 with stop_reason end_turn
  C-->>W: Response
  W->>W: Check stop_reason, then parse and validate JSON`;

export function BedrockPage() {
  return (
    <div className="doc">
      <PageHead title="The Bedrock request" subtitle="Which library, which API, which parameters, and what happens when things go wrong." />

      <Question
        id="q-library"
        title="Which library do we use? Is it Converse?"
        answer={
          <>
            We use <code>boto3</code> with the <code>bedrock-runtime</code> client and its <code>invoke_model</code> call (the InvokeModel API), sending Anthropic&rsquo;s
            native Messages body. It is not Converse.
          </>
        }
      >
        <p>
          The body carries <code>anthropic_version: &quot;bedrock-2023-05-31&quot;</code>, which is Anthropic&rsquo;s own request format, so the code maps one-to-one to
          Anthropic&rsquo;s documentation, including <code>output_config</code> (structured output and effort).
        </p>
        <p>
          Converse would also work. It supports structured output natively through <code>outputConfig.textFormat</code> with a <code>json_schema</code>, and gives one
          request shape across Bedrock model vendors. The trade-off is that its request is Bedrock&rsquo;s vendor-neutral format, so Anthropic-only options it doesn&rsquo;t
          model directly would go through <code>additionalModelRequestFields</code>. Choosing InvokeModel is a preference, not a requirement. Switching would only change{' '}
          <code>backend/src/vetscribe/llm/bedrock.py</code>.
        </p>
        <p>
          It is also not the Anthropic API: requests go to Bedrock and stay inside your AWS account (ADR-0003).
        </p>
      </Question>

      <Question
        id="q-params"
        title="Which parameters do we send?"
        answer="A model id, a JSON body with max_tokens 16000 and an effort level, and nothing else that tunes randomness. Temperature and top_p are left out because current models reject them."
      >
        <DocTable
          caption="Request parameters"
          head={['Parameter', 'Value', 'Notes']}
          rows={[
            [<code key="a">modelId</code>, <code key="a2">us.anthropic.claude-opus-5-5</code>, <>US cross-region inference profile. Set with <code>BEDROCK_MODEL_ID</code>.</>],
            [<code key="b">contentType, accept</code>, <code key="b2">application/json</code>, 'Both headers.'],
            [<code key="c">max_tokens</code>, '16000', 'Upper bound on output tokens.'],
            [<code key="d">output_config.effort</code>, <code key="d2">medium</code>, <>Default. Also <code>low</code> or <code>high</code>, set with <code>BEDROCK_EFFORT</code>.</>],
            [<code key="e">temperature, top_p</code>, 'Not sent', 'Rejected by current models.'],
            ['Thinking', 'Model default', 'Adaptive thinking is on by default, so nothing is configured.'],
          ]}
        />
        <p>
          See the <Link to="/docs/prompt">Prompt</Link> page for a real request body you can inspect and copy.
        </p>
      </Question>

      <Question
        id="q-retries"
        title="How are retries handled?"
        answer="In five layers, from the HTTP client up to the database. Cheap transient problems are retried quickly, and anything that still fails ends with the note marked failed so the vet can regenerate it."
      >
        <Diagram
          source={LAYERS}
          caption="Five layers of retry and recovery."
          description="Five layers in order. One: the botocore client retries with adaptive mode, two attempts in total. Two: the adapter checks stop_reason and, in tool mode, may make one extra attempt. Three: the worker Lambda has a 900 second timeout, a deadline and conditional writes. Four: asynchronous invoke retries once, then sends the event to an SQS dead-letter queue. Five: the read path reports a note that is still pending or processing after 20 minutes as failed. The result is a clear message and the option to regenerate."
        />
        <DocTable
          caption="Retry layers"
          head={['Layer', 'What it does']}
          rows={[
            [
              '1. botocore client',
              <>
                Connect timeout 10 s, read timeout 240 s (<code>BEDROCK_READ_TIMEOUT_S</code>). Retry mode <code>adaptive</code> with <code>total_max_attempts: 2</code>, which
                retries throttling, 5xx errors and timeouts and rate-limits itself on the client side.
              </>,
            ],
            [
              '2. Adapter',
              <>
                Checks <code>stop_reason</code> before reading output: <code>refusal</code> gives MODEL_REFUSAL and <code>max_tokens</code> gives OUTPUT_TRUNCATED. AWS errors give
                LLM_ERROR and unparseable JSON gives INVALID_MODEL_OUTPUT. In tool mode there is one extra attempt, only if the deadline still allows (remaining time greater than
                the read timeout plus a margin).
              </>,
            ],
            [
              '3. Worker Lambda',
              <>
                Timeout 900 s. It passes the adapter a deadline of remaining time minus 30 s. Any exception marks the note failed (INTERNAL). Every write is conditional on the
                note&rsquo;s <code>generation_id</code>, so an older run can never overwrite a newer one.
              </>,
            ],
            [
              '4. Lambda async invoke',
              <>
                One automatic retry, then the event goes to an SQS dead-letter queue. The DLQ handler marks the note failed with GENERATION_TIMEOUT.
              </>,
            ],
            [
              '5. Read-path safety net',
              <>
                A note still pending or processing after 20 minutes (<code>STALE_GENERATION_SECONDS</code>) is reported and stored as GENERATION_TIMEOUT, so the vet can
                regenerate.
              </>,
            ],
          ]}
        />
        <Diagram
          source={SEQ}
          caption="One call with a throttle retry."
          description="Sequence: the worker asks the boto3 client to invoke the model. The first attempt to Bedrock Runtime is throttled. In adaptive mode the client slows down and tries again. The second attempt succeeds with stop_reason end_turn. The worker checks stop_reason, then parses and validates the JSON."
        />
      </Question>

      <Question
        id="q-safety"
        title="What can the model access, and what gets logged?"
        answer="Only the one model it is configured for, and never note content in the logs."
      >
        <p>
          IAM allows only <code>bedrock:InvokeModel</code> on the configured inference profile and foundation model ARNs. Logs never contain transcript or note text.
        </p>
      </Question>

      <CodeRefs
        files={[
          ['backend/src/vetscribe/llm/bedrock.py', 'Client, request body, stop_reason handling'],
          ['backend/src/vetscribe/handlers/worker.py', 'Deadline and conditional writes'],
          ['backend/src/vetscribe/handlers/dlq.py', 'Dead-letter queue handler'],
          ['backend/src/vetscribe/services/notes.py', 'Stale generation check'],
          ['infra/template.yaml', 'Timeouts, DLQ and IAM'],
        ]}
        adrs={['ADR-0003 LLM access: Bedrock InvokeModel', 'ADR-0005 Async generation and polling', 'ADR-0012 Generation consistency and recovery']}
      />
    </div>
  );
}
