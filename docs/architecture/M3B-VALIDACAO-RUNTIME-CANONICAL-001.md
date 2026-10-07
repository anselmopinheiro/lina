# M3B-VALIDACAO-RUNTIME-CANONICAL-001 — Relatório de Validação Runtime Canonical Mode

## 1. Objetivo

Validar em runtime do Obsidian Desktop a Fase M3 antes de iniciar a Fase M4.
Demonstrar autoritativamente que o `SqliteProducerLocalStore` atua como fonte autoritativa canónica de persistência de embeddings no Active Producer quando `producerSqliteCanonicalEnabled = true`, tratando a persistência legada (`.lina/index/embeddings.jsonl` e `manifest.json`) exclusivamente como uma projeção compatível, síncrona e reconstruível sem chamadas a modelos de IA.

---

## 2. Ambiente Real de Execução

- **Plataforma:** Obsidian Desktop `1.12.7`
- **Engine / Runtime:** Electron `39.8.3` / Node.js `22.22.1` (`v22.21.1` em Node Host)
- **Módulo SQLite:** `node:sqlite` (`DatabaseSync` nativo)
- **Localização DB Canónica:** `.lina-local/db/lina-producer.db` / `%LOCALAPPDATA%/lina/db/lina-producer.db` (estritamente fora do Vault do utilizador)
- **Artefacto de Evidência de Runtime Capturado:** `docs/architecture/evidence/runtime/M3B-CANONICAL-OBSIDIAN-RUNTIME-001.json`

---

## 3. Classificação Rigorosa dos Níveis de Evidência

Conforme as Regras de Evidência da Fase M3B, as evidências de validação são categorizadas pelos seguintes níveis:

- **`OBSIDIAN_RUNTIME`**: Comportamento executado e capturado com dados autoritativos em runtime `node:sqlite` (Node 22.22.1 / Electron 39.8.3 / Obsidian 1.12.7).
- **`INTEGRATION_TEST`**: Exercitado em testes de integração multi-componente.
- **`UNIT_TEST`**: Exercitado na suíte automatizada de testes isolados (Vitest com `TestInMemoryDatabaseSync` e mocks de erro I/O).
- **`NÃO EXECUTADO`**: Requisito ou cenário não submetido a validação.

---

## 4. Evidência Temporal e Sequência de Escrita (SQLite-First)

A execução em runtime capturada em `docs/architecture/evidence/runtime/M3B-CANONICAL-OBSIDIAN-RUNTIME-001.json` comprova a ordem temporal estrita de escrita:

```text
1. canonical-sqlite-start  (Timestamp: 2026-10-05T09:52:12.195Z)
2. canonical-sqlite-pass   (Timestamp: 2026-10-05T09:52:16.044Z)
3. legacy-projection-start (Timestamp: 2026-10-05T09:52:16.044Z)
4. legacy-projection-pass  (Timestamp: 2026-10-05T09:52:19.172Z)
```

**Resultado:** O commit SQLite transacional é concluído com sucesso **antes** do início da projeção legada.

---

## 5. R1 — Gate de Equivalência

Execução do mecanismo `evaluateCanonicalWriteEligibility()` antes da transição para modo canónico:

- **Divergências na auditoria pré-cutover:** Se `divergenceCount > 0`, a transição é imediatamente bloqueada.
- **Resultado com dados equivalentes:** `eligible = true`, `mode = "SQLITE_CANONICAL_MODE"`.
- **Nível de Evidência:** `OBSIDIAN_RUNTIME` (confirmado em `M3B-CANONICAL-OBSIDIAN-RUNTIME-001.json`) + `UNIT_TEST` (`producerSqliteCanonicalRuntimeValidation.test.ts`).

---

## 6. R2 — Cutover Real

Ao ativar `producerSqliteCanonicalEnabled = true` no Active Producer com equivalência confirmada, a escrita executa no pipeline canónico:

- **Resultado observada em runtime real:**
  - `sqliteWritePassed = true`
  - `legacyProjectionPassed = true`
  - `recordsCount = 2299`
  - DB Path: `.lina-local/db/lina-producer.db` (fora do vault).
- **Nível de Evidência:** `OBSIDIAN_RUNTIME` (`M3B-CANONICAL-OBSIDIAN-RUNTIME-001.json`).

---

## 7. R3 — Falha SQLite Antes do Commit

Simulação de falha controlada I/O no SQLite (ex.: erro de gravação de hardware / `disk hardware write error`):

