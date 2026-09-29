# LINA-00-AUDIT-PROJECT-RULES-001 — Auditoria das Regras de Projeto e Governação

**Data:** 28 de Setembro de 2026
**Autor:** Arquiteto de Software Sénior
**Âmbito:** Auditoria técnica de todas as regras, documentação e decisões de governação do projeto Lina para consolidação e atualização da `PROMPT-MESTRA-LINA-001`.
**Classificação adotada:** `ATUAL`, `HISTÓRICA`, `DESATUALIZADA`, `DÚVIDA`.

---

# 1. Documentos Analisados

A auditoria cobriu a totalidade dos ficheiros normativos e documentais do repositório:

1. **Documento Mestre de Governação:**
   - `AGENTS.md` (raiz do repositório, 1034 linhas).
2. **Documentação Pública e Manuais:**
   - `README.md` (documentação pública principal em inglês internacional — `ATUAL`).
   - `README-pt.md` (documentação pública legada em português — `DESATUALIZADA` / `HISTÓRICA`).
   - `docs/manual.md` (manual oficial do utilizador — `ATUAL`).
   - `docs/manual-alfa.md` (manual alfa legado em português — `DESATUALIZADA` / `HISTÓRICA`).
   - `docs/commands.md` (guia oficial de comandos do plugin — `ATUAL`).
   - `CHANGELOG.md` (registo histórico e detalhado de todas as versões — `ATUAL`).
   - `docs/roadmap.md` e `docs/Lina-0.2.x-Roadmap.md` (roteiro estratégico de desenvolvimento — `ATUAL`).
   - `docs/release-0.3.1.md`, `docs/release-0.3.0.md`, `docs/release-0.1.10.md` (notas públicas de release — `ATUAL`).
3. **Guias e Instruções de Agente (`docs/agents/`):**
   - `docs/agents/relatorio-final.md` (formato canónico de reporte após tarefas — `ATUAL`).
   - `docs/agents/mobile.md` (requisitos de neutralidade de plataforma e compatibilidade mobile — `ATUAL`).
   - `docs/agents/obsidian-plugin.md` (boas práticas da API do Obsidian — `ATUAL`).
   - `docs/agents/seguranca-notas.md` (regra de ouro de inviolabilidade das notas do vault — `ATUAL`).
   - `docs/agents/indexacao-pesquisa.md` (invariantes de chunking, indexação e pesquisa — `ATUAL`).
   - `docs/agents/ia-providers.md` (regras e limitações para providers de IA — `ATUAL`).
   - `docs/agents/ui-ux.md` (normas de interface e usabilidade — `ATUAL`).
4. **Especificações de Arquitetura (`docs/architecture/`):**
   - `producer-ownership.md` (modelo Single-Active-Producer, epochs monotónicos, gates — `ATUAL`).
   - `sync-foundations.md` (partição de 8 tiers de storage, independência de sync — `ATUAL`).
   - `exclusion-policy-and-artifact-invalidation.md` (governação de exclusões canónicas `.lina/exclusions.json` — `ATUAL`).
   - `embedding-compatibility-and-provenance.md` (VectorContractV1, herança de contrato pelo Companion — `ATUAL`).
   - `embedding-policy-foundation.md` (política de execução, gating e custos de embedding — `ATUAL`).
   - `settings-information-architecture.md` (arquitetura de Native Settings Pages `SettingDefinitionPage` — `ATUAL`).
   - `secrets-and-obsidian-storage.md` (eliminação de plaintext e migração para `app.secretStorage` — `ATUAL`).
   - `companion-delta-search-foundation.md` (fundação de pesquisa delta e cache temporário — `ATUAL` / `SUGESTÃO FUTURA`).
   - `device-identity-and-roles.md`, `device-capabilities.md`, `device-scoped-state.md` (identidade e papéis — `ATUAL`).
