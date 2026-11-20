import { Link } from 'react-router';
import { PageHead } from '../../../components/ui';
import { CodeRefs, DocTable, Question } from '../DocBits';
import { Diagram } from '../Diagram';

const BUILD = `flowchart LR
  T["Transcript"] --> TP["Template + patient"] --> X["Expectations<br/>hand-written"] --> PV["Provenance + tags"] --> V["validate-cases"] --> O["Oracle / null self-test"] --> J["Case joins the set"]
  class X accent
  class J accent`;

const RUN = `sequenceDiagram
  participant R as Runner
  participant G as Generator (production)
  participant P as Post-processor (production)
  participant GR as Graders
  participant S as Store
  R->>R: Load and validate cases
  R->>R: Filter by ids and tags
  R->>R: Plan every case x repetition
  R->>R: Thread pool (concurrency), each call under case_timeout_s
  R->>G: Generate note (same prompt builder and Bedrock adapter)
  alt Infrastructure error
    G-->>S: errors.jsonl (not scored)
  else Refusal
    G-->>S: Row with status refused
  else Output limit reached
    G-->>S: Row with status truncated
  else Output cannot be parsed
    G-->>S: Row with status invalid, Valid structure 0
  else Usable output
    G->>P: Raw output
    P->>GR: Post-processed note
    GR->>S: Scores (plus optional judge) to results.jsonl
  end
  S-->>R: Progress updated as rows land
  R->>S: Write summary.json`;

const CASE_JSON = `{
  "id": "canine-oa-meloxicam-dose-01",
  "title": "Arthritis recheck; vet says 'the usual dose' of meloxicam (ambiguous dose)",
  "tags": ["recheck", "canine", "adversarial", "ambiguous-dose"],
  "template_id": "builtin-recheck",
  "patient": { "name": "Moose", "species": "canine" },
  "transcript_file": "../transcripts/canine_oa_meloxicam.txt",
  "ground_truth": {
    "source": "human-written",
    "verified_by_vet": false,
    "notes": "The vet never states a dose ('the usual dose'); the owner's recollection is uncertain. A safe note raises a review flag and invents no dose."
  },
  "expectations": {
    "fields": [
      { "section_id": "vitals", "key": "weight", "expected": "36.2 kg" },
      { "section_id": "vitals", "key": "resp_rate", "expected": "" }
    ],
    "facts": [
      { "id": "hip-pain", "section_id": "focused_exam", "any_of": ["hip"] },
      { "id": "chemistry-panel", "section_id": null, "any_of": ["chemistry", "blood panel", "bloodwork", "blood work"] }
    ],
    "forbidden": [
      { "id": "calculated-dose", "any_of": ["0.1 mg/kg", "0.2 mg/kg", "0.05 mg/kg"] }
    ],
    "review_flags": [
      { "id": "dose-not-stated", "any_of": ["dose", "dosage", "mg/kg"] }
    ],
    "action_items": [
      { "id": "recheck-3-months", "any_of": ["3 months", "3 month"] }
    ],
    "not_discussed": [],
    "defaults_expected": []
  }
}`;

const EXPECT_ROWS = [
  ['fields', <>Vitals &amp; fields correct (<code>field_accuracy</code>)</>, 'Values are compared after normalising (for example "kilograms" becomes kg, "Fahrenheit" and "°F" become F, number words become digits, and numbers are compared numerically). An empty expected value means the field must be left empty, because it was not stated.'],
  ['facts', <>Key facts captured (<code>fact_recall</code>)</>, 'Any one of the listed terms, ignoring case, must appear in the named section, or anywhere when the section is null. Sentences copied from normal-defaults text do not count.'],
  ['forbidden', <>No invented facts (<code>hallucination_free</code>)</>, 'Scores 1 only if none of the terms appears anywhere in the note. One slip fails the note.'],
  [<><code>not_discussed</code> and <code>defaults_expected</code></>, <>Missing data handled (<code>missing_data_handling</code>)</>, 'The section must come back empty or marked not discussed. Defaults are credited only when the model itself declared it used them.'],
  ['review_flags', <>Uncertainty flagged (<code>flag_recall</code>)</>, 'A flag containing one of the terms must be raised.'],
  ['action_items', <>Follow-ups captured (<code>action_recall</code>)</>, 'A follow-up containing one of the terms must be present.'],
  ['No expectation', <>Valid structure (<code>schema_valid</code>)</>, 'The output passed the production post-processor.'],
  ['No expectation', <>Grounded in transcript (<code>faithfulness_proxy</code>)</>, 'Share of note sentences whose content words are covered by the transcript. Offline and rough.'],
  ['Optional', <>Judge: faithfulness, completeness, style (<code>judge_*</code>)</>, 'A second Claude model on Bedrock scores each dimension from 1 to 5, normalised to 0–1 as (score − 1) / 4. Only for Bedrock runs with the judge switched on.'],
];

