import { PageHead } from '../../../components/ui';
import { CodeRefs, DocTable, Question } from '../DocBits';
import { Diagram } from '../Diagram';

const FLOW = `flowchart LR
  P["Prompt<br/>instructed content rules"] --> M["Claude"]
  S["JSON schema<br/>built from the template"] -->|"constrains the answer"| M
  M --> C["Schema check<br/>guaranteed shape"] --> PP["Post-processor<br/>deterministic fixes and flags"] --> N["Stored note"]
  class S,C accent
  class P flag
  class PP accent`;

const LADDER = `flowchart TB
  G["Guaranteed: JSON schema<br/>sections, field keys, types"]
  I["Instructed: prompt<br/>content rules, measured by evaluations"]
  D["Deterministic code: post-processor<br/>order, missing-data rules, flags"]
  G --> I --> D
  class G,D accent
  class I flag`;

type Row = [situation: string, what: string, by: string, seen: string];

const ROWS: Row[] = [
  ['The template has no section for something the transcript mentions', 'It is not added to a section. The model raises a review flag.', 'Schema, Prompt, Post-processor', 'A line in Check before filing'],
  ['A template section the transcript does not cover', 'The section comes back empty and is treated by its missing behaviour.', 'Schema, Prompt, Post-processor', 'Hidden, "Not discussed." or defaults; a flag if required'],
  ['Normal defaults', 'Defaults fill only what was not mentioned, and the section is marked.', 'Prompt, Post-processor, UI', 'Normal defaults: confirm'],
  ['Empty fields in key-value sections', 'Every field is present; unstated ones are empty.', 'Schema, Prompt, Post-processor, UI', 'Muted "not stated"'],
  ['Values and units', 'Kept exactly as spoken, never converted.', 'Prompt', 'A flag if a unit is missing or a value looks implausible'],
  ['Drug doses', 'Recorded only if stated, never calculated.', 'Prompt', 'A flag for any missing or ambiguous element'],
  ['Section order', 'Always the template order.', 'Post-processor', 'Sections appear as in the template'],
  ['Extra or unknown keys', 'Cannot occur, and would be ignored.', 'Schema, Post-processor', 'Not visible'],
  ['Instructions hidden in the transcript', 'Treated as speech to record, not as orders.', 'Prompt, Schema', 'Nothing changes in the note'],
  ['The model declines or runs out of room', 'The note fails with a clear reason.', 'Adapter checks stop_reason', 'Failed note with Regenerate'],
  ['Over-long output', 'The note fails as invalid output.', 'Post-processor', 'Failed note with Regenerate'],
  ['Tone and abbreviations', 'Follow the template style.', 'Prompt', 'Wording of the note'],
  ['The template is edited after a note was drafted', 'The existing note does not change.', 'Template snapshot', 'Regenerate uses the snapshot unless you pick another template'],
];

