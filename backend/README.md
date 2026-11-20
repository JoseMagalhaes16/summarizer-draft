# VetScribe backend

Python 3.13 package `vetscribe` (Lambda handlers + local dev server). Contract: `docs/design/spec.md`.

## Setup

```bash
cd backend
python3.13 -m venv .venv
.venv/bin/pip install -e '.[dev]'
```

## Run locally (no AWS needed)

```bash
.venv/bin/python -m vetscribe.local.server --host 127.0.0.1 --port 8000
```

Defaults: `LLM_PROVIDER=mock`, `STORAGE_BACKEND=memory`, `JOB_DISPATCHER=inline`,
`LOCAL_DATA_FILE=backend/.local-data.json` (data survives restarts; delete the file to reset).
The server converts each HTTP request into an API Gateway HTTP API v2.0 event and calls
`vetscribe.handlers.api.lambda_handler`. Set `MOCK_LATENCY_SECONDS=0` for instant notes.

## Quality gates

```bash
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/mypy src
.venv/bin/pytest --cov=vetscribe          # coverage >= 85%
.venv/bin/cfn-lint ../infra/template.yaml
```

Tests are fully offline (moto for DynamoDB, botocore Stubber for Bedrock).

## Environment variables

See spec section 3. `APP_ENV`, `LLM_PROVIDER` (`mock|bedrock`), `STORAGE_BACKEND`
(`memory|dynamodb`), `LOCAL_DATA_FILE`, `TABLE_NAME`, `JOB_DISPATCHER` (`inline|lambda`),
`WORKER_FUNCTION_NAME`, `AWS_REGION`, `BEDROCK_MODEL_ID`, `BEDROCK_STRUCTURED_MODE`
(`output_config|tool`), `BEDROCK_EFFORT`, `BEDROCK_MAX_TOKENS`, `BEDROCK_READ_TIMEOUT_S`,
`MOCK_LATENCY_SECONDS`, `MAX_TRANSCRIPT_CHARS`, `DEFAULT_CLINIC_ID`, `CORS_ALLOW_ORIGIN`,
`LOG_LEVEL`. Powertools: `POWERTOOLS_METRICS_NAMESPACE` (default `VetScribe`),
`POWERTOOLS_METRICS_DISABLED=true` (set by the local server).

Logs contain only ids, lengths, timings and token counts - never transcript or note content.

## Real Bedrock smoke test

```bash
.venv/bin/python ../scripts/smoke_bedrock.py --template-id builtin-soap \
  --transcript-file tests/fixtures/transcripts/canine_otitis.txt \
  --model-id us.anthropic.claude-opus-5-5 --region us-east-1 --mode output_config
```

Needs AWS credentials and model access enabled in the Bedrock console. The default model ID is
a placeholder in `src/vetscribe/config.py`; confirm it for your account/region.

## Deploy (AWS SAM)

```bash
cd infra
sam build            # builds ../backend/src with the pinned src/requirements.txt (arm64)
sam deploy --guided  # or: sam deploy (uses samconfig.toml)
```

Parameters: `Stage`, `BedrockModelId`, `BedrockFoundationModelId`, `BedrockStructuredMode`,
`CorsAllowOrigin`. The worker IAM role is limited to `bedrock:InvokeModel*` on the configured
inference profile and the underlying foundation model (any region, for cross-region profiles).
`global.` profiles additionally need the `aws:RequestedRegion=unspecified` statement described in
the template comments. Output `ApiUrl` is the frontend's `VITE_API_BASE_URL`.
