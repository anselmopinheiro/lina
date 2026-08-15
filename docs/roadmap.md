# Lina Roadmap

## Vision

Lina aims to evolve into an intelligent layer for Obsidian, reducing manual configuration while making search, indexing, embeddings, and AI features simpler and more transparent.

Development follows three core principles:

* protect the user's data and vault;
* keep behavior predictable, transparent, and controllable;
* progressively align Lina with the technical practices and expectations of the Obsidian community.

This roadmap describes the current direction of the project. Version numbers below represent development series rather than rigid release commitments. Intermediate releases may be published whenever needed for fixes, stabilization, or smaller improvements.

---

# 0.1.x — Stabilization, Technical Quality, and Integrity

## Goal

Consolidate Lina's current foundation before introducing deeper automation.

This series focuses on known bugs, data integrity, code quality, and issues identified by development tooling and Obsidian-specific rules and practices.

## Technical quality and Obsidian compliance

Priorities include:

* fix current ESLint errors;
* review and address relevant warnings from Obsidian-specific lint rules;
* review unsafe types, casts, and error-prone type handling;
* verify correct plugin lifecycle and resource cleanup;
* keep lint, typecheck, tests, build, release checks, and CI healthy;
* avoid cosmetic refactors or abstractions without a concrete benefit.

The goal is not to artificially reach “zero warnings”. Relevant issues should be fixed, while justified exceptions may remain documented.

## Search and exclusions

Improve runtime reconciliation when exclusion settings change.

When a folder or rule becomes excluded, Lina should update its state without requiring an Obsidian or vault restart.

This includes:

* removing affected notes from the index;
* invalidating related chunks;
* invalidating or removing associated embeddings when applicable;
* updating derived artifacts when required.

When an exclusion is removed, Lina should detect content that becomes eligible again and process it automatically.

## Note rename and move integrity

Make rename and move operations consistent across Lina's internal data.

Lina should:

* remove references to the old path;
* update the index with the new path;
* invalidate obsolete chunks;
* update embeddings when required;
* remove orphaned references;
* prevent search results that point to files that no longer exist.

## Synchronized indexes across devices

Improve detection and use of existing indexes, particularly on Mobile.

Lina should distinguish between:

* an index that does not exist;
* an index created or received from another device;
* an existing but outdated index.

The goal is to support synchronized artifacts, including workflows using tools such as Syncthing, without unnecessary rebuilds.

---

# 0.2.x — Automation Engine

## Goal

Progressively remove manual management of indexes, embeddings, and derived artifacts.

## Automatic index maintenance

Lina should automatically maintain the textual index when notes are:

* created;
* modified;
* deleted;
* renamed;
* moved.

Incremental updates should be preferred over full rebuilds whenever possible.

## Automatic embeddings

Lina should detect:

* missing embeddings;
* outdated embeddings;
* incompatible embeddings;
* interrupted operations.

Only the embeddings that actually need work should be created or updated.

## Automatic binary artifacts

Binary artifacts derived from embeddings should be created and refreshed automatically when required.

Manual maintenance actions may remain available as advanced diagnostic and recovery tools.

## Internal reconciliation

Introduce a diagnostic and reconciliation mechanism capable of identifying and, when safe, correcting:

* missing files;
* invalid chunks;
* orphaned embeddings;
* outdated derived artifacts;
* partially updated states.

---

# 0.3.x — Desktop Producer / Mobile Companion

## Goal

Define appropriate responsibilities for Desktop and Mobile while maintaining a single Lina plugin.

## Desktop Producer

Desktop may take responsibility for heavier production tasks such as:

* creating and maintaining the primary index;
* generating embeddings;
* maintaining binary artifacts;
* running reconciliation.

## Mobile Companion

Mobile should primarily consume prepared and synchronized data:

* synchronized indexes;
* synchronized embeddings;
* search;
* AI queries where supported.

Desktop-only capabilities must be isolated so that unsupported functionality cannot break the plugin on Mobile.

## Synchronization

Improve integration with external synchronization workflows.

Lina should distinguish between artifacts that genuinely do not exist and artifacts that were simply produced on another device.

---

# 0.4.x — Configuration Simplification

## Goal

Turn technical configuration into a simpler and more understandable user experience.

## First-run onboarding

Introduce onboarding that can guide the user through:

* choosing the device role;
* choosing an AI provider;
* configuring credentials;
* automatically preparing required structures.

## Simplified settings

Separate normal configuration from advanced maintenance options.

Normal settings should focus on:

* Lina status;
* provider;
* model;
* synchronization.

Advanced settings may expose:

* index controls;
* embeddings;
* binary artifacts;
* diagnostics;
* maintenance actions.

---

# 0.5.x — Search and Context

## Goal

Improve search usability and make Lina's context more understandable.

Planned areas include:

* a clear-search button;
* preserving the last analysis when switching notes;
* clearly identifying which note an analysis belongs to;
* displaying embedding provenance;
* searching folder names;
* visually distinguishing notes from folders;
* consistently respecting exclusion rules.

Embedding provenance may include:

* model;
* provider;
* device of origin;
* creation date;
* current validity state.

---

# 0.6.x — Contextual AI Actions

## Goal

Provide quick actions for selected text without multiplying redundant commands.

Lina should be able to use selected text as context for actions such as:

* summarize;
* explain;
* improve writing;
* correct;
* rewrite;
* create bullet points;
* translate.

These actions should reuse `/ask` as the main execution path whenever practical.

Custom user-defined Actions are also planned.

---

# 0.7.x — Lina Commands

## Goal

Add useful commands without duplicating existing functionality.

## Existing commands

* `/ask`
* `/tags`

## Planned commands

### `/secret`

Allow content to remain available for local search while preventing it from being sent to external AI providers.

### `/contact`

Help transform contact notes into a more structured Obsidian format while preserving the original information.

---

# 0.8.x — Intelligent Note Formatting

## Goal

Transform loosely structured notes into useful formats without losing information.

Potential use cases include:

* contacts;
* academic notes;
* meeting information;
* structures compatible with organizational methods such as Zettelkasten.

Transformations should be predictable and preserve original content whenever possible.

---

# Architecture Review and Beta Readiness

After the main functional phases have been implemented and stabilized, Lina will undergo a broader architecture and readiness review.

The review is expected to cover:

* architecture;
* security;
* privacy;
* vault data integrity;
* performance;
* Desktop/Mobile behavior;
* plugin lifecycle;
* Obsidian APIs;
* dependencies;
* tests;
* build and release process;
* documentation;
* relevant Obsidian community submission requirements and guidelines.

Moving to Beta will depend on the actual state of the project rather than on a specific version number.

Expected readiness criteria include:

* no known critical bugs;
* no known technical blockers;
* predictable index and embedding behavior;
* stable synchronization;
* healthy lint, typecheck, tests, build, and CI;
* appropriate protection of user data;
* a sufficiently clear experience for third-party users;
* no significant blockers identified by the architecture review.

---

# AI Providers

The current roadmap considers support for:

* Ollama;
* Mistral;
* OpenRouter.

Use of external services should always be clear to the user, especially when vault content may leave the device.

---

# Roadmap Policy

This document reflects Lina's current direction, not a fixed promise of release dates or exact version assignments.

Priorities, ordering, and grouping may change in response to:

* discovered bugs;
* user feedback;
* changes in Obsidian;
* community requirements;
* technical constraints;
* lessons learned during development.

A release may happen at any point within a version series when it provides a useful and stable improvement.
