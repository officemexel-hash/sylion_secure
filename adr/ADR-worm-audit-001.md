# ADR-worm-audit-001 — Hardening audit hash chain do WORM-class assurance

| Pole | Wartość |
|---|---|
| **Status** | `DECISION PENDING` — options analysis, wymaga choice + HUMAN GATE |
| **Data** | 2026-05-21 |
| **Autor draftu** | Claude (audit agent) |
| **Wymagane podpisy** | CISO • Security • Compliance • Architect |
| **Scope** | Hardening `services/admin-api/src/modules/audit/auditService.js` z plain sha256 chain → tamper-evident WORM-class |
| **Powiązane** | F-19 finding • `sylion-ops-sre-incident-response` skill • ADR-vault-adapter-001 (HMAC key custody) • Step 3.16 (live mutations) |

---

## 1. Problem

`auditService.js` (51 LOC) implementuje hash chain:

```javascript
const hash = createHash("sha256")
  .update(stableJson(event))
  .digest("hex");
storedEvent = { ...event, hash };
this.lastHash = hash;  // includes previousHash in next event
```

Problemy:
- **Brak external anchor**: chain head nie jest publikowany ani anchored nigdzie
- **Brak signing**: plain sha256, brak HMAC z secret key
- **Append-only storage**: SQLite jest pełnoprawnym RW; brak write-protect
- **stableJson sortuje tylko top-level keys** (F-20)

Adwersarz z DB write access może:
1. Zmodyfikować event N (np. usunąć fakt że live Hetzner mutation się stała)
2. Recompute `hash_N = sha256(stableJson(modified_event_N))`
3. Walk forward recomputing `hash_{N+1}, hash_{N+2}, ...`
4. Otrzymuje valid-looking chain → audit appears intact

`sylion-ops-sre-incident-response` skill claim:
> *WORM/hash-chain audit for sensitive operations*

Obecna implementacja to **hash chain**, nie **WORM**.

**Krytyczność po Step 3.12-3.16:** real Hetzner mutations + rollback execution są auditowane. W obecnym stanie, evidence destrukcyjnych operacji może być fabricated. To **systemowe ryzyko production unlock** (F-29).

## 2. Wymagania funkcjonalne

| Req | Opis |
|---|---|
| W1 | Tamper-evidence: każda modyfikacja chain wykrywalna |
| W2 | Tamper-resistance (silniejsze): modyfikacja niemożliwa bez detekcji nawet z full DB access |
| W3 | Long-term verifiability: chain history weryfikowalny przez audytora bez SYLION cooperation |
| W4 | Bounded latency: audit emission nie blokuje request response > 50ms |
| W5 | DR-friendly: chain restorable po node loss |
| W6 | Multi-region consistency: distributed events ordered i merged correctly |
| W7 | Key custody integrated z ADR-vault-adapter-001 |
| W8 | Backward-compatible z istniejącą `auditService.js` API (record / list) |
| W9 | Standardów compliance audit (auditor może zweryfikować transparently) |

## 3. Rozważone opcje

### Option A — HMAC + HSM key custody

**How:** każdy event hashowany przez HMAC-SHA256 z key trzymanym **wyłącznie w HSM**. Recomputation poza HSM niemożliwa.

```javascript
const hmacKey = vault.getHmacKey("audit-chain-root");  // never leaves HSM
const hash = await vault.hmacSign("audit-chain-root", stableJson(event));
```

| Cecha | Wartość |
|---|---|
| Tamper-evidence | ✅ |
| Tamper-resistance | ✅ (klucz nie wycieka z HSM) |
| Long-term verifiability | ⚠️ wymaga HSM access lub key escrow dla audytora |
| Latency overhead | ~5-20ms per event (HSM round-trip) |
| Cost | HSM cost (patrz ADR-vault-adapter-001) |
| Operational | wymaga key ceremony, rotation procedure, escrow |
| Compliance fit | FIPS 140-2 L3+, dobre dla SOC 2 / ISO 27001 |

**Plus:** najczystszy DESign, dobrze pasuje do `sylion-crypto-pki-pqc` skill.

**Minus:** verifiability wymaga HSM access — auditor zewnętrzny musi zaufać że klucz jest w HSM (Common Criteria attestation pomocna). Single point of trust w HSM.

### Option B — Sigstore Rekor (transparency log)

**How:** każdy chain head (np. co 1000 events lub co 1 minutę) publikowany jako entry w Sigstore Rekor (lub własna instancja). Public append-only log z Merkle tree proof.

```javascript
// Periodically
const head = lastChainHash;
const rekorEntry = await rekorClient.upload({
  data: head,
  signature: signed(head),
  publicKey: signingPublicKey
});
// rekorEntry.logIndex jest immutable, publicly verifiable
```