5. **Relatórios Técnicos e Auditorias Prévias (`docs/audits/`):**
   - Arquitetura: `LINA-03-AUDIT-PRODUCER-BOOTSTRAP-001.md`, `LINA-03-FIX-PRODUCER-BOOTSTRAP-001.md`, `LINA-03-AUDIT-EMBEDDING-STATE-SEPARATION-001.md`, `LINA-03-IMPLEMENT-LOCAL-SYNC-STORAGE-BOUNDARY-001.md`.
   - Release: `LINA-03-RELEASE-BOOTSTRAP-FIX-001.md`, `LINA-03-RELEASE-PUBLISH-001.md`, `LINA-04-RELEASE-PREP-001.md`, `LINA-04-RELEASE-PUBLISH-001.md`, `LINA-04-OBSIDIAN-RELEASE-COMPLIANCE-001.md`.
   - UX: `LINA-04-AUDIT-SETTINGS-UX-BOUNDARIES-001.md`, `LINA-04-IMPLEMENT-SETTINGS-PAGES-001.md`.
   - Sincronização: `LINA-03-AUDIT-SYNC-TEMP-ARTIFACTS-001.md`, `LINA-03-IMPLEMENT-SYNC-ARTIFACT-BOUNDARY-001.md`.
6. **Infraestrutura e Scripts de Release:**
   - `.github/workflows/ci.yml` (pipeline de CI e release com atestações `attest-build-provenance` — `ATUAL`).
   - `scripts/release-check.js` (validador estrutural pré-release — `ATUAL`).
   - `scripts/bump-version.js` (script de versionamento semver — `ATUAL`).
   - `package.json`, `package-lock.json`, `manifest.json`, `versions.json` (`ATUAL`).

---

# 2. AGENTS.md

O `AGENTS.md` é o ficheiro central de diretrizes para inteligências artificiais e desenvolvedores no Lina.

## Âmbito de Aplicação
Aplica-se obrigatoriamente a qualquer interação de desenvolvimento, manutenção, refatoração, auditoria ou lançamento de versões no projeto Lina.

## Regras Obrigatórias Extraídas
1. **Diretório Canónico Obrigatório:**
   - O desenvolvimento deve ocorrer exclusivamente em `D:\_dev\obsidian\lina` (ou `D:/_dev/obsidian/lina`).
   - Antes de iniciar qualquer trabalho técnico, é obrigatório verificar o root do Git (`git rev-parse --show-toplevel`). Se for diferente, a execução deve **PARAR**.
2. **Inviolabilidade das Notas do Vault (Regra de Ouro):**
   - Proibição estrita de alterar, criar ou apagar notas Markdown no vault sem autorização explícita e confirmação rigorosa do utilizador.
   - Indexação, geração de embeddings, verificação de sincronização e diagnósticos são operações de **leitura** que nunca alteram notas.
   - Slash commands (`/ask`, `/tags`, `/yaml`) requerem pré-visualização e confirmação antes de gravar no ficheiro da nota.
3. **Limitação de Exploração:**
   - Proibição de varrer todo o projeto de uma só vez. A análise deve restringir-se estritamente aos ficheiros relevantes para a tarefa.
4. **Identificação do Domínio da Tarefa:**
   - Identificar explicitamente o domínio antes de codificar: Indexação, Embeddings, Pesquisa, Provider de IA, UI, Segurança de Notas ou Documentação.
5. **Restrições de Armazenamento e APIs Web:**
   - Proibido o uso de `localStorage`, `sessionStorage` e `globalThis`.
   - Configurações do plugin devem usar a API oficial `loadData()` / `saveData()`.
   - Credenciais e chaves API devem residir exclusivamente em `app.secretStorage`.
6. **Neutralidade de Plataforma e Compatibilidade Mobile:**
   - `manifest.json` deve manter `isDesktopOnly: false`.
   - Proibição de dependências de Node.js desktop (`fs`, `path`, `child_process`, `os`, `crypto` direto).
   - Uso de abstrações do Obsidian (`app.vault.adapter`, `requestUrl`, etc.).
   - Nunca assumir que a pasta de configuração do vault se chama `.obsidian` em código runtime; utilizar sempre `app.vault.configDir`.
7. **Regras de Qualidade e TypeScript:**
   - Proibição de floating promises (todas devem ter `await`, `.catch()` ou `void`).
   - Narrowing explícito em blocos `catch` (sem `any` desnecessário).
   - `npm test`, `npm run typecheck`, `npm run lint:obsidian:strict`, `npm run build`, `npm run release-check` e `git diff --check` devem passar sem erros nem warnings adicionais.

