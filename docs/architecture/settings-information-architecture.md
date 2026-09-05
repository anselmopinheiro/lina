# Settings & UX Information Architecture

## Context & Objectives

As Lina entered the Release Stabilization phase (0.3.x), the capabilities of the plugin (Desktop Producer + Mobile Companion model, embedding update lifecycle, provider policy, scheduler, backoff protection, SecretStorage boundaries) had matured significantly.

The objective of **Settings UX Information Architecture & Collapsible Groups** (`LINA-UX-IMPL-002` / `LINA-UX-IMPL-002-FIX-001`) is to structure all 50 existing settings according to clear user intent, domain cohesion, and progressive disclosure without removing, simplifying, or breaking any underlying functionality.

### Core UX Principles

> **Show users what they need to operate Lina. Hide technical complexity until it is required.**
>
> **Configuration should be grouped by user intent and domain coherence, not by technical implementation.**
>
> **Progressive disclosure through collapsible accordions reduces cognitive load while retaining 100% of capabilities.**

---

## 5 Operational Collapsible Accordion Groups Architecture

Lina settings are structured into **5 operational collapsible accordion groups**, framed by an uncollapsed general header and a dedicated support footer:

```text
General / Interface (Header, non-collapsible)
├── Plugin identity & build version
└── Interface language selector & multilingual guidance

1. 📱/🟢 Device & Producer (Operational accordion, expanded by default)
├── Device role badge, first-run chooser, active producer transfer, and role switching
└── Friendly local device name

2. 🤖 AI Assistant & Analysis (Operational accordion, collapsed by default)
├── Complete provider setup: provider, model, base URL endpoint, API credentials
├── Connection test action & instant diagnostic feedback
└── Analysis tuning: timeout, inbox folder, YAML allowed properties, and tag suggestions count

3. 🔍 Semantic Search & Embeddings (Operational accordion, collapsed by default)
├── Complete semantic setup: enable toggle, provider, model, base URL, API credentials
├── Embedding update policy (manual vs automatic-local-only) & connection test
└── Semantic tuning: batch size, timeout, language hint, and hybrid search balance weights

4. 🛡️ Privacy & Exclusion Rules (Operational accordion, collapsed by default)
├── Excluded folders & configuration notice
└── Sensitive path pattern exclusions & content exclusion keyword terms

5. ⚙️ Diagnostics & Advanced Maintenance (Operational accordion, collapsed by default)
├── Automatic index maintenance on file changes & startup re-indexing
├── Startup sync verification check & debug update logging
└── Search acceleration storage preference (prefer-binary vs jsonl), maintenance toggle,
    status inspector, and cache actions (check, create/update, remove)

Support & Contact (Footer, non-collapsible)
├── Support & feedback form link
└── Email support contact with one-click copy button
```

### Domain Separation & Group Roles

1. **Header (General / Interface):** Uncollapsed top area containing language selection and compile-time version/build indicators.
2. **Group 1 (Device & Producer):** Focused strictly on device identity, assigned role, active producer promotion, and device naming.
3. **Group 2 (AI Assistant & Analysis):** Contains everything required to configure, authenticate, test, and tune AI note analysis and slash commands.
4. **Group 3 (Semantic Search & Embeddings):** Contains everything required to configure, authenticate, test, and tune vector embeddings and hybrid search balance.
5. **Group 4 (Privacy & Exclusion Rules):** Houses folder, path, and content exclusions, with read-only gating on Companion devices.
6. **Group 5 (Diagnostics & Advanced Maintenance):** Collapsed by default; isolates background sync checks, debug logging, and heavy binary acceleration cache operations.
7. **Footer (Support & Contact):** Uncollapsed bottom area providing immediate access to support channels and email contact.

---

## Producer vs Companion Device UX

Lina strictly differentiates the presentation between **Desktop Producer** and **Mobile Companion** devices:

1. **Role Transparency:**
   - Clearly visible at the top of Group 1 under Current Device.
   - Answers immediately: *Is this device Producer or Companion? What can this device do?*
2. **Companion Safeguards:**
   - Controls that are only valid for the Producer (such as embedding update mode configuration or generation triggers) are safely disabled on Companion devices.
   - On Companion devices, embedding provider and model are inherited directly from the published manifest (`VectorContractV1`), while local endpoint and credentials remain configurable.
   - Exclusion rules are presented in read-only mode with clear governance notices:
     > **Companion mode active — Exclusion rules are managed by your Active Producer.**

---

## Architectural Invariants Preserved

1. **Zero Functionality Lost:** All 50 setting definitions and actions are preserved with identical underlying data keys and runtime behaviors.
2. **Deterministic Declarative Blueprint:** Blueprint structure cleanly models the 7 groups (Header + 5 accordions + Footer) with zero schema migration or storage breakages.
3. **Secret Storage Boundary:** API keys remain strictly in `app.secretStorage` per device; no secrets are exposed in diagnostics, blueprints, or logs.
4. **Role Integrity:** Device role remains strictly tied to device identity and capabilities without artificial user dropdowns.
5. **Full Keyboard Accessibility:** Accordion headers support Enter and Space navigation with ARIA expanded/collapsed attributes.
6. **Mobile Safety:** Fully compatible with desktop and mobile runtimes; zero browser-incompatible dependencies in the settings UI.
