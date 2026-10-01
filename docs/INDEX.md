# Índice e Hierarquia Documental do Lina

Este documento constitui o mapa oficial da documentação do repositório Lina, estabelecido na fase **LINA-DOC-001** (2026-10-01).

---

## 1. Hierarquia de Autoridade

Qualquer decisão técnica ou arquitetural deve respeitar a seguinte hierarquia estrita:

```text
1. AGENTS.md (Governação, regras operacionais permanentes e estado do projeto)
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

> [!IMPORTANT]
> **Branch Oficial:** O branch canónico do repositório é estritamente **`master`** (`origin/master`).
> **Não-Suposição Temporal:** A data mais recente não confere autoridade automática. A autoridade deriva da natureza normativa do documento em conformidade com o código executado e com o `AGENTS.md`.

---

## 2. Catálogo de Documentos Canónicos (Vigência Atual)

Os seguintes documentos contêm as regras, especificações e contratos atualmente em vigor:

### 2.1 Governação e Produto
- **[AGENTS.md](../AGENTS.md)** — Regras permanentes para agentes de IA, invariantes do projeto e estado detalhado de todas as fases.
- **[README.md](../README.md)** — Visão geral e apresentação pública do plugin Lina.
- **[CHANGELOG.md](../CHANGELOG.md)** — Registo cronológico cumulativo de todas as versões e alterações.
- **[docs/roadmap.md](roadmap.md)** — Roadmap estratégico do produto Lina (0.3.x a 1.0.x).
- **[docs/manual.md](manual.md)** — Manual completo de utilizador (versão atual 0.3.1).
- **[docs/commands.md](commands.md)** — Especificação e regras dos slash commands (`/ask`, `/tags`, `/yaml`).

### 2.2 Arquitetura Normativa (`docs/architecture/`)
- **[docs/architecture/sync-foundations.md](architecture/sync-foundations.md)** — Fundações de sincronização multi-dispositivo e partições de armazenamento (`.lina/` partilhado vs `data.json` local).
- **[docs/architecture/producer-ownership.md](architecture/producer-ownership.md)** — Active Producer Ownership, Monotonic Epoch Fencing, histórico de transições e recuperação.
- **[docs/architecture/device-identity.md](architecture/device-identity.md)** — Identidade persistente de dispositivo (UUID v4) via APIs oficiais do Obsidian.
- **[docs/architecture/device-roles.md](architecture/device-roles.md)** — Modelo canónico de papéis (`Producer`, `Companion`, `Unassigned`) e ciclo de vida de atribuição.
- **[docs/architecture/device-scoped-state.md](architecture/device-scoped-state.md)** — Estado isolado por dispositivo em `.lina/devices/<deviceId>.json`.
- **[docs/architecture/exclusion-policy-and-artifact-invalidation.md](architecture/exclusion-policy-and-artifact-invalidation.md)** — Política canónica de exclusões em `.lina/exclusions.json` e regras de invalidação/purga.
- **[docs/architecture/embedding-compatibility-and-provenance.md](architecture/embedding-compatibility-and-provenance.md)** — Especificação do `VectorContractV1`, herança no Companion e proveniência de artefactos.
- **[docs/architecture/secrets-and-obsidian-storage.md](architecture/secrets-and-obsidian-storage.md)** — Fronteira de segurança de credenciais em `app.secretStorage` OS-level.
- **[docs/architecture/companion-delta-search-foundation.md](architecture/companion-delta-search-foundation.md)** — Pesquisa local delta em memória no Companion com garantias estritas read-only.
- **[docs/architecture/LINA-14-WRITE-PATH-DECISIONS-001.md](architecture/LINA-14-WRITE-PATH-DECISIONS-001.md)** — Decisões operacionais do Write Path derivadas de `EmbeddingLifecycleSnapshot`.
- **[docs/architecture/LINA-14-EMBEDDING-LIFECYCLE-BASELINE-001.md](architecture/LINA-14-EMBEDDING-LIFECYCLE-BASELINE-001.md)** — Baseline pura do ciclo de vida de embeddings (ver adenda contextual LINA-15).

---

## 3. Subsistema de Embeddings: Estado e Roadmap LINA-15

O subsistema de embeddings encontra-se formalizado na **Baseline LINA-14** complementada pelas resoluções da iniciativa **LINA-15** (`docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md` §30):

> [!NOTE]
> **Modelo Canónico vs Dívida Técnica em Runtime:** O `EmbeddingLifecycleSnapshot` é o modelo canónico de representação do ciclo de vida de embeddings e a base normativa das decisões operacionais (`deriveEmbeddingWritePathDecision()`). A eliminação física de produtores e sintetizadores paralelos de snapshots em runtime constitui dívida técnica identificada em tratamento na fase **LINA-15D**.

| Fase | Título / Âmbito | Estado | Ficheiro de Referência |
|---|---|---|---|
| **LINA-15A** | Ownership Fencing & Epoch Hardening | **CONCLUÍDA** (commit `0d9580d`) | `docs/audits/architecture/LINA-15A-IMPLEMENT-OWNERSHIP-FENCING-001.md` |
| **LINA-15B** | Reconciliação Plano ↔ Lifecycle | **ABERTA / PRÓXIMA FASE** | Finding F-03 na auditoria global pós-LINA-14 |
| **LINA-15C** | Estado de Escrita para Canónicos Grandes | ABERTA | Finding F-04 na auditoria global pós-LINA-14 |
| **LINA-15D** | Fonte Única de Snapshot & Remoção de Sintetizadores | ABERTA | Findings F-06, F-07 na auditoria global pós-LINA-14 |
| **LINA-15E** | Sidebar UI & Limpeza de Código Morto | ABERTA | Findings F-05, F-20, F-21, F-25 na auditoria global pós-LINA-14 |
| **LINA-15F** | Persistência, Recuperação e Validação | ABERTA | Findings F-08, F-09, F-10 na auditoria global pós-LINA-14 |
| **LINA-15G** | Custo/Privacidade e Limpeza de Settings | ABERTA | Findings F-11, F-12, F-15, F-22 na auditoria global pós-LINA-14 |
| **LINA-15H** | Arranque Leve e Otimização de Performance | ABERTA | Finding F-13 na auditoria global pós-LINA-14 |
| **LINA-15I** | Cobertura de Testes e Reconciliação Documental | ABERTA | Findings F-24, D1–D12 na auditoria global pós-LINA-14 |

---

## 4. Arquivo de Documentação Histórica e Obsoleta (`docs/arquivo/`)

Toda a documentação histórica, análises pré-transição, rascunhos superseded e notas de lançamento antigas foram fisicamente reorganizados em **`docs/arquivo/`** (fase **LINA-DOC-002**).

> [!CAUTION]
> **Documentação Não-Vigente:** Os documentos arquivados têm valor estritamente histórico e de rastreabilidade. **Não devem ser interpretados nem utilizados como especificação técnica vigente por nenhum agente.** A documentação normativa e canónica reside exclusivamente em `AGENTS.md` e `docs/architecture/`.

### 4.1 Estrutura do Arquivo
- **`docs/arquivo/architecture/`** (16 ficheiros): Análises da série 0.2.x (`lina-0.2-*.md`), rascunhos iniciais de capacidade e identidade (`device-capabilities.md`, `device-identity-and-roles.md`), auditorias de storage/settings (`storage-audit.md`, `settings-information-architecture.md`), desenhos de políticas superseded (`embedding-policy-foundation.md`, `embedding-worker.md`, `maintenance-engine.md`) e verificações preliminares de capability (`lina-openrouter-embedding-capability-verification.md`).
- **`docs/arquivo/agents/`** (7 ficheiros): Guias de desenvolvimento iniciais em português (`ia-providers.md`, `indexacao-pesquisa.md`, `mobile.md`, `obsidian-plugin.md`, `relatorio-final.md`, `seguranca-notas.md`, `ui-ux.md`), cujo conteúdo se encontra integralmente consolidado em `AGENTS.md`.
- **`docs/arquivo/releases/`** (3 ficheiros): Notas públicas de versões passadas (`release-0.1.10.md`, `release-0.3.0.md`, `release-0.3.1.md`).
- **`docs/arquivo/`** (raiz do arquivo): `release-notes.md` (0.2.1), `Lina-0.2.x-Roadmap.md`, `README-pt.md` e `manual-alfa.md` (stubs descontinuados em PT), `roadmap-0.2.x` e checklists efêmeras de progresso (`task-progress-*.md`).


---

## 5. Estrutura do Diretório `docs/audits/`

O diretório `docs/audits/` contém os relatórios formais e registos de implementação de todas as iniciativas de engenharia executadas no repositório:
- `docs/audits/architecture/` — Auditorias arquiteturais (LINA-00 a LINA-15A, Git e Auditoria Global Pós-LINA-14).
- `docs/audits/release/` — Auditorias de conformidade e registos de publicação de release.
- `docs/audits/sync/` — Auditorias de fronteira de ficheiros de sincronização.
- `docs/audits/ux/` — Auditorias de interfaces de utilizador e definições.
- `docs/audits/documentation/` — Auditorias de nomenclatura documental.
