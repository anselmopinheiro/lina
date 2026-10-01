# Relatório de Auditoria e Arquivo: LINA-DOC-002

**Identificador:** `LINA-DOC-002-AUDIT-ARCHIVE-MOVE-001`
**Data:** 2026-10-01
**Autor:** Engenheiro de Arquitetura e Governação Lina
**Âmbito:** Reorganização física da documentação histórica, pré-transição e obsoleta para a área dedicada `docs/arquivo/`, preservação do histórico Git (`git mv`), atualização do índice canónico e blindagem contra interpretação de especificações antigas por agentes futuros.
**Estado:** **CONCLUÍDA**

---

## 1. Documentos Analisados

Foram submetidos a análise detalhada todos os documentos classificados na auditoria **LINA-DOC-001** como históricos, análises de transição, rascunhos superseded ou notas de versão passadas:

1. **Documentação de Arquitetura e Análise (`docs/architecture/`):**
   - `docs/architecture/embedding-policy-foundation.md`
   - `docs/architecture/embedding-worker.md`
   - `docs/architecture/maintenance-engine.md`
   - `docs/architecture/device-identity.md`
   - `docs/architecture/device-roles.md`
   - `docs/architecture/device-capabilities.md`
   - `docs/architecture/device-identity-and-roles.md`
   - `docs/architecture/storage-audit.md`
   - `docs/architecture/settings-information-architecture.md`
   - `docs/architecture/lina-0.2-automatic-maintenance-analysis.md`
   - `docs/architecture/lina-0.2-capability-enforcement-analysis.md`
   - `docs/architecture/lina-0.2-capability-model-analysis.md`
   - `docs/architecture/lina-0.2-embedding-worker-analysis.md`
   - `docs/architecture/lina-0.2-embedding-worker-boundary-assessment.md`
   - `docs/architecture/lina-0.2-maintenance-engine-analysis.md`
   - `docs/architecture/lina-0.2-maintenance-flow-migration-analysis.md`
   - `docs/architecture/lina-0.2-pre-transition-analysis.md`
   - `docs/architecture/lina-openrouter-embedding-capability-verification.md`

2. **Guias de Agentes Iniciais (`docs/agents/`):**
   - `docs/agents/ia-providers.md`
   - `docs/agents/indexacao-pesquisa.md`
   - `docs/agents/mobile.md`
   - `docs/agents/obsidian-plugin.md`
   - `docs/agents/relatorio-final.md`
   - `docs/agents/seguranca-notas.md`
   - `docs/agents/ui-ux.md`

3. **Roadmaps, Manuais e Notas de Versão em `docs/` e Raiz:**
   - `docs/Lina-0.2.x-Roadmap.md`
   - `docs/roadmap-0.2.x`
   - `docs/manual-alfa.md`
   - `README-pt.md`
   - `release-notes.md`
   - `docs/release-0.1.10.md`
   - `docs/release-0.3.0.md`
   - `docs/release-0.3.1.md`
   - `task-progress.md` (raiz)
   - `docs/task-progress.md`

---

## 2. Documentos Movidos para `docs/arquivo/`

Todos os movimentos foram executados através de `git mv`, preservando integralmente o histórico de commits do repositório.