## Prioridades Estabelecidas
1. **Segurança e Privacidade do Vault:** Dados do utilizador permanecem invioláveis; premissa local-first; chamadas externas dependem de ação e consentimento explícitos.
2. **Consistência Distribuída e Anti-Corrupção:** Garantir single-active publisher, ausência de split-brain e compatibilidade matemática de vetores.
3. **Robustez Operacional:** Bootstrap idempotente, tratamento fail-fast e neutralização de race conditions em ambientes multi-dispositivo.
4. **Ergonomia e Simplicidade:** UX limpa, orientada ao utilizador, com navegação por páginas nativas no Obsidian.

## Conflitos Internos Detetados no AGENTS.md
- **Conflito de Branch Git:** O texto do AGENTS.md refere `master` (`Preferir merge para master antes de criar a tag`, `git push origin master`), enquanto outras orientações externas referem `main por defeito`. O repositório real é `master`.
- **Conflito de Fase de Settings:** As linhas 371 a 450 do AGENTS.md mantêm secções detalhadas da Fase 9N descrevendo o estado pré-cutover (onde `display()` imperativo era o caminho ativo e a composição declarativa era candidata desanexada). No entanto, o histórico subsequente (linhas 69 a 85) e o estado do código comprovam que o cutover foi realizado e as Settings agora usam a API declarativa e Native Pages.

---

# 3. Regras Oficiais do Projeto

As regras vigentes do projeto Lina são classificadas detalhadamente nas categorias abaixo:

```text
Classificação:
[ATUAL]         -> Decisão e regra técnica atualmente válida e em vigor.
[HISTÓRICA]     -> Contexto de versões anteriores que não se aplica ao código atual.
[DESATUALIZADA] -> Documentação ou texto que contradiz o estado atual do repositório.
[DÚVIDA]        -> Sugestão futura ou hipótese arquitetural ainda não decidida/implementada.
```

## 3.1. Arquitetura Producer / Companion e Ownership

- `[ATUAL]` **Modelo de Dois Papéis:** Dispositivos são configurados explicitamente como `producer` (geralmente desktop potente) ou `companion` (desktop secundário ou mobile). A plataforma física apenas sugere; o utilizador confirma.
- `[ATUAL]` **Separação Papel vs. Ownership:** `role = "producer"` indica capacidade operacional; a autoridade de publicação de índices e vetores partilhados pertence exclusivamente ao dispositivo com `activeProducerId` em `.lina/ownership.json`.
- `[ATUAL]` **Epoch Fencing Monotónico:** Epochs em `.lina/ownership.json` e `.lina/ownership-history/` são estritamente crescentes ($E \to E + 1$) e geram logs imutáveis de transição.
- `[ATUAL]` **Despromoção Segura (Relinquish):** Ao despromover um Active Producer para Companion, a autoridade é revogada (`activeProducerId: null` a epoch $E + 1$), workers são interrompidos de imediato e o papel é gravado posteriormente, impedindo estados inválidos.
- `[ATUAL]` **Companion Passivo em Background:** Companions consomem índices publicados sincronizados e nunca executam geração automática pesada em background nem publicam para `.lina/index/`.

## 3.2. Sincronização e Partição de Armazenamento

- `[ATUAL]` **Zero-Configuration Correctness e Independência de Sync:** O Lina funciona de forma correta e sem corrupção sob qualquer motor de sincronização (Obsidian Sync, Syncthing, iCloud, Nextcloud, Git, Dropbox, etc.), tratando a sincronização como transporte assíncrono e não como autoridade.
- `[ATUAL]` **Partição de Armazenamento em 8 Tiers:**
  1. *Device Identity:* UUID v4 local em `app.loadLocalStorage` (nunca sincronizado).
  2. *Device-Scoped State:* `.lina/devices/<deviceId>.json` (single-writer por dispositivo).
  3. *Global Ownership:* `.lina/ownership.json` e `.lina/ownership-history/` (autoridade do Produtor Ativo).
  4. *Exclusion Policy:* `.lina/exclusions.json` (`schemaVersion: 1`, autoridade exclusiva do Produtor Ativo).
  5. *Producer State:* `.lina/producer-state.json` (`ProducerStateV1`, telemetria observacional de frescura).
  6. *Published Artifacts:* `.lina/index/*` (artefactos canónicos: `manifest.json`, `notes.json`, `chunks.jsonl`, `embeddings.jsonl`, `embeddings.vectors.f32`).
  7. *Device-Local Secrets:* `app.secretStorage` (chaves API locais, nunca sincronizadas nem escritas em ficheiros de vault).
  8. *Local Device Settings:* `.obsidian/plugins/lina/data.json` (`settingsSchemaVersion: 1`, preferências locais da instalação).
