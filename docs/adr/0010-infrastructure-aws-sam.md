# 0010. Infrastructure as Code: AWS SAM

- **Title:** Infrastructure as Code: AWS SAM
- **Status:** Accepted
- **Date:** 2026-11-20

## Context

VetScribe's AWS footprint is small and serverless: an HTTP API, an API Lambda, a Worker Lambda, a DynamoDB table, a dead-letter queue, IAM roles, and later a static frontend bucket with CloudFront and a Cognito user pool. The infrastructure definition lives at `infra/template.yaml`, and the Makefile exposes `build` and `deploy` targets. The team wants a definition that is short, reviewable, and easy to run locally.

## Decision Drivers

* Native shorthand for Lambda, HTTP API, and DynamoDB, with little boilerplate.
* Simple build and deploy commands that contributors can run from the Makefile.
* Local invocation support for Lambda handlers.
* Low learning cost for a small team.
* Ability to express IAM least privilege for Bedrock model ARNs.

## Considered Options

### Option A: AWS CDK

* Good, because it offers the full power of a programming language and high-level constructs.
* Bad, because it adds a synthesis step, a construct library dependency, and more code to review for a small stack.

### Option B: Terraform

* Good, because it is multi-cloud and widely known.
* Bad, because it requires state management (a remote backend and locking) and a separate toolchain for Lambda packaging.

### Option C: Serverless Framework

* Good, because it is popular for Lambda projects.
* Bad, because its v4 licensing change introduces a commercial dependency for some organisations.

### Option D: AWS SAM (chosen)

A single CloudFormation-based template using SAM transforms for `AWS::Serverless::Function`, `AWS::Serverless::HttpApi`, and `AWS::Serverless::SimpleTable` or DynamoDB resources, with `sam build` and `sam deploy`.

* Good, because the shorthand matches our resource set exactly.
* Good, because `sam build` handles Python dependency packaging, and `sam local` is available for testing.
* Good, because CloudFormation state is managed by AWS, with no separate backend.
* Good, because it is native AWS tooling with no licence concerns.
* Bad, because templates are YAML and can become verbose for conditional logic.
* Bad, because SAM is less expressive than CDK for reusable constructs.

## Decision Outcome

Chosen option: **Option D, AWS SAM**, with `infra/template.yaml` as the single infrastructure definition and the Makefile as the entry point:

* `make build` runs `sam build` for the backend package.
* `make deploy` runs `sam deploy` with the environment-specific parameters.
* Parameters include the Bedrock model ID, the structured-output mode, and the DynamoDB table name, matching the configuration table in the spec.

IAM follows least privilege: `bedrock:InvokeModel` is granted only on the configured model and inference-profile ARNs, and DynamoDB access is limited to the single table.

## Consequences

### Positive

* A small, declarative template covers the whole backend.
* Build, deploy, and local invocation share one toolchain.
* No Terraform state bucket or CDK synthesis pipeline to maintain.

### Negative

* Complex conditionals (for example, per-environment alarm sets) will make the YAML harder to read.
* The template may need to be split into nested stacks if the frontend and Cognito resources grow substantially.

### Follow-ups

* Add the static frontend bucket, CloudFront distribution, and Cognito user pool with an HTTP API JWT authorizer as separate sections of the template when those features are implemented.
* Add CloudWatch alarms for DLQ depth and Worker errors.
* Pin the SAM CLI version in the development setup.

## Related

* [ADR-0002: Compute](0002-compute-lambda-lambdalith.md)
* [ADR-0003: LLM access via Bedrock](0003-llm-access-bedrock-invoke-model.md) (IAM scope)
* [ADR-0009: Frontend](0009-frontend-react-vite-plain-css.md) (static hosting)
