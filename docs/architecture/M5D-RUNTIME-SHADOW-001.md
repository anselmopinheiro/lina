# M5D-RUNTIME-SHADOW-001 — Relatório de Prova Runtime Shadow Consumption

## 1. Objetivo

Fechar formalmente a subfase **M5D** (Validação Runtime em Shadow Consumption), registando as medições autoritativas obtidas no ambiente real do **Obsidian Desktop** (vault `zettel`) sob o papel de Active Producer, com estrita diferenciação dos níveis de evidência.

---

## 2. Ambiente de Diagnóstico Real

- **Plataforma:** Obsidian Desktop `1.12.7`
- **Engine / Runtime:** Electron `39.8.3` / Node.js `22.22.1` (`win32`)
- **Vault de Teste:** `zettel`
- **Dispositivo:** `TESTES` (`role`: `producer`)
- **Geração M4 Publicada em Disco:** `generation-000008` (2303 registos de embeddings)
- **Comando de Diagnóstico:** `Lina: Diagnose m5 shadow`

---

## 3. Cenários de Runtime Observados no Obsidian Desktop Real

### 3.1. Cenário 1: Flag OFF (`companionPublishedGenerationShadowEnabled = false`)

```text
Status: IDLE
Generation: none
Level: L2
Reader: n/a
Divergences: 0
Legacy / published: n/a / n/a
Legacy ms / shadow ms: n/a / n/a
Provider calls: 0
```

- **Nível de Evidência:** `OBSIDIAN_RUNTIME`
- **Interpretação:**
  - O auditor em background não é agendado nem executado.
  - Zero leituras de gerações publicadas sob `.lina/published/`.
  - O caminho crítico servido por `getRuntimeEmbeddingIndex()` executa exclusivamente sobre o índice legado.
  - `providerCalls = 0` (zero chamadas a providers de IA).

### 3.2. Cenário 2: Flag ON (`companionPublishedGenerationShadowEnabled = true`)

```text
Status: PASS
Generation: generation-000008
Level: L2
Reader: n/a
Divergences: 0
Legacy / published: 2303 / 2303
Legacy ms / shadow ms: 126 / 124
Provider calls: 0
```

- **Nível de Evidência:** `OBSIDIAN_RUNTIME`
- **Interpretação:**
  - O auditor `PublishedGenerationShadowAuditor` disparou em paralelo no arranque/diagnóstico.
  - O `PublishedGenerationReader` leu `generation-000008` utilizando exclusivamente `DataAdapter` e digest WebCrypto SHA-256 (`createWebCryptoEmbeddingDigest`).
  - Comparação de Nível L2 (desktop): 2303 registos legados vs 2303 registos publicados validados via `compareLegacyAndPublished()`.
  - Divergências: `0` (equivalência perfeita em metadados, cardinalidade e vetores `Math.fround`).
  - Tempos de execução independentes: `126 ms` (carregamento/análise legado) vs `124 ms` (leitura + digest + comparação shadow em background).
  - `providerCalls = 0` (nenhuma regeneração de embeddings por IA).

---

## 4. Garantia Arquitetural — Legacy Authoritative

O contrato implementado na Fase M5C garante que `getRuntimeEmbeddingIndex()` devolve **sempre** em primeiro lugar o índice legado ao utilizador. A auditoria M5 executa de forma assíncrona e desvinculada do resultado da pesquisa.

- **Nível de Evidência de Runtime:** `OBSIDIAN_RUNTIME` (confirmado que as pesquisas no vault `zettel` continuam a ser servidas inalteradas pelo índice legado enquanto o shadow mode mede a equivalência em memória).
- **Nível de Evidência de Contrato Programático:** `INTEGRATION_TEST` (garantido pela suíte de testes em `tests/index/publishedGenerationShadowAudit.test.ts`).

---

## 5. Classificação Rigorosa dos Níveis de Evidência para Cenários de Falha Controlada

Todos os cenários de falha do leitor e do comparador que não foram provocados intencionalmente no ambiente de produção do Obsidian Desktop real permanecem categorizados pelos seus níveis de teste reais:

| Cenário de Falha / Comportamento | Descrição | Nível de Evidência | Origem da Evidência |
| :--- | :--- | :--- | :--- |
| **`DIVERGED`** | Recusa de equivalência por desalinhamento de metadados/vetores | `UNIT_TEST` | `tests/index/publishedGenerationEquivalence.test.ts` |
| **`TARGET_PARTIAL`** | Ficheiros de geração truncados ou em falta | `UNIT_TEST` | `tests/index/publishedGenerationReader.test.ts` |
| **`HASH_MISMATCH`** | Corrupção de SHA-256 em `records.json` ou `vectors.bin` | `UNIT_TEST` | `tests/index/publishedGenerationReader.test.ts` |
| **`DOWNGRADE_REJECTED`** | Tentativa de leitura de `CURRENT` apontando para geração anterior | `UNIT_TEST` | `tests/index/publishedGenerationReader.test.ts` |
| **`CURRENT_CHANGED`** | Rotação concorrente de `CURRENT` durante a leitura | `UNIT_TEST` | `tests/index/publishedGenerationReader.test.ts` |
| **Single-flight** | Bloqueio de auditorias concorrentes simultâneas | `INTEGRATION_TEST` | `tests/index/publishedGenerationShadowAudit.test.ts` |
| **Deduplicação** | Reutilização de auditoria prévia para mesma versão de `CURRENT` | `INTEGRATION_TEST` | `tests/index/publishedGenerationShadowAudit.test.ts` |

---

## 6. Matriz de Execução por Plataforma e Dispositivo

| Plataforma / Dispositivo | Âmbito Previsto | Estado de Execução | Nível de Evidência |
| :--- | :--- | :--- | :--- |
| **Producer Desktop** (Windows) | Validação L2 completa no vault `zettel` | `PASS` | `OBSIDIAN_RUNTIME` |
| **Companion Desktop** | Leitura de publicação em dispositivo secundário | `NÃO_EXECUTADO` | `NÃO_EXECUTADO` |
| **Android Mobile** | Leitura L1 mobile-safe | `NÃO_EXECUTADO` | `NÃO_EXECUTADO` |
| **iOS Mobile** | Validação de `readBinary` + WebCrypto | `NÃO_EXECUTADO` | `NÃO_EXECUTADO` |

---

## 7. Estado Git

- Branch: `master`
- Sem commit ou push: confirmado.

---

## 8. Conclusão M5D

**Resultado M5D:** `PASS` (para a validação em Desktop Producer Runtime).

A fase M5D demonstra empiricamente em runtime real que o shadow mode funciona de forma não bloqueante, em background, mantendo zero chamadas a providers de IA e equivalência perfeita entre o legado e a geração publicada M4.