- `[ATUAL]` **Separação `.lina/index/` vs. `.lina/producer/`:**
  - `.lina/index/` contém estritamente artefactos canónicos publicados e sincronizáveis para consumo pelos Companions.
  - `.lina/producer/` é a área operacional exclusiva do Produtor (contendo `staging/`, `checkpoints/`, `backups/`). Ficheiros operacionais não são consumidos por Companions e devem ser excluídos de sincronização externa sempre que configurável.
- `[ATUAL]` **Bootstrap Idempotente do Producer:** Todas as diretorias operacionais de `.lina/producer/` são garantidas recursiva e idempotentemente antes de qualquer escrita, prevenindo falhas de `ENOENT`.
- `[HISTÓRICA]` Checkpoints e temporários residiam anteriormente dentro de `.lina/index/`. Essa abordagem foi descontinuada na versão 0.3.0.
- `[DÚVIDA / SUGESTÃO FUTURA]` Migração da área operacional do Producer para um futuro `DeviceLocalStore` fora do vault. Permanece não implementada.

## 3.3. Embeddings e Contrato Vetorial

- `[ATUAL]` **VectorContractV1:** Definido formalmente em `.lina/index/manifest.json`. Companions herdam obrigatoriamente `provider`, `model`, `dimensions`, `metric` e `prefixMode`.
- `[ATUAL]` **Zero Silent Fallback:** Se o provider/modelo herdado estiver inacessível no Companion, a pesquisa semântica é suspensa com aviso informativo e a pesquisa híbrida degrada de forma transparente para pesquisa textual local. É proibido recorrer silenciosamente a modelos incompatíveis.
- `[ATUAL]` **Desacoplamento de Motores de IA:** O provider de embeddings (pesquisa semântica) é totalmente independente do provider de análise de notas (`/ask`, `/tags`, `/yaml`).
- `[ATUAL]` **Apenas 3 Providers Oficiais Suportados:** `Ollama` (local), `Mistral` (remoto) e `OpenRouter` (remoto). OpenAI, Gemini, Anthropic e Custom foram descontinuados do suporte ativo e permanecem apenas como normalização legada de leitura.
- `[ATUAL]` **Dual-Read com Cache Binário:** O formato JSONL (`embeddings.jsonl`) é sempre a fonte canónica de verdade. A cópia binária (`embeddings.vectors.f32`) é uma aceleração de leitura derivada e opcional. Se a cópia binária estiver ausente ou dessincronizada, o sistema recorre de forma segura ao JSONL.
- `[SUGESTÃO FUTURA]` Cache temporário de embeddings no Companion (armazenamento persistente local fora do vault para notas criadas/editadas no Companion antes da indexação pelo Produtor — previsto para 0.4.x).

## 3.4. Governação de Exclusões e Invalidação

- `[ATUAL]` **Canonical Exclusion Policy (`.lina/exclusions.json`):** Gerida com `policyRevision` e `policyHash`. Apenas o Produtor Ativo tem autoridade para alterar exclusões de pastas, caminhos e conteúdos.
- `[ATUAL]` **Filtragem Defensiva em Tempo de Query:** O Companion avalia as regras de exclusão ativas no momento da consulta sobre todos os modos de pesquisa, prevenindo fugas de dados mesmo durante janelas de sincronização parcial.
- `[ATUAL]` **Purga Não Destrutiva:** Ao aumentar as restrições de exclusão, notas e embeddings são purgados dos índices do Lina sem nunca alterar ou apagar as notas markdown originais.

