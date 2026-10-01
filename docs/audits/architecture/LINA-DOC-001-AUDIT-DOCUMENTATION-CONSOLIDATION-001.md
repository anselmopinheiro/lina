# LINA-DOC-001 — Auditoria e Consolidação da Documentação

**Data:** 2026-10-01 (Europe/Lisbon)
**Âmbito:** Auditoria, classificação e consolidação documental integral do repositório Lina antes do início da LINA-15B.
**Branch oficial:** `master` (HEAD: `0b0d1b5`, limpo, sincronizado com `origin/master`).
**Natureza:** Fase exclusivamente documental. Zero alterações a código de produção, testes, schemas, dados persistidos, bundles ou comportamento funcional.

---

## 1. Inventário Global da Documentação

O repositório contém **152 ficheiros Markdown** (excluindo `node_modules`).

### 1.1 Distribuição por Diretório

| Diretório | Ficheiros | Propósito Principal |
|---|---|---|
| `/` (Raiz) | 7 | Governação (`AGENTS.md`), licença, changelog e readmes de topo. |
| `docs/` | 9 | Manuais de utilizador, roadmap de produto e registos de release. |
| `docs/agents/` | 7 | Guias originais em português (fase 0/1), hoje consolidados em `AGENTS.md`. |
| `docs/architecture/` | 27 | Especificações arquiteturais formais, baselines e análises estruturais. |
| `docs/audits/architecture/` | 85 | Auditorias e registos de implementação de arquitetura (LINA-00 a LINA-15A, Git e auditoria global). |
| `docs/audits/documentation/` | 1 | Auditoria/correção de nomenclatura de ficheiros de arquitetura (LINA-03). |
| `docs/audits/release/` | 8 | Registos de preparação, compliance e publicação de releases. |
| `docs/audits/sync/` | 2 | Auditoria e implementação da fronteira de ficheiros temporários de sincronização (LINA-03). |
| `docs/audits/ux/` | 6 | Auditorias e implementações da arquitetura de informação e boundaries das definições (LINA-04, LINA-05). |

---

## 2. Hierarquia de Autoridade Documental

Para eliminar ambiguidades em decisões de desenvolvimento futuro, estabelece-se a seguinte ordem de autoridade estrita e decrescente:

```text
1. AGENTS.md (Governação, regras operacionais permanentes e estado oficial)
   ↓
2. docs/architecture/ (Especificações normativas e baselines arquiteturais ativas)
   ↓
3. docs/audits/ (Auditorias técnicas datadas e registos factuais de implementação)
   ↓
4. docs/roadmap.md e CHANGELOG.md (Planeamento estratégico de produto e histórico de versões)
   ↓
5. README.md e docs/manual.md (Documentação canónica do utilizador final em inglês)
   ↓
6. Documentação Histórica / Arquivada (Registos superseded preservados com aviso explícito)
```

### Regras de Autoridade:
1. **Regra de Não-Suposição Temporal:** O documento com data mais recente não é automaticamente o mais autoritativo; a autoridade depende da natureza normativa do documento, das regras do repositório em `AGENTS.md` e da conformidade com o código executado.
2. **Preservação de Histórico:** Auditorias passadas representam factos históricos na data em que foram executadas. Não são reescritas retroativamente; são contextualizadas através de referências posteriores ou cabeçalhos de estado.
3. **Fonte Única de Governação:** O `AGENTS.md` é a única fonte normativa para regras de desenvolvimento de agentes.

---

## 3. Classificação dos Documentos do Repositório

### 3.1 Documentos Canónicos (Vigência Atual)

