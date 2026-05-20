# SYLION Admin Panel V2 - Step 3.10 Prompt Pack

## Global Guardrails

```text
Use SYLION skills.
Preserve Księga 3.4 baseline.
Keep PHANTOM separate and non-executable.
Do not add real provider mutation.
Do not start real Firecracker workloads.
Do not store secrets or communication content in test artifacts.
Document every found UI/API problem.
```

## Prompt S3.10-A

Implement a repeatable dashboard Playwright runner.

Output:

```text
script or test file
JSON result artifact
desktop/mobile screenshots
failure summary
```

## Prompt S3.10-B

Expand SDK and contract tests for Step 3.9 endpoints.

Output:

```text
tests for readiness history
tests for system status
tests for provider dry-run
tests for PHANTOM ack and coverage
tests that orchestrator requires approved approvalId
```

## Prompt S3.10-C

Add negative dashboard tests.

Output:

```text
dashboard blocks missing approval
dashboard handles empty lifecycle allocation cleanly
dashboard rejects PHANTOM execution request
dashboard shows expired exception blocker
```

## Prompt S3.10-D

Add visual regression evidence.

Output:

```text
screenshots for critical views
mobile overflow checks
notes for any clipping or spacing issue
```

## Prompt S3.10-E

Generate release gate matrix.

Output:

```text
Księga 3.4 table
PHANTOM table
test summary
problems found
human gates
next sprint recommendation
```

