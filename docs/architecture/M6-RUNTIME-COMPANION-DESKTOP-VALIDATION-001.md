# M6 — Validação Runtime Companion Desktop (PROMPT-LINA-M6-COMPANION-DESKTOP-ISOLATED-ENV-001)

## 1. Resumo e Estado da Validação

A validação em runtime Companion Desktop da implementação M6 foi executada com sucesso através de uma instância Obsidian Desktop real e isolada, com perfil de utilizador separado (`--user-data-dir`) e snapshot seguro do vault (`zettel-companion-snapshot`).

```text
COMPANION_DESKTOP_RUNTIME = PASS
CUTOVER_DESKTOP_COMPANION = READY_FOR_DEVICE_SCOPED_ENABLEMENT

ANDROID = NÃO_EXECUTADO
IOS = NÃO_EXECUTADO
GLOBAL_CUTOVER = NOT_READY
```

---

## 2. Nível de Evidência e Método de Isolamento

- **Classificação:** `OBSIDIAN_RUNTIME`
- **Método de Isolamento:** Instância real do Obsidian Desktop (Electron 39.8.3) iniciada com utilizador-data-dir dedicado (`.lina-local/companion-profile`) e snapshot de vault (`.lina-local/zettel-companion-snapshot`).
- **Resolução de Papel:** Natural — o `deviceId` local gerado (`1656bb08-9568-4e1e-a0ff-5d1031b0c180`) difere de forma determinística do `activeProducerId` (`440d9ef0-9ff9-424e-ae55-7c386b885ec8`), resultando em `deviceRole = companion`.

---

## 3. Estado Inicial Observado

- **Vault Snapshot:** `D:\_dev\obsidian\lina\.lina-local\zettel-companion-snapshot`
- **Device ID:** `1656bb08-9568-4e1e-a0ff-5d1031b0c180`
- **Device Role:** `companion`
- **Active Producer ID:** `440d9ef0-9ff9-424e-ae55-7c386b885ec8`
- **Ownership Epoch:** `3`
- **CURRENT Generation:** `generation-000015`

---

## 4. Prova Flag OFF (`companionPublishedGenerationCutoverEnabled = false`)

- **Classificação:** `OBSIDIAN_RUNTIME`
- **Flag Local:** `false`
- **Fonte Selecionada:** `selectedSource = LEGACY`
- **Geração Publicada Ativa:** Nenhuma (`LEGACY`)

---

## 5. Prova Flag ON (`companionPublishedGenerationCutoverEnabled = true`)

- **Classificação:** `OBSIDIAN_RUNTIME`
- **Flag Local:** `true`
- **Fonte Selecionada:** `selectedSource = PUBLISHED`
- **Geração Publicada:** `publishedGenerationId = generation-000015`
- **Elegibilidade do Consumidor:** `consumerEligibility = eligible`
- **Chamadas a Provider / Redes:** `providerCalls = 0`
- **Re-embedding:** `reembedding = 0`

---

## 6. Prova de Rollback (`OFF → ON → OFF`)

- **Transição 1 (OFF):** `selectedSource = LEGACY`
- **Transição 2 (ON):** `selectedSource = PUBLISHED`
- **Transição 3 (OFF):** `selectedSource = LEGACY`
- **Resultado de Rollback:** `PASS`

---

## 7. Garantias de Leitura Estrita (Read-Only)

Confirmou-se que em modo Companion Desktop o plugin Lina não efetuou qualquer alteração de ficheiros nem escritas indevidas no vault:

- **`ownership.json`:** `unchanged = true`
- **`published/CURRENT`:** `unchanged = true`
- **`published/**`:** `unchanged = true`
- **Legacy `embeddings.jsonl`:** `unchanged = true`
- **Binary 3E files:** `unchanged = true`
- **Producer files (`.lina/producer/**`):** `unchanged = true`
- **Diagnóstico M3 Canonical Writer:** `REJECTED` (bloqueado pelo gate de role Companion com 0 escritas)

---

## 8. Conclusão

A validação M6 em runtime Companion Desktop passou integralmente. O cutover para gerações publicadas no Companion Desktop está pronto para ativação por dispositivo (`CUTOVER_DESKTOP_COMPANION = READY_FOR_DEVICE_SCOPED_ENABLEMENT`).