| Caminho | Propósito / Domínio | Autoridade |
|---|---|---|
| `AGENTS.md` | Governação do projeto, regras obrigatórias para agentes e estado das fases | Máxima (Nível 1) |
| `docs/architecture/producer-ownership.md` | Arquitetura de Active Producer Ownership, Monotonic Epoch Fencing e histórico de transições | Normativa (Nível 2) |
| `docs/architecture/sync-foundations.md` | Fundações de sincronização, partições de armazenamento (`.lina/` vs `data.json`) | Normativa (Nível 2) |
| `docs/architecture/exclusion-policy-and-artifact-invalidation.md` | Política canónica de exclusão (`.lina/exclusions.json`), invalidation e filtragem defensiva | Normativa (Nível 2) |
| `docs/architecture/embedding-compatibility-and-provenance.md` | `VectorContractV1`, herança no Companion e rastreio de proveniência | Normativa (Nível 2) |
| `docs/architecture/device-identity-and-roles.md` | Identidade UUID persistente, modelo de papéis (`Producer`, `Companion`, `Unassigned`) | Normativa (Nível 2) |
| `docs/architecture/device-scoped-state.md` | Estado persistido por dispositivo em `.lina/devices/<deviceId>.json` | Normativa (Nível 2) |
| `docs/architecture/secrets-and-obsidian-storage.md` | Fronteira estrita de credenciais em `app.secretStorage` OS-level | Normativa (Nível 2) |
| `docs/architecture/companion-delta-search-foundation.md` | Pesquisa local delta em memória no Companion com garantias read-only | Normativa (Nível 2) |
| `docs/architecture/LINA-14-WRITE-PATH-DECISIONS-001.md` | Decisões operacionais do Write Path derivadas de `EmbeddingLifecycleSnapshot` | Normativa (Nível 2) |
| `docs/architecture/LINA-14-EMBEDDING-LIFECYCLE-BASELINE-001.md` | Baseline pura do lifecycle de embeddings (com adenda dos findings pós-LINA-14 / LINA-15A) | Normativa (Nível 2) |
| `docs/manual.md` | Manual canónico e completo de utilizador (versão 0.3.1) | Canónico de UX (Nível 5) |
| `docs/commands.md` | Especificação dos slash commands (`/ask`, `/tags`, `/yaml`) | Canónico de UX (Nível 5) |
| `README.md` | Documento canónico de apresentação do projeto | Canónico de topo (Nível 5) |
| `CHANGELOG.md` | Registo cronológico cumulativo de alterações por versão | Canónico de versão (Nível 4) |

### 3.2 Documentos de Roadmap e Backlog

| Caminho | Propósito | Estado |
|---|---|---|
| `docs/roadmap.md` | Roadmap estratégico de produto do Lina (0.3.x a 1.0.x) | **CANÓNICO / VIGENTE** |
| `docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md` (§30) | Roadmap técnico das fases LINA-15 (LINA-15A a LINA-15I) | **CANÓNICO / VIGENTE (Subsistema Embeddings)** |
| `docs/Lina-0.2.x-Roadmap.md` | Roadmap da série 0.2.x | **HISTÓRICO / SUPERSEDED** por `docs/roadmap.md` |

### 3.3 Documentos Históricos e de Análise Passada

| Caminho | Contexto Histórico | Estado Atual |
|---|---|---|
| `docs/architecture/embedding-policy-foundation.md` | Arquitetura 0.2.2 de política de embeddings | **HISTÓRICO** (superseded por LINA-14 / `embeddingLifecycleModel.ts`) |
| `docs/architecture/embedding-worker.md` | Análise 0.2 de worker | **HISTÓRICO** (superseded por LINA-14 / LINA-15A) |
| `docs/architecture/maintenance-engine.md` | Análise 0.2 de orquestração de manutenção | **HISTÓRICO** (superseded por LINA-14) |
| `docs/architecture/device-identity.md` | Rascunho inicial de identidade | **HISTÓRICO** (consolidado em `device-identity-and-roles.md`) |
| `docs/architecture/device-roles.md` | Rascunho inicial de papéis | **HISTÓRICO** (consolidado em `device-identity-and-roles.md`) |
| `docs/architecture/device-capabilities.md` | Rascunho inicial de capacidades | **HISTÓRICO** (consolidado em `device-identity-and-roles.md`) |
| `docs/architecture/storage-audit.md` | Auditoria de armazenamento da fase 0.2 | **AUDITORIA HISTÓRICA** |
| `docs/architecture/settings-information-architecture.md` | Reorganização de Settings da fase 0.2.3 | **AUDITORIA HISTÓRICA** |
| `docs/architecture/lina-0.2-*.md` (8 ficheiros) | Análises de transição da fase 0.2 | **ANÁLISE HISTÓRICA** |
| `docs/agents/*.md` (7 ficheiros) | Guias de desenvolvimento iniciais em PT | **HISTÓRICO** (consolidado no `AGENTS.md`) |
| `release-notes.md` | Notas de lançamento da versão 0.2.1 | **HISTÓRICO** |
| `docs/release-*.md` (3 ficheiros) | Notas de lançamento de 0.1.10, 0.3.0 e 0.3.1 | **HISTÓRICO DE RELEASE** |
| `README-pt.md` e `docs/manual-alfa.md` | Documentação em português descontinuada | **DESCONTINUADO** (já marcado no próprio documento) |
| `task-progress.md` e `docs/task-progress.md` | Checklists efêmeras de fases anteriores | **OBSOLETO** (não reflete tarefas ativas) |