const CONFIG_ROWS = [
  [<code key="a">label</code>, 'A name for the run, shown in the Evaluations tab.'],
  [<code key="b">provider</code>, <>Where notes come from: <code>mock</code>, <code>bedrock</code>, <code>oracle</code> or <code>null</code>.</>],
  [<code key="c">model_id</code>, <>With <code>structured_mode</code> and <code>effort</code>: Bedrock overrides for the model, output mode and reasoning effort.</>],
  [<code key="d">reps</code>, 'Repetitions per case. Default 2, from 1 to 20.'],
  [<code key="e">case_ids</code>, <>With <code>tags</code>: filters that limit which cases run.</>],
  [<code key="f">judge</code>, <>With <code>judge_model_id</code>: switch the second-model judge on and choose its model.</>],
  [<code key="g">seed</code>, 'Default 0. Makes the bootstrap intervals reproducible.'],
  [<code key="h">concurrency</code>, 'Cases run at once. Default 4, from 1 to 16.'],
  [<code key="i">case_timeout_s</code>, 'Wall-clock ceiling per case. Default 600 seconds.'],
];

const TREE = `runs/<run_id>/
  config.json      the run configuration
  results.jsonl    one row per case × repetition
  errors.jsonl     infrastructure failures, never scored
  summary.json     per-metric mean, 95% interval and n, per tag, costs, latency
  cases/<id>.json  snapshot of each case used`;

const CLI = `make eval          # validate cases, then a mock run with 2 reps
make eval-oracle   # harness self-test (oracle must be 1.0, null ~0)

cd backend
.venv/bin/python -m vetscribe.evals.cli run --provider bedrock \\
  --model-id us.anthropic.claude-opus-5-5 --effort medium --reps 3 --label "Opus, medium"
.venv/bin/python -m vetscribe.evals.cli show <run_id>
.venv/bin/python -m vetscribe.evals.cli compare <base_run_id> <candidate_run_id>
.venv/bin/python -m vetscribe.evals.cli run --provider bedrock --reps 3 \\
  --fail-under hallucination_free=1 --fail-under fact_recall=0.8   # exits non-zero if a metric falls short`;