## 3.5. Settings e Interface de Utilizador

- `[ATUAL]` **Native Settings Pages (`SettingDefinitionPage`):** A interface de definições usa a navegação nativa do Obsidian com 8 páginas funcionais:
  1. *Geral / General*
  2. *Pesquisa / Search*
  3. *Assistente de IA e Análise / AI Assistant & Analysis*
  4. *Produtor / Producer* (condicional ao papel)
  5. *Companion* (condicional ao papel)
  6. *Sincronização / Synchronization*
  7. *Diagnóstico / Diagnostics*
  8. *Avançado / Advanced*
  + Rodapé fixo de suporte e contacto.
- `[ATUAL]` **Implementação Declarativa:** A settings tab é implementada através da API declarativa do Obsidian (`getSettingDefinitions()`, `getControlValue()`, `setControlValue()`, `update()`), com suporte de lifecycle por instância e cancelamento de tarefas assíncronas ao fechar a aba.
- `[ATUAL]` **Proteção de Segredos na UI:** Inputs de chave API aparecem sempre vazios por defeito; valores guardados nunca repovoam o campo visível; ações de guardar e limpar são explícitas; ação de limpar exige confirmação modal destrutiva.
- `[DESATUALIZADA]` Referências a `display()` imperativo ou à coexistência de abas/candidatas declarativas na settings tab são históricas e estão desatualizadas.

## 3.6. Git, Branches e Workflow

- `[ATUAL]` **Branch Principal `master`:** O repositório canónico remoto (`anselmopinheiro/lina`) e local opera estritamente na branch `master` (`remotes/origin/HEAD -> origin/master`).
- `[DESATUALIZADA]` A menção a "main por defeito" na prompt mestra está em contradição com o repositório.
- `[ATUAL]` **Commits por Fases:** Commits atómicos e focados por fase de trabalho, acompanhados de documentação técnica em `docs/audits/`.
- `[ATUAL]` **Tags de Versão:** A tag é criada sobre o commit validado em `master`, exatamente com o nome da versão em `manifest.json` (ex: `0.3.1`), sem prefixo `v`.

## 3.7. Testes e Validação Obrigatória

- `[ATUAL]` **Comandos Canónicos de Validação Pré-Commit / Pré-Release:**
  ```bash
  npm test                      # Vitest em memória (122 ficheiros, 1643 testes)
  npm run typecheck             # Verificação estrita TypeScript (tsc --noEmit)
  npm run lint:obsidian:strict  # Linter oficial Obsidian com zero erros e warnings
  npm run build                 # Build de produção com esbuild gerando main.js
  npm run release-check         # Validação estrutural de ficheiros e atestações CI
  git diff --check              # Verificação de caracteres e whitespace
  ```
- `[ATUAL]` **Gestão de Dependências:** `npm ci` é obrigatório para garantir reprodutibilidade. É proibido executar `npm install` sem decisão explícita de alteração de dependências.

## 3.8. Release e Distribuição

- `[ATUAL]` **Tripla Coerência de Versão:** `package.json`, `package-lock.json`, `manifest.json` e `versions.json` devem coincidir rigorosamente. `README.md` e `docs/manual.md` devem ter os números de versão atualizados.
- `[ATUAL]` **Assets de Release:** Exclusivamente 3 ficheiros:
  - `main.js`
  - `manifest.json`
  - `styles.css`
  Proibido anexar documentação, licença, zips ou ficheiros de teste.
- `[ATUAL]` **Atestações de Proveniência:** O workflow do GitHub Actions gera automaticamente atestações de segurança (`actions/attest-build-provenance@v2`).

---

# 4. Conflitos Encontrados e Decisões Recomendadas