---

## 4. Auditoria de Contradições e Decisões

### Contradição 1: Branch Oficial do Repositório Git

- **Documento A:** `docs/audits/architecture/LINA-00-AUDIT-PROJECT-RULES-001.md` (aponta menções a "main por defeito").
- **Documento B:** `AGENTS.md` (regras de release e fluxo git) e estado real do repositório (`git branch --show-current`).
- **Conflito:** Ambiguidade sobre se o branch canónico é `main` ou `master`.
- **Evidência:** O repositório real está no branch `master`, `origin/master` é a referência remota, `0b0d1b5` é o merge auditado dos históricos divergentes.
- **Decisão Canónica:** O branch oficial permanente é estritamente **`master`**. Quaisquer referências soltas a `main` são obsoletas e devem ser desconsideradas.

---

### Contradição 2: Estado da Baseline LINA-14 vs Auditoria Global Pós-LINA-14

- **Documento A:** `docs/architecture/LINA-14-EMBEDDING-LIFECYCLE-BASELINE-001.md` (§1 declara "integralmente concluída, testada e validada", "100% dos componentes em produção utilizam a cadeia canónica").
- **Documento B:** `docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md` (identifica 26 findings F-01 a F-26, incluindo ausência de fencing de autoridade em curso F-01, auto-claim destrutivo em ownership corrompido F-02, divergência entre planeador e lifecycle F-03, e sintetizadores paralelos de snapshot F-06).
- **Conflito:** A baseline LINA-14 descreve o *modelo idealizado* como se toda a runtime estivesse 100% migrada e sem falhas, enquanto a auditoria global subsequente provou empiricamente a existência de gaps concretos.
- **Evidência:** O commit `0d9580d` (LINA-15A) teve de intervir para implementar o fencing de epoch (`assertCurrent()`) antes de cada persistência durável, corrigindo F-01 e F-02.
- **Decisão Canónica:**
  1. A arquitetura de separação pura de `EmbeddingLifecycleSnapshot` e `deriveEmbeddingWritePathDecision` da LINA-14 é a **especificação canónica normativa**.
  2. A declaração de conclusão integral da LINA-14 deve ser entendida como a **conclusão da fundação do modelo e consolidação do Write Path primário**.
  3. O estado real do subsistema é composto por: **Baseline LINA-14 + Resoluções LINA-15 (LINA-15A aplicada; LINA-15B a LINA-15I no roadmap)**.

---

### Contradição 3: Infraestrutura Shadow e Modelos Antigos

- **Documento A:** Documentação histórica de fases LINA-11 a LINA-14D referindo `EmbeddingWorkflowState`, `resolveEmbeddingWorkflowState`, `compareLegacyWithLifecycleSnapshot`, `compareLegacyWritePathWithLifecycle`.
- **Documento B:** `docs/audits/architecture/LINA-14F5-IMPLEMENT-SHADOW-INFRASTRUCTURE-REMOVAL-001.md` e código fonte em `src/index/`.
- **Conflito:** Risco de agentes tentarem reintroduzir tipos legados ou comparadores shadow.
- **Evidência:** `EmbeddingWorkflowState` foi completamente removido em LINA-14F.4-B3; a infraestrutura de comparação shadow foi eliminada em LINA-14F.5 (`2f1bfd8`). `grep` no código confirma 0 ocorrências de `EmbeddingWorkflowState` em `src/`.
- **Decisão Canónica:** `EmbeddingWorkflowState` e comparadores shadow estão **definitivamente eliminados**. A única fonte de estado de ciclo de vida é `EmbeddingLifecycleSnapshot`.

---

### Contradição 4: Localização dos Ficheiros Operacionais do Producer