| Origem | Destino (`docs/arquivo/`) | Motivo do Arquivo | Sucessor / Documentação Vigente |
|---|---|---|---|
| `docs/architecture/embedding-policy-foundation.md` | `docs/arquivo/architecture/embedding-policy-foundation.md` | Desenho da política 0.2.2 com modos Full/Quick/Incremental superseded pelo modelo puro LINA-14 | `src/index/embeddingLifecycleModel.ts` e `docs/architecture/LINA-14-EMBEDDING-LIFECYCLE-BASELINE-001.md` |
| `docs/architecture/embedding-worker.md` | `docs/arquivo/architecture/embedding-worker.md` | Análise 0.2.2 de worker e MaintenanceEngine superseded pela arquitetura single-flight | `docs/architecture/LINA-14-WRITE-PATH-DECISIONS-001.md` e `producer-ownership.md` |
| `docs/architecture/maintenance-engine.md` | `docs/arquivo/architecture/maintenance-engine.md` | Orquestrador de manutenção 0.2.2 superseded pelo modelo factual | `docs/architecture/LINA-14-WRITE-PATH-DECISIONS-001.md` |
| `docs/architecture/device-capabilities.md` | `docs/arquivo/architecture/device-capabilities.md` | Rascunho inicial de capabilities acoplado ao MaintenanceEngine 0.2 | `docs/architecture/device-roles.md` e `src/capabilities/deviceCapabilities.ts` |
| `docs/architecture/device-identity-and-roles.md` | `docs/arquivo/architecture/device-identity-and-roles.md` | Auditoria exploratória pré-implementação de agosto de 2026 | `docs/architecture/device-identity.md` e `device-roles.md` |
| `docs/architecture/storage-audit.md` | `docs/arquivo/architecture/storage-audit.md` | Auditoria histórica de persistência da fase 0.2 | `docs/architecture/sync-foundations.md` e `device-scoped-state.md` |
| `docs/architecture/settings-information-architecture.md` | `docs/arquivo/architecture/settings-information-architecture.md` | Auditoria histórica de reorganização de settings 0.2.3 | `docs/manual.md` e `src/settings/` |
| `docs/architecture/lina-0.2-automatic-maintenance-analysis.md` | `docs/arquivo/architecture/lina-0.2-automatic-maintenance-analysis.md` | Análise técnica pré-transição da série 0.2.x | `docs/architecture/LINA-14-WRITE-PATH-DECISIONS-001.md` |
| `docs/architecture/lina-0.2-capability-enforcement-analysis.md` | `docs/arquivo/architecture/lina-0.2-capability-enforcement-analysis.md` | Análise técnica pré-transição da série 0.2.x | `docs/architecture/device-roles.md` |
| `docs/architecture/lina-0.2-capability-model-analysis.md` | `docs/arquivo/architecture/lina-0.2-capability-model-analysis.md` | Análise técnica pré-transição da série 0.2.x | `docs/architecture/device-roles.md` |
| `docs/architecture/lina-0.2-embedding-worker-analysis.md` | `docs/arquivo/architecture/lina-0.2-embedding-worker-analysis.md` | Análise técnica pré-transição da série 0.2.x | `docs/architecture/LINA-14-WRITE-PATH-DECISIONS-001.md` |
| `docs/architecture/lina-0.2-embedding-worker-boundary-assessment.md` | `docs/arquivo/architecture/lina-0.2-embedding-worker-boundary-assessment.md` | Análise técnica pré-transição da série 0.2.x | `docs/architecture/LINA-14-WRITE-PATH-DECISIONS-001.md` |
| `docs/architecture/lina-0.2-maintenance-engine-analysis.md` | `docs/arquivo/architecture/lina-0.2-maintenance-engine-analysis.md` | Análise técnica pré-transição da série 0.2.x | `docs/architecture/LINA-14-WRITE-PATH-DECISIONS-001.md` |
| `docs/architecture/lina-0.2-maintenance-flow-migration-analysis.md` | `docs/arquivo/architecture/lina-0.2-maintenance-flow-migration-analysis.md` | Análise técnica pré-transição da série 0.2.x | `docs/architecture/LINA-14-WRITE-PATH-DECISIONS-001.md` |
| `docs/architecture/lina-0.2-pre-transition-analysis.md` | `docs/arquivo/architecture/lina-0.2-pre-transition-analysis.md` | Análise técnica pré-transição da série 0.2.x | `docs/architecture/sync-foundations.md` e `producer-ownership.md` |
| `docs/architecture/lina-openrouter-embedding-capability-verification.md` | `docs/arquivo/architecture/lina-openrouter-embedding-capability-verification.md` | Auditoria de capability pré-implementação resolvida na Fase 2.2D | `src/ai/openRouterProvider.ts` |
| `docs/agents/ia-providers.md` | `docs/arquivo/agents/ia-providers.md` | Guia inicial de agentes consolidado | `AGENTS.md` |
| `docs/agents/indexacao-pesquisa.md` | `docs/arquivo/agents/indexacao-pesquisa.md` | Guia inicial de agentes consolidado | `AGENTS.md` |
| `docs/agents/mobile.md` | `docs/arquivo/agents/mobile.md` | Guia inicial de agentes consolidado | `AGENTS.md` |
| `docs/agents/obsidian-plugin.md` | `docs/arquivo/agents/obsidian-plugin.md` | Guia inicial de agentes consolidado | `AGENTS.md` |
| `docs/agents/relatorio-final.md` | `docs/arquivo/agents/relatorio-final.md` | Formato de relatório de agentes preservado como referência documental | `AGENTS.md` e `docs/arquivo/agents/relatorio-final.md` |
| `docs/agents/seguranca-notas.md` | `docs/arquivo/agents/seguranca-notas.md` | Guia inicial de agentes consolidado | `AGENTS.md` |
| `docs/agents/ui-ux.md` | `docs/arquivo/agents/ui-ux.md` | Guia inicial de agentes consolidado | `AGENTS.md` |
| `release-notes.md` | `docs/arquivo/release-notes.md` | Notas de lançamento da versão 0.2.1 | `CHANGELOG.md` |
| `docs/release-0.1.10.md` | `docs/arquivo/releases/release-0.1.10.md` | Notas de lançamento da versão 0.1.10 | `CHANGELOG.md` |
| `docs/release-0.3.0.md` | `docs/arquivo/releases/release-0.3.0.md` | Notas de lançamento da versão 0.3.0 | `CHANGELOG.md` |
| `docs/release-0.3.1.md` | `docs/arquivo/releases/release-0.3.1.md` | Notas de lançamento da versão 0.3.1 | `CHANGELOG.md` |
| `docs/Lina-0.2.x-Roadmap.md` | `docs/arquivo/Lina-0.2.x-Roadmap.md` | Roadmap da série 0.2.x superseded | `docs/roadmap.md` |
| `docs/roadmap-0.2.x` | `docs/arquivo/roadmap-0.2.x` | Ficheiro vazio residual | `docs/roadmap.md` |
| `README-pt.md` | `docs/arquivo/README-pt.md` | Stub descontinuado da documentação em português | `README.md` |
| `docs/manual-alfa.md` | `docs/arquivo/manual-alfa.md` | Stub descontinuado do manual em português | `docs/manual.md` |
| `task-progress.md` (raiz) | `docs/arquivo/task-progress-root.md` | Checklist efêmera de fase passada | N/A (histórico operacional) |
| `docs/task-progress.md` | `docs/arquivo/task-progress-docs.md` | Checklist efêmera de fase passada | N/A (histórico operacional) |