| Cecha | Wartość |
|---|---|
| Tamper-evidence | ✅ (na poziomie head'ów) |
| Tamper-resistance | ✅ (Rekor jest append-only z Merkle proof) |
| Long-term verifiability | ✅✅✅ (publicly auditable, no SYLION cooperation needed) |
| Latency overhead | brak per event (batch) |
| Cost | free (public Rekor) lub self-hosted Rekor |
| Operational | wymaga signing key custody (ADR-vault-adapter-001) |
| Compliance fit | nowy ale silny precedens (Linux Foundation, SLSA) |

**Plus:** public verifiability — auditor zewnętrzny może zweryfikować bez SYLION trust. Najlepszy long-term proof.

**Minus:** **PHANTOM concerns** — publiczna publikacja chain head'ów ujawnia: timing operations, częstotliwość, presumed counts. Tego nie chcemy ujawniać dla operational privacy. **Mitigation:** publish only hash-of-period-aggregated-hash, nie raw events.

### Option C — OS-level append-only storage

**How:** SQLite file na filesystem z `chattr +a` (Linux), lub S3 Object Lock, lub WORM-mode storage. Plus pełen filesystem-level integrity check.

| Cecha | Wartość |
|---|---|
| Tamper-evidence | ⚠️ tylko jeśli OS-level integrity verified niezależnie |
| Tamper-resistance | ⚠️ root user może `chattr -a` (zależy od kernel + LSM config) |
| Long-term verifiability | ⚠️ wymaga zaufania do OS / cloud storage |
| Latency overhead | brak |
| Cost | niski (storage usually included) |
| Operational | wymaga distinct service account / cloud bucket policy |
| Compliance fit | dla niektórych regulacji wystarczy (np. AWS S3 Object Lock = SEC 17a-4 compliance) |

**Plus:** najprostsze; per-cloud może być WORM-cert (S3 Object Lock).

**Minus:** depends on cloud provider — Hetzner i OVH nie mają natywnego WORM Object Lock equivalent (jako 2026-05). Self-managed Linux WORM jest fragile.

### Option D — Hybrid (HMAC + Rekor anchor + append-only storage)

Wszystkie trzy warstwy razem.

| Layer | Function |
|---|---|
| 1. HMAC | Per-event signing, klucz w HSM (Option A) |
| 2. Append-only storage | Local storage filesystem WORM-mode + cloud backup (Option C) |
| 3. Rekor anchor | Periodic publication chain head digest (Option B) |

| Cecha | Wartość |
|---|---|
| Tamper-evidence | ✅✅✅ |
| Tamper-resistance | ✅✅✅ |
| Long-term verifiability | ✅✅✅ (auditor verifies via Rekor without SYLION) |
| Latency overhead | ~5-20ms per event (HMAC) + zero per-batch (Rekor async) |
| Cost | HSM ($$$) + Rekor (free) + storage (low) |
| Operational | najwyższy — trzy warstwy do operowania |
| Compliance fit | ✅ wszystko: FIPS L3, SLSA L3-4, SOC 2 |

**Plus:** highest assurance, defense in depth, każda warstwa pokrywa słabość innej.

**Minus:** operational complexity i koszt; **PHANTOM privacy mitigation** dla Rekor anchor (publish only digest, nie pattern).

### Option E — Blockchain anchor (np. Ethereum, Cardano)

Periodically publish chain head do public blockchain.

**Rejected** dla MVP:
- Latency długi (blocks ~10s+ Ethereum)
- Cost (gas fees, fluctuating)
- ESG concerns (Ethereum nadal PoS ale precedensy negatywne)
- PHANTOM privacy concerns identical do Rekor ale głębsze (publiczna trail per transaction)

Może być rozważone dla customer-specific STATE tier deployment, nie baseline.

## 4. Rekomendacja

**Phased:**

### Phase A (Stage 1 / MVP production)

**Option A — HMAC + HSM (via Vault from ADR-vault-adapter-001)**.

Niski overhead, closes F-19 core problem, integrates z vault decision już zrobioną.

```javascript
// Pseudo-code
const event = { id, action, ..., previousHash: lastHash };
const stableInput = canonicalJson(event);  // fixed canonicalization (F-20 fix)
const mac = await vaultClient.transitHmac('audit-chain-root', stableInput);
event.hmac = mac;
storedEvent = event;
lastHash = sha256(stableInput + mac);  // chain forward
```

Closes F-19 + F-20. Klucz w Vault transit engine (or HSM auto-unseal). Nie trafia poza vault.

### Phase B (Production unlock)

**Add Option B — Rekor anchor** dla chain heads (digest only, not raw events).

```javascript
// Every 1000 events or every 1 hour, whichever first
const periodDigest = await vaultClient.transitHmac('audit-anchor', lastChainHmac);
await rekorClient.upload({ data: periodDigest, signature: ... });
// Store rekorLogIndex w database (audit_anchors table)
```

Long-term verifiability bez SYLION cooperation. **PHANTOM mitigation:** publikujemy tylko digest, nie raw chain head; period digest derived in HSM żeby nie ujawniać direct chain hash.

### Phase C (STATE tier / customer-deployable)

**Add Option D full hybrid + customer-side anchor** (customer może chcieć anchorować do własnej infrastruktury, nie public Rekor).

Per tenant choice runbook.

## 5. Stable canonicalization fix (closes F-20)

```javascript
// services/admin-api/src/lib/canonicalJson.js (new file)
export function canonicalJson(value) {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const sortedKeys = Object.keys(value).sort();
  const pairs = sortedKeys.map(k => JSON.stringify(k) + ':' + canonicalJson(value[k]));
  return '{' + pairs.join(',') + '}';
}
```

Recursive sort, handles nested objects/arrays. Test cases: empty, primitives, arrays, nested objects, mixed keys, unicode.

## 6. Decision matrix

| Option | Tamper-evidence | Tamper-resistance | Long-term verify | Latency | Cost | Op complexity | Compliance | PHANTOM privacy |
|---|---|---|---|---|---|---|---|---|
| Current (sha256 chain) | ⚠️ | ❌ | ❌ | low | low | low | gap | ✅ |
| A: HMAC + HSM | ✅ | ✅ | ⚠️ (need HSM access) | medium | $$ | medium | FIPS L3 | ✅ |
| B: Rekor anchor | ✅ | ✅ | ✅✅ | low | low/free | medium | SLSA L3 | ⚠️ (mitigated) |
| C: OS append-only | ⚠️ | ⚠️ | ⚠️ | none | low | low | basic | ✅ |
| D: Hybrid (A+B+C) | ✅✅ | ✅✅ | ✅✅ | medium | $$$ | high | FIPS L3 + SLSA | ⚠️ (mitigated) |
| E: Blockchain | ✅ | ✅ | ✅✅✅ | high | $$ | high | none std | ❌ |

## 7. Konsekwencje

### 7.1 Pozytywne (Phase A + B)

- Closes F-19, F-20, F-29 (systemic risk audit+secret+exec)
- Integrates with ADR-vault-adapter-001 — vault holds HMAC key
- Long-term verifiability dla audytora (Phase B)
- Foundation dla SLSA / SOC 2 / ISO 27001 audit clauses
- Catches Step 3.16 destructive rollback risk (F-29)

### 7.2 Negatywne

- Vault dependency — Phase A waits on ADR-vault-adapter-001 implementacja
- Latency: +5-20ms per event (HSM round-trip). Mitigation: async signing for non-critical paths
- Rekor anchor cost mostly free, ale self-hosted Rekor wymaga ops
- Operational complexity: key rotation procedure dla HMAC root

### 7.3 PHANTOM privacy mitigation (dla Phase B Rekor)

| Concern | Mitigation |
|---|---|
| Timing pattern reveal | Periodic anchor regularny (np. co godzina exactly), nie event-driven |
| Operation count reveal | Anchor = digest period, nie count |
| Operator correlation | Per-tenant anchor key (różny dla każdego tenant) |
| Operation type leak | Anchor digest covers events of all types together |

## 8. Implementation plan

| Phase | Tydzień | Deliverable |
|---|---|---|
| A.W1 | Security | Define HMAC key policy (rotation, escrow, key custody) |
| A.W1 | Codex | Implement `canonicalJson` (closes F-20) + tests |
| A.W2 | Codex | Implement HmacAuditService extending current AuditService, env flag `SYLION_AUDIT_MODE=hmac` |
| A.W2 | Platform | Wire to Vault transit engine (assumes ADR-vault-adapter-001 Phase A done) |
| A.W3 | QA | Test parity z current AuditService + new tests for tamper detection |
| A.W4 | Security | Migration plan: rehash existing events with HMAC + sign chain head |
| B.M2 | Security + Platform | Rekor client implementation |
| B.M2 | QA | Test anchor publication + verification |
| B.M3 | CISO | Audit chain external verifiability demo dla auditora |

## 9. HUMAN GATE / Open items

1. **Phase A choice confirmation** — HMAC + HSM (recommended)?
2. **HMAC key rotation period** — proponowane 90 dni z overlap window
3. **Rekor: public vs self-hosted** — public Rekor (Sigstore) jest free i mature; self-hosted daje pełną kontrolę ale ops cost
4. **Anchor period** — co godzina? co 1000 events? configurable per tenant?
5. **Existing events** — rehash on migration (jednorazowo) vs wprowadzić "audit chain v2" markę
6. **Audit chain DR** — backups w jakiej formie (encrypted snapshot do osobnego cloud?)

## 10. Sign-off

| Rola | Nazwisko | Data | Decyzja | Komentarz |
|---|---|---|---|---|
| CISO | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Security | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Compliance | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Architect | _________ | ____ | ☐ approve ☐ reject ☐ changes | |

---

## Appendix A — Źródła

- `services/admin-api/src/modules/audit/auditService.js` (51 LOC, current implementation)
- F-19, F-20, F-29 findings (session audit history)
- [`adr/ADR-vault-adapter-001.md`](./ADR-vault-adapter-001.md)
- `.claude/skills/sylion-ops-sre-incident-response/SKILL.md` (WORM claim)
- `.claude/skills/sylion-crypto-pki-pqc/SKILL.md` (HSM-backed key custody)
- Sigstore Rekor docs (https://docs.sigstore.dev/logging/overview)
- SLSA framework (https://slsa.dev/)
- NIST SP 800-92 (Log Management)
- AWS S3 Object Lock (https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)