- **Documento A:** `AGENTS.md` (versões anteriores referindo staging/checkpoints em `.lina/index/`).
- **Documento B:** `docs/architecture/sync-foundations.md`, `docs/architecture/producer-ownership.md` e código em `src/index/embeddingPersistence.ts`.
- **Conflito:** Ambiguidade sobre se os checkpoints e backups ficam em `.lina/index/` ou `.lina/producer/`.
- **Evidência:** A implementação canónica isola rigorosamente:
  - Artefactos publicados partilhados: `.lina/index/{manifest.json, notes.json, chunks.jsonl, embeddings.jsonl, embeddings.vectors.f32}`
  - Área operacional privada do Producer: `.lina/producer/{checkpoints, staging, backups}/`
- **Decisão Canónica:** A partição canónica é estritamente **`.lina/producer/`** para ficheiros operacionais e **`.lina/index/`** apenas para publicações finais.

---

### Contradição 5: Providers Oficiais de IA Suportados

- **Documento A:** Fases antigas 2A.1 / 9N-B2 referindo OpenAI, Claude/Anthropic, Gemini e Custom.
- **Documento B:** `AGENTS.md` (Fase 9N-D6) e `src/ai/providerDefaults.ts`.
- **Conflito:** Risco de supor suporte ativo a múltiplos providers proprietários na UI.
- **Evidência:** A fase 9N-D6 oficializou exclusivamente três providers ativos no Lina: **`Ollama`** (local), **`Mistral`** (cloud) e **`OpenRouter`** (cloud). Outros providers foram descontinuados e mantêm apenas normalização interna passiva para ler configurações legadas antigas sem crash.
- **Decisão Canónica:** Os únicos providers oficialmente suportados na UI e desenvolvimento ativo são **Ollama, Mistral e OpenRouter**.

---

## 5. Contratos Normativos e Invariantes do Subsistema de Embeddings

Para eliminar qualquer ambiguidade em fases futuras (LINA-15B em diante), consolidam-se os contratos normativos vigentes:

### 5.1 `EmbeddingLifecycleSnapshot`
- **Definição:** `src/index/embeddingLifecycleModel.ts`
- **Teste:** `tests/index/embeddingLifecycleModel.test.ts`
- **Regra:** Estrutura imutável, determinística e pura, sem I/O. Descreve 12 estados primários (`primary`), com 4 regiões ortogonais (`read`, `write`, `process`, `history`) e flags de capacidade (`capability`).

### 5.2 `deriveEmbeddingWritePathDecision()`
- **Definição:** `src/index/embeddingLifecycleWritePath.ts`
- **Teste:** `tests/index/embeddingLifecycleWritePath.test.ts`
- **Regra:** Função de decisão pura que avalia o snapshot e determina a ação operacional recomendada (`generate`, `update`, `rebuild`, `retry`, `cancel`, `none`), requisitos de confirmação (`rebuild` ou custo externo), e gates de início de operação.

### 5.3 `VectorContractV1`
- **Definição:** `src/index/vectorContract.ts`
- **Teste:** `tests/device/vectorContractStartupOrder.test.ts`, `tests/device/vectorContractAndCompanionInheritance.test.ts`
- **Regra:** Gravado no manifesto `.lina/index/manifest.json`. O Companion herda obrigatoriamente o contrato publicado pelo Producer. Zero fallback silencioso entre modelos ou espaços vetoriais diferentes.

### 5.4 Ownership e Monotonic Epoch Fencing
- **Definição:** `src/device/ownershipGate.ts`, `src/device/deviceOwnership.ts`, `src/index/embeddingPersistence.ts`
- **Teste:** `tests/device/deviceOwnership.test.ts`, `tests/device/ownershipGate.test.ts`, `tests/index/embeddingPersistence.test.ts`
- **Regra:** O Active Producer é o único dispositivo com autoridade de escrita em `.lina/index/*`. Cada operação obtém um token de fencing `{ producerDeviceId, epoch }` e valida via `assertCurrent()` antes de promover checkpoints, JSONL canónico, manifesto ou purga. Epochs são estritamente monotónicos ($E \to E + 1$) e nunca reiniciam.