---

## 3. Documentos Mantidos nas Áreas Ativas

Permanecem rigorosamente nas suas localizações canónicas ativas os documentos que constituem especificação técnica, governança, manual e catálogo normativo vigente:

1. **Raiz do Repositório:**
   - `AGENTS.md` — Governação suprema, regras para agentes e histórico cumulativo de fases.
   - `README.md` — Apresentação canónica internacional do produto em inglês.
   - `CHANGELOG.md` — Histórico cumulativo de versões do produto.
   - `LICENSE.md` — Licença MIT.
   - `manifest.json`, `package.json`, `tsconfig.json`, etc. — Metadados de projeto.

2. **Documentação de Utilizador e Contratos em `docs/`:**
   - `docs/INDEX.md` — Mapa oficial da hierarquia e catálogo documental.
   - `docs/roadmap.md` — Roadmap estratégico ativo do produto Lina (0.3.x a 1.0.x).
   - `docs/manual.md` — Manual completo de utilizador em inglês internacional.
   - `docs/commands.md` — Especificação canónica dos slash commands.

3. **Arquitetura Normativa em `docs/architecture/` (11 especificações ativas):**
   - `sync-foundations.md`
   - `producer-ownership.md`
   - `device-identity.md`
   - `device-roles.md`
   - `device-scoped-state.md`
   - `exclusion-policy-and-artifact-invalidation.md`
   - `embedding-compatibility-and-provenance.md`
   - `secrets-and-obsidian-storage.md`
   - `companion-delta-search-foundation.md`
   - `LINA-14-WRITE-PATH-DECISIONS-001.md`
   - `LINA-14-EMBEDDING-LIFECYCLE-BASELINE-001.md`

4. **Auditorias Formais em `docs/audits/`:**
   - Todos os relatórios de engenharia em `docs/audits/architecture/`, `docs/audits/release/`, `docs/audits/sync/`, `docs/audits/ux/` e `docs/audits/documentation/` permanecem nos seus locais originais como registos factuais datados e imutáveis.

---

## 4. Referências Atualizadas

Os seguintes documentos ativos foram ajustados para refletir a nova estrutura e preservar a validade dos links:

1. **`docs/INDEX.md`**:
   - Atualizado o catálogo da secção 2.2 (`docs/architecture/`) para apontar para `device-identity.md` e `device-roles.md`.
   - Adicionada a nova secção **`4. Arquivo de Documentação Histórica e Obsoleta (docs/arquivo/)`** com aviso explícito de não-vigência técnica e detalhe das subpastas `architecture/`, `agents/`, `releases/` e raiz do arquivo.

2. **`AGENTS.md`**:
   - Atualizada a referência ao formato do relatório final para `docs/arquivo/agents/relatorio-final.md`.
   - Adicionada a regra permanente para agentes:
     > **Documentação Arquivada:** Documentos em `docs/arquivo/` têm caráter estritamente histórico e não devem ser utilizados como especificação técnica vigente sem confirmação explícita. A especificação canónica ativa reside exclusivamente em `AGENTS.md` e `docs/architecture/` (consultar `docs/INDEX.md`).

---

## 5. Documentos Ambíguos

Durante a auditoria e reorganização física, **não foi identificado nenhum caso de documento ambíguo**. A totalidade dos 33 ficheiros movidos possuía obsolescência técnica comprovada, consolidação prévia em documentos normativos vigentes ou estatuto puramente histórico/descontinuado.

---

## 6. Resultado da Fase LINA-DOC-002

1. **Separação Física Concluída:** A pasta `docs/arquivo/` contém exclusivamente documentação histórica, análises pré-transição e notas antigas.
2. **Área de Arquitetura Limpa:** A pasta `docs/architecture/` contém exatamente 11 especificações normativas canónicas, sem misturas de rascunhos superseded ou análises 0.2.x.
3. **Preservação de Histórico Git:** Todos os ficheiros foram movidos via `git mv`, preservando a rastreabilidade integral.
4. **Governança Blindada:** `AGENTS.md` e `docs/INDEX.md` estabelecem formalmente que nenhum documento arquivado constitui especificação vigente.
5. **Readiness para LINA-15B:** A base documental do repositório Lina encontra-se totalmente auditada, consolidada e limpa para o arranque da fase **LINA-15B (Reconciliação Plano ↔ Lifecycle)**.
