# Step 3.86 Implementation Freeze - Human Evidence Contract

Date: 2026-05-23

Status: Prompt A/T86-01, Prompt A/T86-02 and Prompt A/T86-03 implemented.

## Implemented

1. Shared human evidence contract:
   - `scripts/lib/human-evidence.mjs`
   - strict result states: `PASS`, `SIMULATION_PASS`, `LAB_PASS`, `FAIL`, `FAIL_CRITICAL`, `BLOCKED`, `UNKNOWN`, `FLAKY`
   - metadata-only validator
   - forbidden evidence key/value detector
   - production-readiness helper: only `PASS` can satisfy production readiness

2. Contract tests:
   - `services/admin-api/test/step3-86-human-evidence-schema.test.js`
   - validates PASS requirements
   - rejects operational content keys and secret-like values
   - rejects PASS with blockers or without evidence references
   - preserves `FAIL_CRITICAL` priority over softer states

3. Pixel ADB lab harness integration:
   - `scripts/pixel-adb-operator-lab.mjs`
   - writes compatible `summary.json`
   - additionally writes strict `human-evidence.json`
   - labels local Pixel lab evidence as `LAB_PASS`, never production PASS

4. Pixel live human regression integration:
   - `scripts/pixel-live-human-regression.mjs`
   - writes compatible `summary.json`
   - additionally writes strict `human-evidence.json`
   - maps live findings to strict semantics:
     - issues -> `FAIL`
     - known physical/product gates -> `BLOCKED`
     - clean full evidence -> `PASS`

5. Release inventory integration:
   - `POST /release/human-evidence-runs`
   - SDK helper: `recordHumanEvidenceRun`
   - strict evidence summary is indexed as:
     - release human test run,
     - `human_evidence_summary` artifact,
     - release problem when strict result maps to failed or blocked,
     - build-assessment latest run metadata.
   - admin Release view now shows strict result, blockers and next required action for strict evidence runs.

## No-Shortcut Rules Now Enforced In Code

- A passing test must have evidence references.
- `PASS` cannot contain blockers.
- `SIMULATION_PASS` and `LAB_PASS` cannot unlock production readiness.
- Forbidden evidence keys include secrets, tokens, API keys, OTP/SMS, phone numbers, wallet seeds, message content, packet captures, file contents and raw cookies.
- Secret-like values are rejected even if they are nested.
- Required guardrail fields must state:
  - `metadataOnly: true`
  - `terminalDataStored: false`
  - `contentInspected: false`
  - `packetCaptureStored: false`

## Evidence Flow

```mermaid
flowchart TD
  A["Prompt A/T86-01: shared evidence schema"] --> B["Validator: metadata-only and no forbidden fields"]
  B --> C["Contract tests"]
  B --> D["Pixel ADB lab harness"]
  B --> E["Pixel live human regression"]
  B --> L["Release API: strict evidence indexing"]
  D --> F["summary.json compatibility"]
  D --> G["human-evidence.json strict bundle"]
  E --> H["summary.json compatibility"]
  E --> I["human-evidence.json strict bundle"]
  L --> M["Human test run inventory"]
  L --> N["Evidence artifact index"]
  L --> O["Problem registry for failed/blocked strict results"]
  G --> J["Repair loop: smallest fix then retest exact blocker"]
  I --> J
  M --> J
  N --> J
  O --> J
  J --> K["Next prompt: evidence upload from harnesses into API"]
```

## Verification

Executed without live infrastructure mutation:

```text
node --check scripts/lib/human-evidence.mjs
node --check scripts/pixel-adb-operator-lab.mjs
node --check scripts/pixel-live-human-regression.mjs
node --check services/admin-api/src/lib/humanEvidence.js
node --check services/admin-api/src/modules/release/releaseControlService.js
node --check services/admin-api/src/app.js
node --test services/admin-api/test/step3-86-human-evidence-schema.test.js
node --test services/admin-api/test/step3-86-human-evidence-release-index.test.js
node --test services/admin-api/test/step3-21-human-test-inventory.test.js services/admin-api/test/step3-11-release-control.test.js
node --test services/admin-api/test/admin-web-static.test.js
```

Result: all checks passed.

## Next Prompt

Prompt A/T86-04:

Make the Pixel ADB lab and live human regression harnesses optionally POST their generated `human-evidence.json` to `/release/human-evidence-runs` after writing the local artifact, so every Pixel/laptop/live repair run is visible in the admin panel automatically with:

- test id,
- strict result,
- evidence refs,
- blockers,
- repair commit,
- retest status,
- Ksiegi 3.4 alignment,
- PHANTOM boundary impact.

No live production claim can advance until the evidence index shows a reproducible `PASS` for the exact required path.