### 5.5 Isolamento Producer vs. Companion
- **Definição:** `src/companion/companionCapability.ts`, `src/companion/companionSearch.ts`, `src/companion/companionDeltaSearch.ts`
- **Teste:** `tests/companion/*`, `tests/device/deviceDiagnosticsCompanion.test.ts`
- **Regra:** Companion tem `write.applicable = false`, zero escritas em disco na área partilhada, zero arranque de workers/schedulers de geração de embeddings, e opera pesquisa com fallback textual automático quando embeddings não estão disponíveis.

---

## 6. Estado Consolidado do Roadmap LINA-15

O roadmap da iniciativa **LINA-15 (Embeddings Subsystem Hardening & Integrity)** deriva diretamente da auditoria global pós-LINA-14 (`docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md` §30) e organiza-se nas seguintes fases:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ LINA-15A: Ownership Fencing & Epoch Hardening (CONCLUÍDA - commit 0d9580d) │
│ - Token { producerDeviceId, epoch } antes de escrita durável / checkpoint  │
│ - Distinção estrita missing vs unreadable/invalid/future no claim inicial  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ LINA-15B: Reconciliação Plano ↔ Lifecycle (PRÓXIMA FASE / ABERTA)      │
│ - Reconciliar plan.mode full-rebuild com INCOMPATIBLE no lifecycle    │
│ - Identidade publicada real (manifesto) e inputVersion no snapshot    │
│ - Teste formal de equivalência plano ↔ lifecycle                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ LINA-15C: Estado de Escrita para Canónicos Grandes (ABERTA)            │
│ - Separar limite de recursos de corrupção em canónicos grandes        │
│ - Permitir rebuild destrutivo explícito a partir de INDETERMINATE      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ LINA-15D: Fonte Única de Snapshot & Remoção de Sintetizadores (ABERTA) │
│ - Eliminar sintetizadores paralelos e identidades fabricadas (F-06)   │
│ - Ligar estado real do índice textual (NO_TEXT_INDEX) ao snapshot     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ LINA-15E: Sidebar UI & Limpeza de Código Morto (ABERTA)                │
│ - Ligar botão da sidebar à decisão canónica (F-05)                    │
│ - Remover código morto de derivação de UI e módulos inalcançáveis     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ LINA-15F a LINA-15I: Persistência, Custos, Performance e Testes        │
│ - 15F: Persistência, recuperação no arranque e validação manifesto     │
│ - 15G: Localidade por host/URL, settings e backoff em cancelamento    │
│ - 15H: Arranque leve sem leitura integral e cálculo partilhado de plano│
│ - 15I: Fecho das lacunas de testes e reconciliação documental D1–D12   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Ações de Consolidação Documental Executadas

1. **Criação do Índice Documental Unificado:**
   - Criado `docs/INDEX.md` com o catálogo categorizado de todos os documentos, hierarquia de autoridade e guia de navegação para futuros agentes.
2. **Adenda na Baseline LINA-14:**
   - Atualizado `docs/architecture/LINA-14-EMBEDDING-LIFECYCLE-BASELINE-001.md` com nota de contexto integrando a auditoria global pós-LINA-14 e a resolução LINA-15A.
3. **Marcação de Documentos Históricos / Análises Passadas:**
   - Adicionados cabeçalhos claros de aviso histórico em documentos antigos de arquitetura (`docs/architecture/embedding-policy-foundation.md`, `docs/architecture/embedding-worker.md`, `docs/architecture/maintenance-engine.md`, `docs/architecture/device-identity.md`, `docs/architecture/device-roles.md`, `docs/architecture/device-capabilities.md`, `docs/architecture/storage-audit.md`, `docs/Lina-0.2.x-Roadmap.md`, `release-notes.md`).
4. **Atualização de Governação em `AGENTS.md`:**
   - Registada a conclusão da fase LINA-15A, a presente fase documental LINA-DOC-001, a confirmação do branch oficial `master` e a hierarquia documental normativa.

---

## 8. Conclusão e Prontidão para a Fase LINA-15B

A documentação do repositório Lina encontra-se totalmente auditada, classificada e consolidada. Não subsistem ambiguidades quanto ao branch oficial (`master`), à autoridade dos documentos, aos contratos normativos de embeddings ou ao roadmap ativo da LINA-15.

**O repositório está formalmente pronto para o arranque da Fase LINA-15B (Reconciliação Plano ↔ Lifecycle).**
