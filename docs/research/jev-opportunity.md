# Research: Jev (TypeSafe System One) and its potential for `crcatala/strong-cli`

**Repository:** crcatala/strong-cli — *Unofficial CLI for the Strong App (workout tracker / gym log)*
**Research date:** 2026-09-18
**Evidence basis:** Parent-verified source dossier (`/tmp/jev-research.1FrXpC/jev-source-dossier.md`), fetched directly from the TypeSafe/evals/Archer Hume sources; plus direct inspection of the local checkout (`README.md`, `package.json`, `CHANGELOG.md`, `docs/api-inventory.md`, `docs/data-model.md`, `docs/auth-findings.md`, `src/cli.ts`, `src/transform/workouts.ts`, `src/write/write-service.ts`).
**Caveat:** This session had no independent web/fetch tooling; all external facts come from the parent-fetched dossier. Vendor claims, independent observations, and researcher recommendations are labeled distinctly throughout.

---

## 1. Executive summary

`strong-cli` is a TypeScript/Node CLI that reverse-engineers the undocumented Strong workout backend. It is **read-only by default**, with opt-in, `--write`-gated mutation commands, and is explicitly "built for personal-productivity/AI-agent use." Today the project **contains no language model at all** — every decision (pagination, unit conversion, tag filtering, cache sync, write verification) is deterministic code.

**Jev** is TypeSafe's first public "System One Model": a text-in, **typed-decisions-out** API — not a chatbot. You submit a `state` (text) plus a map of typed questions and it returns probabilities/distributions over *your* defined answers (yes/no, choose-an-option, or rubric score). It does **not** generate text, code, or explanations, and it is **not** an autonomous agent — code owns all control flow and side effects. It is positioned as fast (vendor: ~70–500 ms), cheap (vendor: $0.042/M input tokens, free output), and calibrated via "RLCD."