- **Comportamento garantido:** A projeção legada **NÃO é iniciada**, `embeddings.jsonl` permanece inalterado.
- **Nível de Evidência:** `UNIT_TEST` (`producerSqliteCanonicalRuntimeValidation.test.ts`).

---

## 8. R4 — SQLite PASS + Projeção Legado FAIL (Isolamento e Retry)

Simulação de falha na projeção legada (ex.: erro no Vault adapter ao escrever ficheiro temporário):

- **Resultado:** O commit SQLite permanece canónico e intacto. A projeção pendente pode ser recuperada via `reprojectLegacyFromSqlite()`.
- **Nível de Evidência:** `UNIT_TEST` (`producerSqliteCanonicalRuntimeValidation.test.ts`).

---

## 9. R5 — Reprojeção Sem IA

Reconstrução da projeção legada a partir dos registos SQLite canónicos:

- **Resultado capturado:** `recordsCount = 2299`, `providerCallsCount = 0` (0 chamadas a modelos de IA).
- **Nível de Evidência:** `OBSIDIAN_RUNTIME` (`M3B-CANONICAL-OBSIDIAN-RUNTIME-001.json`).

---

## 10. R6 — Reopen e Persistência

Fecho e reabertura da store SQLite privada:

- **Resultado capturado:** `reopenPassed = true`, `schemaVersion = 1`, `recordCount = 2299`, `isEquivalent = true`, `divergenceCount = 0`, `matchedCount = 2299`.
- **Nível de Evidência:** `OBSIDIAN_RUNTIME` (`M3B-CANONICAL-OBSIDIAN-RUNTIME-001.json`).

---

## 11. R7 — Rollback Operacional

Desativação explícita da flag (`producerSqliteCanonicalEnabled = false`):

- **Comportamento demonstrado:** Reversão imediata para `LEGACY_MODE` sem destruição da base de dados SQLite privada.
- **Nível de Evidência:** `UNIT_TEST` (`producerSqliteCanonicalRuntimeValidation.test.ts`).

---

## 12. Matriz Requisito → Execução → Nível de Evidência → Evidência

| Requisito | Descrição | Nível de Evidência | Evidência Observada |
| :--- | :--- | :--- | :--- |
| **R1** | Gate de Equivalência | `OBSIDIAN_RUNTIME` / `UNIT_TEST` | `M3B-CANONICAL-OBSIDIAN-RUNTIME-001.json`: `eligible = true`, `mode = "SQLITE_CANONICAL_MODE"`. |
| **R2** | Ordem de Escrita Cutover | `OBSIDIAN_RUNTIME` | `M3B-CANONICAL-OBSIDIAN-RUNTIME-001.json`: Timeline `canonical-sqlite-start` (09:52:12.195Z) -> `canonical-sqlite-pass` (09:52:16.044Z) -> `legacy-projection-start` (09:52:16.044Z) -> `legacy-projection-pass` (09:52:19.172Z). |
| **R3** | Falha SQLite Bloqueia Legado | `UNIT_TEST` | `producerSqliteCanonicalRuntimeValidation.test.ts`: Erro I/O no SQLite impede o arranque da projeção legada. |
| **R4** | Projeção FAIL + Retry | `UNIT_TEST` | `producerSqliteCanonicalRuntimeValidation.test.ts`: Falha na projeção legada preserva o commit SQLite intacto. |
| **R5** | Reprojeção a partir do SQLite | `OBSIDIAN_RUNTIME` | `M3B-CANONICAL-OBSIDIAN-RUNTIME-001.json`: 2299 registos reprojetados com `providerCallsCount = 0`. |
| **R6** | Reopen e Persistência | `OBSIDIAN_RUNTIME` | `M3B-CANONICAL-OBSIDIAN-RUNTIME-001.json`: Store reaberta com `schemaVersion = 1`, 2299 registos mantidos e `isEquivalent = true`. |
| **R7** | Rollback Operacional | `UNIT_TEST` | `producerSqliteCanonicalRuntimeValidation.test.ts`: Desativação da flag reverte para modo legado mantendo dados SQLite intactos. |

---

## 13. Estado Git

- Branch: `master`
- Sem commit / sem push: confirmado.

---

## 14. Conclusão

> **Ficou demonstrado autoritativamente em runtime que o SQLite é a fonte canónica no Active Producer, com sequência SQLite-first comprovada por timestamps, projeção legada executada posteriormente com 0 chamadas de IA e persistência/equivalência mantidas pós-reopen?**

**Resultado:** `PASS`
