# How this was built

VetScribe was produced with a coordinated multi-agent workflow. A higher-capability
model acted as architect and coordinator. Lower-cost models implemented the work
against written contracts. Independent reviewers verified the result.

```mermaid
flowchart TB
    C["Coordinator / architect<br/>(Opus-tier)"]
    C -->|writes| SPEC["docs/design/spec.md<br/>(implementation contract)"]
    C -->|writes| ARCH["docs/architecture/overview.md"]

    subgraph P1["Phase 1: parallel"]
        R["Research agent (Sonnet)<br/>competitors + Bedrock facts"]
        BE["Backend agent (Sonnet)<br/>Python/Lambda/SAM"]
        FE["Frontend agent (Sonnet)<br/>React"]
        ADR["ADR writer (Haiku)"]
    end
    SPEC --> BE & FE & ADR
    R -->|"corrected model ID / IAM"| C
    C -->|"spec update"| BE

    subgraph P2["Phase 2: verification"]
        REV["Independent reviewer (Opus)<br/>backend + infra, ran the API"]
        UX["UI/UX review by coordinator<br/>ui-ux-pro-max + frontend-design skills,<br/>Playwright screenshots of the real stack"]
    end
    BE --> REV
    FE --> UX

    subgraph P3["Phase 3: fixes, parallel"]
        BE2["Backend agent (Sonnet)<br/>fencing token, recovery, size limits, mock quality"]
        FE2["Frontend agent (Sonnet)<br/>record-sheet redesign"]
    end
    REV -->|"findings + decided fixes"| C --> BE2
    UX -->|"docs/design/ui-design.md"| FE2
    BE2 & FE2 --> V["Coordinator: gates re-run, end-to-end<br/>Playwright run of the mocked stack"]
```

Ground rules the agents worked under:

* **Contracts first.** Agents built against `spec.md`, which let backend and
  frontend proceed in parallel without drifting.
* **Coordinator decides.** Reviewers report findings. The coordinator chooses the
  fix (recorded in ADRs) and hands precise instructions to implementers.
* **Verify, don't trust.** Every agent's "all green" was re-run by the
  coordinator (ruff, mypy, pytest, cfn-lint, ESLint, tsc, Vitest, build) before
  commit, and the UI was checked with screenshots of the real stack.
* **No personal memory.** No account memory or personal notes were used. Facts
  came from the repo, public documentation and web research, with sources cited
  in `docs/research/`.