**Bottom line:** Jev is a **poor fit as a replacement for anything in this repo** (the repo has no generative model to replace) but a **genuinely additive fit** for two narrow, high-leverage classes of work: (a) **confidence-gated classification that gates existing risky behavior** (the `--write` mutation path, which is the project's single biggest liability), and (b) **derived structured metadata** for the export/agent pipeline (movement-pattern / muscle-group labeling, tag suggestions). The dominant counterweight is **privacy/ToS**: this project deliberately keeps user data and secrets local and warns that writes live in an "account-termination / ToS gray zone." Any design that ships raw workout data to a third-party API must be opt-in, de-identified, and clearly documented. Net: **high potential for a small number of surgical, opt-in integrations; low potential for broad or default-on use.**

---

## 2. Technical explanation of Jev and its capabilities

### 2.1 What it is (direct evidence — TypeSafe docs, via dossier)
- **Interface shape:** `POST https://api.typesafe.ai/v1/systemone`, bearer API key, model alias `jev-latest`. One `state` (string, JSON object, or array of text values) is evaluated against **a map of typed questions**, returned as structured decisions/probabilities. *(Source: `https://docs.typesafe.ai/api`)*
- **Three question primitives:**
  - **Noul** — a yes/no question → probability of "yes" (0–1).
  - **Choice** — pick among caller-defined options → selected option + full probability distribution.
  - **Score** — rate against an ordered caller-defined rubric → probability-weighted score, legend, distribution, and derived `confidence`. *(Source: `https://docs.typesafe.ai/concepts/system-one`)*
- **Parallel, narrow judgments:** questions can be evaluated independently and in parallel over the same state in one request. Docs recommend keeping control flow/side effects in code, asking narrow atomic questions, and using probabilities/thresholds to act/review/escalate. *(Source: `https://docs.typesafe.ai/concepts/how-to-build-with-system-one`)*
- **No generation, no agency:** System One "does not generate replies, code, or explanations of reasoning" and is not an autonomous agent. *(Source: `https://docs.typesafe.ai/concepts/system-one`)*
- **Text-only:** images, audio, and video are currently documented as unsupported. *(Source: `https://docs.typesafe.ai/concepts/system-one`)*
- **Calibration:** "RLCD" (Reinforcement Learning for Calibrated Decisions) optimizes decisions/probabilities so higher probabilities correspond to higher empirical accuracy **across groups** — explicitly **not a per-prediction guarantee**; `confidence` is derived from the distribution, not an independent learned guarantee. *(Sources: `https://docs.typesafe.ai/confidence`, `https://docs.typesafe.ai/introduction/machine-learning-primer`)*
- **Error/retry model:** documented 401, 422, 429, 529; exponential backoff advised for 429/529. *(Source: `https://docs.typesafe.ai/api`)*

### 2.2 Vendor performance and pricing claims (vendor-reported — not independent)
- Launch post claims **~70–500 ms** end-to-end for TypeSafe-shaped workflows; **$0.042 per million input tokens ($42/billion)** with **free output tokens**; **~40×–200× speedups** for comparable System One queries; homepage comparisons of **193.6× faster / 444.6× cheaper**. *(Source: `https://typesafe.ai/blog/introducing-system-one-models-and-jev`)*
- Vendor states Jev was **in early access at launch**, evaluations compare models on the same code-defined workflow using expensive external-model predictions as reference probabilities, and discloses bias (workflows authored by the model-capabilities team; OpenAI/Anthropic references; laptop/service-region conditions affect measurements). *(Same source.)*
- Vendor claims type-safe outputs "cannot produce type errors under the defined output contract" — but this is **not** semantic correctness or calibrated accuracy; a valid typed decision can still be wrong. *(Same source.)*

### 2.3 Independent analysis (independent evidence, single early-access version)
- Archer Hume's post argues Jev's core proposition is **direct decision probabilities over shared state and allowed answers**, rather than generated confidence text. It reconstructs a *plausible* architecture (shared-state encoding, question branches, direct probability readouts, possibly listwise option processing) — **repeatedly labeled speculative/black-box inference**, not confirmed implementation. *(Source: `https://archerhume.com/posts/jevs-architecture-unmasked`)*
- Black-box observations (single early-access model/version/region, public evidence bundles): behavior consistent with **question isolation, option-order sensitivity, listwise option interactions, and fast server-reported timings** — while warning these do **not** uniquely identify the implementation and are not isolated hardware benchmarks. A calibration analysis on selected benchmark/fresh-math samples exists but **does not prove domain calibration** for any production use. *(Sources: same post; `https://archerhume.com/research/jev/evidence.json`)*

### 2.4 Where Jev fits vs. does not (dossier synthesis)
- **Fits:** narrow semantic classification, detection, routing, scoring, ranking/retrieval, verification, feature extraction where the answer space is definable in advance and code acts on the result.
- **Does not fit:** open-ended generation, code generation, explanations, unconstrained agent loops, multimodal inputs.
- **Safe integration pattern:** deterministic prechecks first; send minimal relevant structured state; independent atomic questions; reviewable thresholds; log probabilities/outcomes; route low-confidence/high-risk cases to a human or stronger model; never let a valid schema output bypass authorization, policy, or side-effect checks.

---

## 3. Repo-specific opportunities

Current repo reality (direct inspection): commands are `auth`, `workouts`, `workout`, `exercises`, `templates`, `folders`, `tags`, `measurements`, `stats`, `export`; read-only by default, mutations behind `--write`; auth via rotating JWT; local incremental cache (`~/.config/strong-cli/cache.json`, 0600); a normalized domain model (`Workout → Exercise → Set`) in `src/transform/workouts.ts`; a serialized write engine (refresh → build → PUT → optimistic merge → persist) with an inferred-shape verify loop for `workout edit`; and a strong privacy stance (`STRONG_HTTP_STATS` never emits URLs/headers/tokens/bodies). **There is no model dependency of any kind.** So Jev cannot "replace an existing model" — it can only *add* capability.

### 3.1 New customer-facing features
- **Auto-tagging / movement-pattern labeling.** Classify each exercise/workout into push/pull/legs, compound/isolation, muscle group, or the user's own tag vocabulary using `Choice`/`Noul`. Could power a new read command or enrich `--tag` workflows (e.g., suggest tags for an unlabeled workout).
- **Confidence-gated write assistance.** When logging/editing sets, run `Score`/`Noul` plausibility checks ("is this weight/reps combination plausible for this exercise?") and warn or require confirmation before a `--write` PUT.
- **Structured query routing (not generation).** Map a natural-language request ("top push volume last month") to a *fixed* filter schema (which command, which `--since`/`--tag`/`--unit`) via `Choice`; deterministic code then executes the real query against the local cache. This keeps Jev off the data path as a *generator* and uses it purely as a classifier. **Researcher inference:** this is the most agent-friendly, lowest-risk customer-facing idea.
- **Not recommended:** "generate a human-readable weekly summary/coaching blurb." Jev does not generate text — that would need a generative model, a different tool than Jev.

### 3.2 Backend / automation capabilities
- **Enrichment stage in the sync/export pipeline.** Add derived, deterministic-after-classification fields to exported JSON (movement pattern, primary muscle, estimated training focus) so downstream AI agents receive labeled structure instead of raw logs. `export` already emits an "enriched JSON" document — this extends it.
- **Data-quality / anomaly advisories.** `Score` plausibility of logged sets (implausible jump in load, reps/weight mismatch, likely mistyped unit) and surface advisory flags during sync.
- **Template/workout routing.** Given a template name + exercises, `Choice` the best target folder; multi-label tag suggestion via independent `Noul`s. This complements (not replaces) the existing deterministic folder/tag bookkeeping in `src/write/folders.ts`.
- **API-shape drift classification.** After each fetch, `Noul`/`Choice` whether new fixtures deviate from captured shapes (`captures/`) — an early-warning signal for the reverse-engineered API.

### 3.3 Developer tooling
- **Semantic consistency lint in CI.** The repo maintains README + `CHANGELOG.md` + `docs/*.md` + `src/commands/*` by hand; a `Score`/`Noul` check can flag doc/command drift (e.g., a documented command missing from source) as a non-blocking CI gate.
- **Change-risk classification.** For a given diff, `Choice` whether it touches the `--write` path / live-test gating / auth, and route review accordingly.
- **Secret/PII leak scanning of docs & fixtures.** `Noul` whether a doc/test fixture contains plausible credentials, tokens, or real personal data before release. (Low incremental value — the repo is already disciplined here.)
- **Test-tier selection.** `Choice` which test tier a change needs (`unit` / `live` / `live-write`) — maps neatly onto the existing `RUN_LIVE_TESTS` / `RUN_LIVE_WRITE_TESTS` gates.

### 3.4 Admin / operations use cases
- **Issue & PR triage.** Classify inbound GitHub issues/PRs (bug / feature / docs / "write-command concern") and route them.
- **Release-note categorization.** `Choice`/`Score` mapping changelog entries into Added/Changed/Fixed buckets (the repo follows Keep-a-Changelog).
- **Support-reply routing** without transmitting sensitive bodies: classify error/problem+json *categories*, never raw payloads.

### 3.5 Safety, privacy, and cost/perf implications for this repo
- **Privacy tension (high).** The project intentionally keeps user data and secrets local and never logs bodies/tokens. Sending workout history, exercise names, or measurement values (weight, body-fat %, caloric intake — potentially health-sensitive) to a third-party API materially changes the project's data-flow posture. **Any Jev integration handling user data must be opt-in, de-identified/minimized, and documented.** The dossier does **not** verify TypeSafe's data-retention or privacy policy — treat as an open question.
- **ToS tension (high).** Writes already live in an "account-termination / ToS gray zone" against an undocumented API. Coupling AI-classified decisions to those writes adds a second uncertain dependency; keep Jev advisory, never authoritative over side effects.
- **Latency/cost (medium).** The CLI targets ~70–85 ms startup, and data commands are network-bound to Strong. A synchronous Jev call (vendor: 70–500 ms) would *dominate* interactive latency; integration should be async, batched, cached, or confined to non-interactive/CI flows. On cost, the vendor's $0.042/M-input, free-output pricing is attractive for text-light classification; the "193.6× cheaper" figures are vendor, workload-specific, and unverified independently.
- **Access model (medium).** Jev was **early access** at launch; GA availability, SLAs, rate limits, and data policies are unresolved (see Open Questions). Any roadmap item depends on confirmed access.

---

## 4. Recommendations by predicted impact

Impact labels are **researcher predictions grounded in repo inspection + the dossier**, not verified outcomes. Complexity/disruption are relative to the current codebase.

### 4.1 Huge predicted impact

#### H1 — Confidence-gated safety guard on the `--write` path
- **What:** Add an optional, opt-in Jev check (`Noul`/`Score`) into the existing write engine (`src/write/write-service.ts`) and/or live-write test gate: before a `--write` PUT, classify the operation as plausible/safe (plausible set values, non-destructive intent, no accidental cross-account action). Low-confidence/negative results block or require confirmation; deterministic code still owns the actual PUT.
- **Expected value:** Directly attacks the project's #1 risk (corrupting or losing data / account termination on an undocumented API). High for a tool whose whole value proposition is *safe* access to a hostile API.
- **Implementation complexity:** Medium. The engine already has a serialized write + verify/reconcile loop (`serverConfirmed`), so there is a natural insertion point and precedent for a second verification stage.
- **Architectural disruption:** Low–medium. Adds an *optional* classifier stage; no change to cache/auth/data model. Must stay off the default path for zero-data users.
- **Dependencies:** Jev API access + key management (new secret type — must not be logged, consistent with the repo's no-body-logging stance); a local, reviewable threshold/config layer.
- **Risks:** False negatives could block legitimate writes (annoyance); false positives give false confidence (worse). Sending workout content to third party; calibration is not guaranteed per-prediction (dossier). Must never let a "safe" verdict bypass the existing ToS/`--write` acknowledgment.
- **Plausible next experiment:** Prototype a *dry-run* mode that scores N recent writes on a disposable account, compares Jev verdicts against actual `serverConfirmed` outcomes, and reports precision/recall — **no writes gated until thresholds are validated on held-out data.**

#### H2 — Derived semantic metadata enrichment for the agent/export pipeline
- **What:** Extend `export` (and optionally `stats`) with Jev-derived, code-executed labels: movement pattern (push/pull/legs), compound/isolation, primary muscle, and tag suggestions — computed from exercise names + set structure. Emitted as new structured fields in the enriched export document.
- **Expected value:** Opens a genuinely new capability class for the repo's stated audience ("AI-agent use"): agents get *labeled structure* rather than raw logs, enabling downstream analytics/planning without any generative model. Purely additive.
- **Implementation complexity:** Medium. Needs a taxonomy + prompt/question design, a mapping layer, and caching (labels are stable per exercise → cache aggressively to control cost/latency).
- **Architectural disruption:** Low. Sits as a post-transform enrichment step beside `src/transform/workouts.ts`; the cache and data model are untouched.
- **Dependencies:** Jev access; a maintained label taxonomy; local exercise cache to bound API calls.
- **Risks:** Taxonomy drift/quality; user-data egress (must be opt-in & documented); must degrade gracefully to no-labels when Jev is unavailable or `--no-enrich` is set.
- **Plausible next experiment:** Classify the public 253-exercise library (already cached, non-personal) into the taxonomy and publish the label map as a fixture; measure coverage/agreement — zero personal data leaves the machine for the first experiment.

### 4.2 Medium predicted impact

#### M1 — Semantic consistency lint in CI (developer tooling)
- **Value:** Catches README/CHANGELOG/`docs` vs `src/commands` drift automatically; the repo invests heavily in docs, so the payoff is real but bounded. **Complexity:** Low (a CLI/CI step over repo text). **Disruption:** None. **Dependencies:** Jev access in CI. **Risks:** Flaky/non-deterministic gates — make it advisory, not blocking. **Next experiment:** Run it read-only over the current tree and measure how many real drifts it finds vs. a deterministic grep baseline.

#### M2 — Change-risk & issue/PR triage classification (admin/ops)
- **Value:** Reduces maintainer load and routes risky `--write`/auth diffs to scrutiny. **Complexity:** Low–medium (needs issue/diff text plumbing). **Disruption:** None (separate workflow). **Dependencies:** Jev access; GitHub metadata. **Risks:** Mis-routing; keep humans in the loop. **Next experiment:** Backtest against the last N merged PRs/issues and measure agreement with actual labels.

#### M3 — Structured natural-language → query routing (customer-facing)
- **Value:** Lets agents/users express intent ("top push volume last month") that Jev maps to a *fixed* filter schema executed by deterministic code; fits the repo's agent focus without generation. **Complexity:** Medium (schema design + disambiguation). **Disruption:** Low (front-end parser only). **Dependencies:** Jev access; a strict allowed-value schema. **Risks:** Ambiguity; must never let routing produce an unbounded/unsafe query; **must not** transmit results back as free text. **Next experiment:** Constrain to 3 commands × fixed flags and measure routing accuracy on a held-out set of phrasings.

### 4.3 Low predicted impact

#### L1 — Workout/set anomaly advisories
- **Value:** Nice-to-have data-quality flags. **Complexity:** Low. **Disruption:** None. **Risks:** Overlap with H1's plausibility check; can be folded into it. **Next experiment:** Score a sample of the user's own cache and eyeball precision.

#### L2 — Secret/PII scanning of docs & fixtures
- **Value:** Low — the repo is already disciplined (documented privacy-safe stats, synthetic fixtures). **Complexity:** Low. **Disruption:** None. **Risks:** Compression of marginal safety gains vs. a simple regex/entropy scanner. **Next experiment:** Compare Jev vs. an entropy-based scanner on the `captures/` fixtures.

#### L3 — Changelog/release-note categorization
- **Value:** Cosmetic maintainer convenience. **Complexity:** Low. **Disruption:** None. **Risks:** Low accuracy need; deterministic rules may suffice. **Next experiment:** Classify the existing `CHANGELOG.md` entries and compare with their actual sections.

---

## 5. Prioritized roadmap, open questions, limitations

### 5.1 Roadmap (proposed order)
1. **Confirm access & policy (blocking gate).** Verify Jev GA status, rate limits, pricing, and — critically — TypeSafe's data-retention/privacy policy before any user-data egress.
2. **Zero-egress first experiment.** Classify the *public* exercise library into a taxonomy (H2) — non-personal, validates quality/cost/latency with no privacy exposure.
3. **H1 dry-run guard.** Score recent writes on a disposable account vs. `serverConfirmed`; validate thresholds on held-out data before gating anything.
4. **M1 semantic lint** as an advisory CI step (fast, low-risk, builds internal familiarity).
5. **M2 triage** for issues/PRs; then **M3 query routing** behind an explicit opt-in flag.
6. Fold **L1** into **H1** if pursued.

### 5.2 Open questions
- Is Jev **generally available** now, and under what SLA/rate limits? (Dossier: "early access at launch.")
- What are TypeSafe's **data-retention and privacy terms** for submitted `state`? *(Not verified in the dossier — decision-critical for this repo.)*
- Does sending workout/measurement data to a third party raise **additional Strong ToS exposure** on top of the existing write gray zone?
- Does the API support **batch** requests for cost/latency control? Exact current pricing at GA?
- How stable/versioned is `jev-latest`, and how would **model drift** be detected in a repo that prides itself on determinism?
- Can probability thresholds be made **reviewable and testable** enough to satisfy this project's testing culture (`vitest`, live-test gating)?

### 5.3 Limitations of this research
- **No independent web/fetch tooling in this session.** All external facts come from the parent-fetched dossier; I did not independently re-verify any URL.
- **Source concentration:** the dossier leans on TypeSafe's own docs/launch post (vendor) plus **one** independent blog (Archer Hume) and a single early-access evidence bundle. Independent claims are not replicated across multiple researchers.
- **Performance/pricing claims are vendor-reported**, workload-specific, and not independently reproduced.
- **Repo-fit recommendations (Section 3–4) are researcher inferences** from repo code/README and general System One properties; they are not validated prototypes, and impact labels are predictions, not measured results.
- **No claim here should be read as TypeSafe confirming any specific integration** — TypeSafe has said nothing about `strong-cli`.

---

## 6. Sources

**External (via parent-verified dossier; research date 2026-09-18):**
- TypeSafe — homepage: `https://typesafe.ai` — positioning of System One Models.
- TypeSafe — *Introducing System One Models and Jev*: `https://typesafe.ai/blog/introducing-system-one-models-and-jev` — **vendor** launch claims (latency, pricing, speedups, early access, eval bias disclosure).
- TypeSafe docs — System One concepts: `https://docs.typesafe.ai/concepts/system-one` — question primitives, no-generation/no-agency, text-only.
- TypeSafe docs — API: `https://docs.typesafe.ai/api` — endpoint, alias `jev-latest`, error codes, retry guidance.
- TypeSafe docs — How to build with System One: `https://docs.typesafe.ai/concepts/how-to-build-with-system-one` — code-owns-control-flow guidance.
- TypeSafe docs — Confidence: `https://docs.typesafe.ai/confidence` — derived confidence, not an independent guarantee.
- TypeSafe docs — ML primer: `https://docs.typesafe.ai/introduction/machine-learning-primer` — RLCD / calibration scope.
- TypeSafe evals: `https://evals.typesafe.ai` — **vendor-controlled** code-defined workflow demos (expense-claim review example).
- Archer Hume — *Jev's Architecture Unmasked*: `https://archerhume.com/posts/jevs-architecture-unmasked` — **independent**, explicitly speculative architecture reconstruction + black-box observations.
- Archer Hume — evidence bundle: `https://archerhume.com/research/jev/evidence.json` — public evidence/calibration samples (single early-access version).

**Repository (direct inspection, 2026-09-18):**
- `README.md`, `package.json`, `CHANGELOG.md` — architecture, commands, write/`--write` gating, privacy stance, toolchain (TypeScript ESM, commander, vitest, biome).
- `docs/api-inventory.md`, `docs/data-model.md`, `docs/auth-findings.md` — reverse-engineered API shapes, normalized model, auth/ToS risks.
- `src/cli.ts`, `src/transform/workouts.ts`, `src/write/write-service.ts` — implementation detail for write engine, verify loop, and transform layer.

**Rejected/deprioritized:** none excluded on quality grounds — the dossier was treated as the authoritative external set for this run; the primary constraint is that it centers on vendor material plus a single independent analyst.