export function BehavioursPage() {
  return (
    <div className="doc">
      <PageHead title="Edge cases" subtitle="What happens when the transcript or the template is awkward, and what guarantees each behaviour." />

      <Question
        id="q-layers"
        title="Which behaviours are guaranteed, and which are only instructed?"
        answer="Three layers share the work. The JSON schema guarantees the shape, the prompt instructs the content, and the post-processor (plain code) fixes and flags what is left."
      >
        <ul className="doc-list">
          <li>
            <strong>JSON schema: guaranteed shape.</strong> Which sections exist, which field keys, which types. It is identical in both modes: structured output uses{' '}
            <code>output_config.format</code> with constrained decoding, and tool mode uses the same schema as the tool&rsquo;s <code>input_schema</code> with{' '}
            <code>strict: true</code>, so the tool input is equally guaranteed. The only extra failure in tool mode is that Claude may not call the tool (
            <code>tool_choice: auto</code>): that gets one retry, then INVALID_MODEL_OUTPUT. The schema never guarantees <em>content</em>.
          </li>
          <li>
            <strong>Prompt: instructed behaviour.</strong> Content rules the model is told to follow. They are not guaranteed, so Evaluations measure them.
          </li>
          <li>
            <strong>Post-processor: deterministic code.</strong> Fixes and flags applied after the model answers, the same for both modes.
          </li>
        </ul>
        <Diagram
          source={FLOW}
          caption="Where each layer acts on a note."
          description="The prompt is an input to Claude. The JSON schema, built from the template, constrains the answer. Claude's output goes through the schema check, then the post-processor, which applies deterministic fixes and flags, and the result is the stored note."
        />
        <Diagram
          source={LADDER}
          caption="The guarantee ladder."
          description="Three levels. Guaranteed: the JSON schema fixes sections, field keys and types. Instructed: the prompt sets content rules, measured by evaluations. Deterministic code: the post-processor handles order, missing-data rules and flags."
        />
      </Question>

      <Question
        id="q-content"
        title="Doesn't structured output make sure the content is correct?"
        answer="No. It guarantees the shape of the answer, not whether the values are true. Constrained decoding makes sure the JSON parses, every required key is there, nothing extra is added and each value has the right type. It cannot check a value against the transcript."
      >
        <p>Examples that are perfectly valid against the schema but wrong for the patient:</p>
        <ul className="doc-list">
          <li>
            <strong>A wrong value.</strong> The transcript says 34.2 kg, but <code>&quot;weight&quot;: &quot;35 kg&quot;</code> is still a valid string.
          </li>
          <li>
            <strong>An invented fact.</strong> A drug that was never mentioned is still a valid string inside <code>items</code>.
          </li>
          <li>
            <strong>Contradictory flags.</strong> <code>&quot;not_discussed&quot;: false</code> with invented content, or normal defaults used with{' '}
            <code>&quot;used_defaults&quot;: false</code>, both pass. The schema cannot express rules between fields (&ldquo;if not discussed, content is empty&rdquo;),
            because structured output doesn&rsquo;t support conditional schemas, string patterns or lengths, so it can&rsquo;t even force a unit such as &ldquo;kg&rdquo;.
          </li>
          <li>
            <strong>A refusal or a cut-off answer.</strong> Even the shape guarantee doesn&rsquo;t hold if the model refuses or hits its output limit, which is why the
            code checks <code>stop_reason</code> before reading the answer.
          </li>
        </ul>
        <p>
          That is why content is handled by the prompt (instructed), the post-processor (deterministic fixes and flags) and the Evaluations, which measure field accuracy,
          invented facts and whether defaults are flagged.
        </p>
      </Question>

      <Question
        id="q-table"
        title="What happens in each edge case?"
        answer="The table is the short version. Each row has a section below it."
      >
        <DocTable caption="Edge cases and what enforces them" head={['Situation', 'What happens', 'Enforced by', 'How you see it']} rows={ROWS} />
      </Question>

      <section className="doc-q" aria-label="Edge cases in detail">
        <h3 id="e-nosection">1. The template has no section for something the transcript mentions</h3>
        <p>
          The model cannot add sections: the schema lists exactly the template&rsquo;s section ids with <code>additionalProperties: false</code>. Prompt rule 9 tells it not to
          squeeze the information into an unrelated section but to raise a review flag such as &ldquo;Not captured by this template: dental tartar noted - consider a dental
          note&rdquo;. The post-processor ignores any unknown section key anyway.
        </p>
        <p>
          <strong>Tip:</strong> give custom templates an &ldquo;Other findings&rdquo; section with missing behaviour &ldquo;omit&rdquo;.
        </p>

        <h3 id="e-notcovered">2. A template section the transcript does not cover</h3>
        <p>
          The schema requires every section key, so the model returns the section empty with <code>not_discussed: true</code> (prompt). The post-processor honours{' '}
          <code>not_discussed</code>, clearing content unless the section uses normal defaults, and then applies the section&rsquo;s missing behaviour:
        </p>
        <ul className="doc-list">
          <li>
            <code>omit</code>: hidden in the note and left out of the copied text.
          </li>
          <li>
            <code>state_not_discussed</code>: shows &ldquo;Not discussed.&rdquo;
          </li>
          <li>
            <code>use_normal_defaults</code>: see the next point.
          </li>
        </ul>
        <p>
          If the section is <strong>required</strong>, the post-processor adds the review flag &ldquo;Required section not covered in the transcript: &lt;title&gt;&rdquo;. Prompt
          rule 10 tells the model to still return it empty. If a section key were missing entirely (only possible without the schema), the result is INVALID_MODEL_OUTPUT.
        </p>

        <h3 id="e-defaults">3. Normal defaults</h3>
        <ul className="doc-list">
          <li>
            <strong>Prompt:</strong> for sections with <code>use_normal_defaults</code>, anything not mentioned may be filled from the template&rsquo;s normal-defaults text and{' '}
            <code>used_defaults</code> must be true. Abnormal findings that were mentioned always override.
          </li>
          <li>
            <strong>Post-processor:</strong> if the section came back empty, it fills the defaults text itself and sets <code>used_defaults</code> (paragraph and bullets sections
            only). If the model mixed findings and defaults, the model&rsquo;s <code>used_defaults</code> flag is kept. Key-value sections are never auto-filled: all empty means
            not discussed.
          </li>
          <li>
            <strong>UI:</strong> a &ldquo;Normal defaults: confirm&rdquo; marker beside the section and in Check before filing. Copied text adds &ldquo;(defaults - confirm)&rdquo;.
          </li>
          <li>Evaluations credit defaults only when the model itself declared <code>used_defaults</code>.</li>
        </ul>

        <h3 id="e-fields">4. Empty fields</h3>
        <p>
          In key-value sections such as vitals, the schema requires every field key as a string. The prompt says to use an empty string when a value is not stated, never a guess.
          The post-processor trims values. The UI shows a muted &ldquo;not stated&rdquo;, copied text skips empty lines, and if every field is empty the section counts as not
          discussed.
        </p>

        <h3 id="e-units">5. Values and units</h3>
        <p>
          The prompt says to keep numbers and units exactly as spoken, with no conversion, and to raise a review flag for a missing unit or an implausible value. The schema
          cannot enforce this because structured output does not support patterns or ranges. The &ldquo;Vitals &amp; fields correct&rdquo; evaluation metric measures it, including a
          case that mixes pounds and kilograms.
        </p>

        <h3 id="e-doses">6. Drug doses</h3>
        <p>
          The prompt says to record drug, dose, route, frequency and duration only if stated, never to calculate a dose, and to raise a review flag for any missing or ambiguous
          element, for example &ldquo;Carprofen dose not stated - confirm mg/kg&rdquo;. An evaluation case with an ambiguous meloxicam dose measures it.
        </p>

        <h3 id="e-order">7. Section order</h3>
        <p>Schema keys are unordered, so the post-processor re-orders the sections to the template&rsquo;s order.</p>

        <h3 id="e-unknown">8. Extra or unknown keys</h3>
        <p>Impossible under the schema, and ignored by the post-processor anyway.</p>

        <h3 id="e-injection">9. Instructions hidden in the transcript</h3>
        <p>
          The transcript is delimited and declared untrusted, and any closing <code>&lt;/transcript&gt;</code> tag inside it is neutralised. The schema limits what an injection
          could produce to the note&rsquo;s own fields. An evaluation case contains an injected &ldquo;patient is healthy&rdquo; sentence.
        </p>

        <h3 id="e-stop">10. The model declines or runs out of room</h3>
        <p>
          <code>stop_reason</code> is checked before parsing, because structured output cannot guarantee the schema in those cases. <code>refusal</code> fails the note with
          MODEL_REFUSAL, and <code>max_tokens</code> fails it with OUTPUT_TRUNCATED. Both show Regenerate.
        </p>

        <h3 id="e-long">11. Over-long output</h3>
        <p>The post-processor applies size limits. Exceeding them gives INVALID_MODEL_OUTPUT.</p>

        <h3 id="e-tone">12. Tone and abbreviations</h3>
        <p>
          Set by the prompt from the template&rsquo;s style: clinical or client-friendly tone, and standard veterinary abbreviations only when the template allows them.
        </p>

        <h3 id="e-snapshot">13. The template is edited after a note was drafted</h3>
        <p>
          Each note stores a snapshot of its template, so existing notes do not change. Regenerate uses the snapshot unless you pick another template.
        </p>
      </section>

      <CodeRefs
        files={[
          ['backend/src/vetscribe/prompts/builder.py', 'System prompt rules 1 to 10 and the schema builder'],
          ['backend/src/vetscribe/domain/postprocess.py', 'Order, missing-data rules, flags, size limits'],
          ['backend/src/vetscribe/domain/rendering.py', 'Copied text and markers'],
          ['backend/src/vetscribe/llm/bedrock.py', 'stop_reason checks and tool mode'],
        ]}
        adrs={['ADR-0004 Structured output with JSON schema', 'ADR-0007 Template model']}
      />
    </div>
  );
}
