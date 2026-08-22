# Lina Roadmap --- After 0.2.1

## Vision

Lina evolves as a local-first intelligence layer for Obsidian, keeping
search, indexing, embeddings and AI features simple, transparent and
predictable.

Principles:

- Protect user data and vault content.
- Keep behavior predictable and controllable.
- Align progressively with Obsidian community expectations.

---

# 0.2.2 --- Release Stabilization

## Goal

Post-release reliability improvements.

- [ ] Improve deterministic production builds.
- [ ] Improve release validation.
- [ ] Improve CI/CD reliability.
- [ ] Fix minor UX issues.

---

# 0.3.x --- Producer State and Sync Resilience

## Goal

Create an explicit state model for Desktop Producer artifacts.

## Producer State

- [ ] Create versioned `producer-state.json`.
- [ ] Store producer identity.
- [ ] Store last successful index update.
- [ ] Store last successful embeddings update.
- [ ] Store last successful maintenance completion.

## Freshness

- [ ] Expose artifact freshness.
- [ ] Define Fresh, Aging and Stale states.

## Synchronization

- [ ] Detect incomplete synchronization.
- [ ] Detect temporary sync conflicts.
- [ ] Protect against partially synchronized artifacts.
- [ ] Improve Syncthing compatibility.
- [ ] Add multi-device tests.

Rules:

- Desktop remains the only Producer.
- Mobile remains consumer only.
- Lina does not provide cloud synchronization.

---

# 0.4.x --- Companion Delta Search

## Goal

Allow Mobile Companion devices to find recent notes before Producer
updates persistent artifacts.

- [ ] Detect recently created notes.
- [ ] Detect recently modified notes.
- [ ] Create temporary local search layer.
- [ ] Combine persistent index and local delta results.

Rules:

- [ ] Mobile never writes shared index.
- [ ] Mobile never creates embeddings.
- [ ] Mobile never modifies binary artifacts.
- [ ] Delta results remain temporary.
- [ ] Text and semantic results remain separated.

---

# 0.5.x --- First Run Experience

## Goal

Reduce initial user friction.

- [ ] Explain Producer / Companion model.
- [ ] Guide initial index creation.
- [ ] Guide AI configuration.
- [ ] Improve empty states.
- [ ] Add optional provider validation feedback.

---

# 0.6.x --- Search Experience and Provenance

## Goal

Improve daily search usability.

- [ ] Clear search action.
- [ ] Folder search.
- [ ] Better result context.
- [ ] Embedding provenance:
  - [ ] Provider.
  - [ ] Model.
  - [ ] Creation date.
  - [ ] Producer information.
  - [ ] Validity state.

---

# 0.7.x --- Contextual AI Actions

## Goal

Provide AI actions over selected text.

- [ ] Summarize.
- [ ] Explain.
- [ ] Improve writing.
- [ ] Correct.
- [ ] Rewrite.
- [ ] Create bullet points.
- [ ] Translate.

Reuse existing AI execution paths.

---

# 0.8.x --- Privacy Controls and Intelligent Commands

## Goal

Improve user control over AI usage.

- [ ] Define protected content markers.
- [ ] Keep protected content searchable locally.
- [ ] Prevent protected content from being sent to AI providers.
- [ ] Add `/contact` structured note assistance.

---

# 0.9.x --- Intelligent Note Formatting

## Goal

Transform notes while preserving original information.

- [ ] Meeting notes.
- [ ] Academic notes.
- [ ] Zettelkasten-compatible structures.
- [ ] Reversible transformations.

---

# 1.0.x --- Architecture Review and Beta Readiness

Review:

- [ ] Architecture.
- [ ] Security.
- [ ] Privacy.
- [ ] Data integrity.
- [ ] Performance.
- [ ] Desktop/Mobile behavior.
- [ ] Tests.
- [ ] Build and release process.
- [ ] Documentation.

---

# Future --- PDF, Images and OCR

Deferred:

- [ ] OCR processing.
- [ ] Semantic search over extracted content.
- [ ] Image processing.

---

# Future Tooling Improvement

- [ ] Make production builds deterministic by excluding or normalizing
  development timestamps.

---

# Roadmap Policy

This roadmap represents current direction and may change according to
bugs, feedback, Obsidian changes and technical constraints.