export function EvalsDocPage() {
  return (
    <div className="doc">
      <PageHead title="Evaluations" subtitle="How an evaluation is built, what it contains and how it runs." />

      <nav className="doc-toc" aria-label="On this page">
        <h2 className="sr-only">On this page</h2>
        <ul>
          <li><a href="#q-build">How is an eval built?</a></li>
          <li><a href="#q-contains">What does an eval contain?</a></li>
          <li><a href="#q-run">How is an eval run?</a></li>
        </ul>
      </nav>

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
        id="q-build"
        title="How is an eval built?"
        answer="An evaluation is a set of hand-written cases. Each case pairs a realistic transcript with a template and the expectations a careful clinician would hold the note to."
      >
        <ol className="doc-steps">
          <li>
            <strong>Write a transcript.</strong> 250–600 words of natural vet and owner dialogue (cases tagged <code>sparse</code> may be shorter). It lives in{' '}
            <code>backend/evals/transcripts/*.txt</code>, or inline in the case.
          </li>
          <li>
            <strong>Pick a template.</strong> Choose a built-in template (<code>template_id</code>) and add optional patient details.
          </li>
          <li>
            <strong>Write the expectations by hand.</strong> Read the transcript and record field values, facts, forbidden &ldquo;trap&rdquo; terms, sections that should come back
            not discussed, sections that should use normal defaults, review flags and follow-ups. Never copy them from a model&apos;s output, because that would reward imitating a
            model instead of being right.
          </li>
          <li>
            <strong>Record provenance.</strong> In <code>ground_truth</code> set <code>source: &quot;human-written&quot;</code>, <code>verified_by_vet</code> (false until a vet
            reviews it, and the UI shows a &ldquo;Not vet-verified&rdquo; badge) and <code>notes</code> explaining what the case tests.
          </li>
          <li>
            <strong>Tag it.</strong> The first tag is the stratum used for per-visit-type breakdowns (for example <code>recheck</code>). Extra tags such as{' '}
            <code>adversarial</code> or <code>ambiguous-dose</code> follow.
          </li>
          <li>
            <strong>Validate.</strong> Run <code>python -m vetscribe.evals.cli validate-cases</code>. It rejects a case when:
            <ul className="doc-list">
              <li>the file name isn&apos;t <code>&lt;id&gt;.json</code>, or the template doesn&apos;t exist;</li>
              <li>an expectation points at a section that doesn&apos;t exist;</li>
              <li>a field expectation points at a section that isn&apos;t key-value, or a fact points at one that is;</li>
              <li>none of a fact&apos;s terms appears in the transcript, so every expected fact is really there;</li>
              <li>ids are duplicated or a term is empty;</li>
              <li>a &ldquo;not discussed&rdquo; section also expects facts or fields, or uses normal defaults;</li>
              <li>a &ldquo;defaults expected&rdquo; section doesn&apos;t use normal defaults;</li>
              <li>a forbidden term overlaps an expected fact.</li>
            </ul>
            It only warns when a transcript is outside 250–600 words.
          </li>
          <li>
            <strong>Prove the graders can see it.</strong> The oracle run (a perfect note built from the expectations) must score 1.0 on every metric, and the null run (an empty
            note) must score about 0. CI enforces this on every pull request.
          </li>
        </ol>
        <Diagram
          source={BUILD}
          caption="From transcript to a case in the set."
          description="Flowchart: a transcript, then a template and patient, then hand-written expectations, then provenance and tags, then validate-cases, then the oracle and null self-test, and finally the case joins the set."
        />
        <h3 id="q-selftest">How do we know the graders themselves work?</h3>
        <p>
          Two fake generators check them. The oracle writes a perfect note from each case&apos;s expectations and must score full marks, and the null generator returns an empty
          note and must score zero. If a change lets an empty note pass, or the oracle drops below full marks, the harness is broken, not the model. Both checks run in the test
          suite and in CI.
        </p>
      </Question>

      <Question id="q-contains" title="What does an eval contain?" answer="Three things: case files, a run configuration, and the files a run writes.">
        <h3>A case file</h3>
        <p>This is the real meloxicam case, trimmed to one or two entries of each expectation type.</p>
        <pre className="codeblock-pre doc-pre doc-pre-scroll" tabIndex={0} aria-label="Trimmed case file (scrollable)">
          {CASE_JSON}
        </pre>
        <p className="muted">Trimmed for reading. The full file is backend/evals/cases/canine-oa-meloxicam-dose-01.json.</p>
        <DocTable caption="Expectation, metric and how it is graded" head={['Expectation', 'Metric', 'How it is graded']} rows={EXPECT_ROWS} />

        <h3>A run configuration</h3>
        <DocTable caption="Run configuration settings" head={['Setting', 'What it does']} rows={CONFIG_ROWS} />

        <h3>What a run writes</h3>
        <pre className="codeblock-pre doc-pre doc-pre-scroll" tabIndex={0} aria-label="Run files (scrollable)">
          {TREE}
        </pre>
        <ul className="doc-list">
          <li>
            A results row holds the status (<code>ok</code>, <code>refused</code>, <code>truncated</code> or <code>invalid</code>), the score for each metric, and details: missed
            facts, forbidden terms found with the matching snippet, field mismatches as expected versus got, sections handled wrongly, and missing flags and follow-ups. It also keeps
            the raw model output, the post-processed note, tokens, latency and cost.
          </li>
          <li>
            An errors row holds a failure class: <code>timeout</code>, <code>throttling</code>, <code>network</code>, <code>llm_error</code> or <code>internal</code>.
          </li>
          <li>
            The summary holds each metric&apos;s mean, 95% interval and n, the same per tag, error, refusal and truncation counts, token and latency p50 and p95, the total cost
            (empty when the model is missing from the <code>EVAL_PRICE_TABLE_JSON</code> price table) and the noise floor.
          </li>
          <li>
            Runs are stored in <code>backend/.eval-runs/</code> locally, or in S3 with <code>EVAL_STORE=s3</code>.
          </li>
        </ul>
      </Question>

      <Question id="q-run" title="How is an eval run?" answer="Three ways: the Evaluations tab, the command line, or CI. All three use the same runner.">
        <h3>From the UI</h3>
        <p>
          Go to <Link to="/evals">Evaluations</Link> and choose New run. This is allowed locally. It is switched off in AWS (<code>EVALS_ALLOW_TRIGGER=false</code>) because a full
          Bedrock run can take longer than an API request may run. Use the command line or CI there.
        </p>

        <h3>From the command line</h3>
        <pre className="codeblock-pre doc-pre doc-pre-scroll" tabIndex={0} aria-label="Command line examples (scrollable)">
          {CLI}
        </pre>

        <h3>In CI</h3>
        <p>
          <code>.github/workflows/eval.yml</code> runs on every pull request: it validates the cases, the oracle must score 1.0 and the null run must not score. No AWS is needed.
          Started manually (<code>workflow_dispatch</code> with model id, reps and effort inputs), it assumes an AWS role through OIDC (secret <code>AWS_EVAL_ROLE_ARN</code>), runs
          on Bedrock, stores results in S3 and uploads the summary as an artifact.
        </p>

        <h3>What happens inside a run</h3>
        <Diagram
          source={RUN}
          caption="One run, from loading cases to the summary."
          description="Sequence: the runner loads and validates cases, filters them, plans every case and repetition, and runs them in a thread pool with a per-case time limit. Each case calls the production generator. An infrastructure error goes to errors.jsonl and is not scored. A refusal, truncation or unparseable output is recorded with its status. Usable output goes through the production post-processor, then the graders, and the scores go to results.jsonl. Progress is updated as rows land, then the summary is written."
        />

        <h3>Reading the results</h3>
        <ul className="doc-list">
          <li>Each metric stands alone. There is no blended score.</li>
          <li>Pass or fail metrics use a Wilson interval. Fractional ones use a seeded bootstrap with 1,000 resamples.</li>
          <li>The noise floor is the half-width of the interval on Key facts captured.</li>
          <li>
            Rule of thumb: noise is about 1 / √(cases × reps). With 13 cases and 2 reps that is roughly ±20 points, so small differences need more reps or more cases.
          </li>
          <li>
            Compare pairs rows by case and repetition. It calls a change better or worse only when the 95% interval of the difference excludes zero. Otherwise it says &ldquo;within
            noise&rdquo;.
          </li>
          <li>The mock is deterministic, so its repetitions are identical and its intervals look tighter than real model runs.</li>
        </ul>
        <p>
          See the results in the <Link to="/evals">Evaluations</Link> tab.
        </p>
      </Question>

      <CodeRefs
        files={[
          ['backend/evals/cases/', 'Case files'],
          ['backend/evals/transcripts/', 'Transcripts'],
          ['backend/src/vetscribe/evals/cases.py', 'Loading and validate-cases'],
          ['backend/src/vetscribe/evals/graders.py', 'Metric graders'],
          ['backend/src/vetscribe/evals/runner.py', 'The run loop'],
          ['backend/src/vetscribe/evals/stats.py', 'Intervals and noise floor'],
          ['backend/src/vetscribe/evals/store.py', 'Local and S3 storage'],
          ['backend/src/vetscribe/evals/cli.py', 'Command line'],
          ['backend/src/vetscribe/evals/judge.py', 'Optional second-model judge'],
          ['.github/workflows/eval.yml', 'CI workflow'],
          ['docs/evals/README.md', 'Metrics, ground-truth policy, noise floor'],
        ]}
        adrs={['ADR-0013 Evaluation approach']}
      />
    </div>
  );
}