| # | Tópico | Regra Antiga / Divergente | Regra Atual do Repositório | Decisão Recomendada para a Prompt Mestra |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Branch Padrão do Git** | `main por defeito` | `master` é a default branch do repositório remoto e local (`origin/master`). | **Adotar `master`**. Retificar a prompt mestra para declarar formalmente `master` como a branch canónica de trabalho, commits, merges e tags. |
| **2** | **Implementação das Settings** | `PluginSettingTab.display()` imperativo; migração declarativa pendente/bloqueada. | Settings declarativas implementadas em produção via `getSettingDefinitions()` com Native Pages. | **Declarar Settings Declarativas Ativas**. Proibir a reintrodução de renderers imperativos ou tabs paralelas; orientar edições para definitions declarativas e Native Pages. |
| **3** | **Catálogo de Providers de IA** | Suporte previsto a OpenAI, Claude/Anthropic, Gemini, Ollama, OpenRouter e Custom. | Suporte oficial ativo restrito a **Ollama**, **Mistral** e **OpenRouter**. Demais descontinuados no caminho ativo. | **Fixar os 3 Providers Oficiais**. Instruir que qualquer novo provider de IA requer autorização e fase arquitetural própria. |
| **4** | **Armazenamento de Checkpoints e Staging** | Checkpoints e ficheiros temporários colocados em `.lina/index/`. | `.lina/index/` é exclusivo para artefactos publicados. Ficheiros operacionais ficam em `.lina/producer/`. | **Formalizar a Barreira `.lina/producer/`**. Proibir a criação de staging, checkpoints ou backups operacionais dentro de `.lina/index/`. |
| **5** | **Armazenamento de Credenciais** | Chaves API guardadas em `data.json` sob `deviceSettingsById`. | Credenciais residem exclusivamente em `app.secretStorage`. | **Proibir Credenciais em `data.json`**. Assegurar que nenhuma chave API ou token seja escrito no vault ou sincronizado. |
| **6** | **Nomenclatura das Tags de Release** | Algumas referências históricas e tags antigas usavam `v0.3.0`. | A regra oficial do projeto e do Obsidian Community Plugins exige tag sem `v` (ex: `0.3.1`). | **Padronizar Tag Sem `v`**. Reforçar que a tag deve ser estritamente igual à versão do `manifest.json`. |

---

# 5. Atualizações Necessárias na PROMPT-MESTRA-LINA-001

Com base nesta auditoria, a `PROMPT-MESTRA-LINA-001` deve ser atualizada com os seguintes pontos específicos:

1. **Ajuste da Branch Git:**
   - Substituir qualquer menção a `main` por `master`. Confirmar que comandos de validação, push e merge atuam sobre `master`.
2. **Consolidação do Modelo Producer / Companion (0.3.x):**
   - Incluir a regra de Single-Active-Producer com epochs monotónicos em `.lina/ownership.json`.
   - Declarar que apenas o Active Producer pode publicar em `.lina/index/` e que os Companions operam em modo passivo somente-leitura.
3. **Consolidação dos Limites de Storage:**
   - Adicionar explicitamente a separação entre `.lina/index/` (artefactos canónicos sincronizados) e `.lina/producer/` (área operacional local do Producer, nunca sincronizada).
   - Registar a obrigatoriedade do bootstrap idempotente das diretorias do Producer.
4. **Governação de Exclusões e Contrato Vetorial:**
   - Adicionar `.lina/exclusions.json` como autoridade única de exclusões gerenciada pelo Active Producer.
   - Adicionar o conceito de `VectorContractV1` herdado obrigatoriamente pelos Companions a partir do manifesto publicado, com suspensão graciosa e degradação para texto local quando inacessível.
5. **Providers Oficiais:**
   - Restringir explicitamente a lista de providers de IA para: `Ollama`, `Mistral` e `OpenRouter`. Proibir adições silenciosas de outros providers.
6. **Arquitetura de Settings:**
   - Atualizar a secção de UI para refletir as **Native Settings Pages** (8 páginas funcionais via `SettingDefinitionPage`) e a API declarativa `getSettingDefinitions()`, proibindo renderização imperativa `display()`.
7. **Regras de Segurança de Segredos:**
   - Reforçar o uso obrigatório de `app.secretStorage` para credenciais e a proibição absoluta de chaves API em `data.json`.
8. **Lista Canónica de Validação:**
   - Consolidar a sequência de validação: `npm test` -> `npm run typecheck` -> `npm run lint:obsidian:strict` -> `npm run build` -> `npm run release-check` -> `git diff --check`.
