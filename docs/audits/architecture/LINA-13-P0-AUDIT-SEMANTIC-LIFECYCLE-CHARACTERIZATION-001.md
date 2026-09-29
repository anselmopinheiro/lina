# LINA-13-P0-AUDIT-SEMANTIC-LIFECYCLE-CHARACTERIZATION-001

**Tipo:** Auditoria e preparação da implementação (nenhum código, teste, schema ou migration alterado)
**Objetivo:** validar no código as conclusões de LINA-07 a LINA-12B e definir o caminho mínimo seguro para LINA-13-P1
**Estado Git:** `master`, HEAD `f5f840d`

## 0. Método, limites e correções

### 0.1 Leitura obrigatória
Lidas (secções de decisão, cenários, causas e recomendações): `LINA-07`, `LINA-08`, `LINA-09`, `LINA-10` (audits), `LINA-12` e `LINA-12B` (produzidos por esta mesma linha de trabalho). As secções descritivas longas de LINA-07/08/09 (descrição de fluxos e transcrições de código) foram lidas por diagonal; as suas conclusões foram **confrontadas com o código** e não assumidas.

### 0.2 O pedido está truncado
O texto termina em "LINA-14 — Consolidação arquitetural: Possível criação:". Assumi que a pergunta é qual o artefacto a criar; a proposta está em §9.3.

### 0.3 Limites
- **Nenhum teste foi executado e nada foi reproduzido em runtime.** "Reprodutível" significa: cadeia de chamadas lida de ponta a ponta e passos de reprodução definidos (§7). Cada teste de caracterização (§8) tem de ser escrito e corrido para converter "Confirmado no código" em "Reproduzido".
- **Não lido em detalhe:** `embeddingGenerator.ts` (só 975-1050 e referências), `runtimeEmbeddingIndex.ts`, `embeddingPersistence.ts`, `companionDeltaSearch.ts`.

### 0.4 Correções às minhas auditorias anteriores (importante)
| Onde | Afirmação anterior | Correção após leitura de `hybridSearch.ts:496-570` e `linaSearchView.ts:3710-3840` |
|---|---|---|
| LINA-12B §1.4, C8 | "`runHybridSearch` chama `getSemanticSearchAvailability` a fresco (`:558`)" | Só no ramo **legado** (modais, sem `getRuntimeEmbeddingIndex`). A Sidebar passa `getRuntimeEmbeddingIndex` (`linaSearchView.ts:3734, 4071`) e usa o ramo `:524-557`, que **não** chama `getSemanticSearchAvailability`: valida a identidade diretamente sobre o índice runtime (provider, modelo, `inputVersion`, `prefixMode`, dimensão). A divergência entre híbrida e semântica pura **mantém-se**, mas com outra causa (ver §1). |
| LINA-12 F1 | "cache bloqueia a pesquisa semântica pura" | Confirmado, e agora com prova adicional: a pesquisa semântica pura **já faz** a mesma validação de identidade sobre o índice runtime (`:3775-3803`). O *pre-gate* pela cache (`:3755-3759`) é redundante e é a única parte que pode bloquear indevidamente. |
| LINA-12 §4 ponto 8 | — | `Atualizar embeddings` já existe na Sidebar; o problema é de visibilidade/contexto, não de inexistência (§4). |

---

# 1. Read Path — "a pesquisa semântica está disponível?"

## 1.1 Quantas implementações existem?

| # | Implementação | Onde | Critério | Fonte de dados | Frescura | Quem usa |
|---|---|---|---|---|---|---|
| R1 | `DeviceRuntimeState.embeddings` → `evaluateSemanticCapability` | `deviceRuntimeState.ts:230`; cache em `main.ts:303` | conjunção de `semanticCompatibility.available` + contrato + `runtimeState` (sempre `ready`; `isChecking`/`providerReachable` nunca passados) | R2, mais manifestos lidos no refresh | **Cache sem invalidação** | Sidebar (estado e alertas), pre-gate da pesquisa semântica pura, Definições (só papel), diagnóstico |
| R2 | `getSemanticSearchAvailability` | `hybridSearch.ts:90` | `readEmbeddingStatus`: existência, identidade provider/modelo/`inputVersion`/`prefixMode`, contagem válida; ramo binário quando ilegível | Ficheiros em disco (lê o canónico) | Fresco por chamada (custo I/O) | Alimenta R1; ramo legado de `runHybridSearch` (modais); fallback de motivo na Sidebar |
| R3 | Verificação inline no ramo runtime de `runHybridSearch` | `hybridSearch.ts:524-538` | `runtimeIndex` existe ∧ identidade igual à do dispositivo | `RuntimeEmbeddingIndexCache` | Invalidada por publicação/settings/binário | **Sidebar: pesquisa híbrida** |
| R4 | Verificação inline em `runSemanticSearchGrouped` | `linaSearchView.ts:3775-3803` | igual a R3 + dimensão | `RuntimeEmbeddingIndexCache` | idem R3 | **Sidebar: pesquisa semântica pura** (depois de R1) |
| R5 | Cadeia de mensagens do modal de pesquisa semântica | `search/semanticSearchModal.ts:145-300` | verificações próprias em série (`statusEl`) | leituras diretas | fresco | Comando "pesquisa semântica" (`main.ts:685`) |
| R6 | 2.ª avaliação em `buildDeviceDiagnostics` | `deviceDiagnostics.ts:377` | `evaluateSemanticCapability` com `vectorContractState` derivado só do Companion | `companionState` | fresco na abertura | Secção `companionSearch` do diagnóstico |
| R7 | `CompanionArtifactConsumptionState.embeddingState.available` | `companionConsumptionState.ts:362` | declarado ∧ **sem** mismatch `generationId` | manifestos | fresco por leitura | `executeCompanionSearch*` (**sem chamadores de produção**), `consumptionMode` do diagnóstico, ramo `missing` do VM |

**Resposta:** cinco implementações vivas do "está disponível" (R1, R3, R4, R5, R6) sobre um avaliador base (R2), mais uma (R7) com uso parcial. O `semanticAvailable` em `DeviceRuntimeState` é a fonte de verdade *declarada* (LINA-07), mas apenas **a Sidebar e o pre-gate** a consomem; **a pesquisa híbrida da Sidebar não a consulta**.

## 1.2 Existe divergência entre híbrida e semântica pura? — **Sim**

| Situação | Híbrida (Sidebar) | Semântica pura (Sidebar) | Origem |
|---|---|---|---|
| Vetores acabaram de ser publicados; cache diz `semanticAvailable=false` | Pesquisa (R3 usa índice runtime invalidado) | **Recusa** com o motivo em cache (`:3755-3759`) | R1 desatualizada |
| Provider/modelo alterado; cache ainda `true` | Aviso "componente semântica indisponível" e devolve só texto | Passa o pre-gate e é recusada em R4 com mensagem diferente | Dois textos para o mesmo estado |
| Cache `false` por arranque de Companion sem contrato | Pesquisa (identidade validada contra o contrato herdado) | **Recusa** | ordem de arranque (§6) |

## 1.3 Uma cache pode bloquear pesquisa funcional? — **Sim, confirmado**
Passo único responsável: `linaSearchView.ts:3755-3759` (`if (!runtimeState.embeddings.semanticAvailable) { … return; }`). Removê-lo não reduz segurança: R4 valida identidade, prefixo e dimensão a seguir e `getRuntimeEmbeddingIndex` devolve `null` (com mensagem própria) quando não há fonte segura.

## 1.4 Estado desalinhado entre Sidebar e pesquisa
Como R1 alimenta o cabeçalho ("Pesquisa híbrida disponível") e R3 decide a pesquisa real, é possível a Sidebar afirmar **híbrida completa** enquanto a pesquisa devolve o aviso "usados apenas resultados textuais" (mudança de provider/modelo sem refresh de R1). Este é um caso de "diz pronto mas não está" (§4.3).

---

# 2. Write Path — "existe trabalho para gerar embeddings?"

| Local | Função | Critério usado | Fonte de dados | Divergências |
|---|---|---|---|---|
| `embeddingUpdatePlan.ts:214-338` | `calculateEmbeddingUpdatePlan` (única lógica de **classificação**) | `mode` ∈ {initial-build, incremental, full-rebuild, indeterminate}; `toGenerate` = chunks sem registo reutilizável nem checkpoint; `requiresPublication = chunks>0 ∧ toGenerate=0 ∧ cleanupNeeded` (obsolete/duplicate/invalid/modo≠incremental com canónico/checkpoint recuperável) | chunks + canónico + checkpoint + identidade | Fonte factual; `requiresPublication` exige `chunks.length>0` |
| `embeddingWorkStatusController.ts:85-105` | `hasEmbeddingWorkAvailable` / `deriveEmbeddingWorkAvailability` → `workAvailable` | `toGenerate>0 ∨ requiresPublication ∨ missing>0 ∨ stale>0 ∨ obsolete>0 ∨ duplicate>0 ∨ invalid>0`; `full-rebuild⇒true`; `indeterminate`/sem detalhes ⇒ `undefined` | `readEmbeddingStatus` + `readEmbeddingUpdatePreview` | Mais amplo que D3/D4; único com tri-estado |
| `embeddingWorkflowState.ts:61` | `Boolean(workState.workAvailable)` | coerção | controller | `undefined`→`false`→`IDLE` |
| `embeddingWorkflowState.ts:37-190` | `canUpdate` | `isAuthorizedProducer ∧ textIndexReady` nos estados update-required/error/cancelled+trabalho | resolver | **Nunca lido** |
| `sidebarStatusViewModel.ts:355, 366` | `embeddingsWorkAvailable === true` | booleano; só decide entre `stale/fresh` em 2 ramos | `embeddingWorkState.workAvailable` (mesmo com `status` `dirty/calculating/error`) | Usa valor **antigo** durante `dirty` (o `markDirty` preserva `workAvailable`, `embeddingWorkStatusController.ts:168-175`) |
| `linaSearchView.ts:2829-2834` | condição do botão | `isAuthorizedProducer ∧ workAvailable===true ∧ !running ∧ !cancelling ∧ indexReady` | idem | Não vê `embeddingsEnabled`, `updateMode`, `error`, `checking` |
| `main.ts:1674` | `hasPendingWork` para a política | `toGenerate>0 ∨ requiresPublication ∨ isFullRebuild` | preview novo (I/O repetido) | Não inclui `missing/stale/obsolete/dup/invalid` isolados |
| `main.ts:1702-1704` | decisão "já atualizado" | `!isFullRebuild ∧ (toGenerate===0 ∨ reason==="no-update-required")` | preview | Pode contradizer o botão (D1 verdadeiro, D5 falso) |
| `main.ts:2576-2585` | `hasAutomaticEmbeddingWork` (scheduler) | `toGenerate>0 ∨ requiresPublication` | preview novo | idem |
| `embeddingPolicyEngine.ts:71-77` | `hasPendingWork` (fallback por contagens) | `missing>0 ∨ stale>0 ∨ toGenerate>0` | argumento | Não inclui `obsolete` |
| `embeddingGenerator.ts:999-1047` | plano no arranque da geração | mesmo planeador, com `incremental` conforme setting; `totalToGenerate===0 ∧ requiresPublication` ⇒ publicar sem gerar | ficheiros no momento | Terceiro cálculo do mesmo preview (podem diferir se o índice mudou) |
| `maintenance/embeddingStatusExplanation.ts` | classificação por contagens para o modal de confirmação | `missing/stale/obsolete/toGenerate` | argumento | Auxiliar |
| `search/embeddingStatusViewModel.ts:96-164` | cabeçalho e ações por `mode` | regra própria (`full-rebuild`→rebuild; `!embeddingsReady`→generate; `workAvailable`→update) | `workState` | **Sem chamadores** (só tipos importados); mantém `renderEmbeddingDiagnostic*` mortos na Sidebar |
| `main.ts:866-875` | `getEmbeddingWorkflowState()` | resolver com `textIndexReady ?? true` | — | **Sem chamadores**; a Sidebar chama o resolver direto com `textIndexReady=indexReady` |

**Resumo:** um planeador (fonte factual) → **cinco reduções** diferentes para booleano (controller, política, scheduler, botão, VM) + uma execução com plano próprio + duas reduções em código morto. Divergências comprovadas em §7 (B4, B5, B6, B7).

---

# 3. Separação Read / Write

## 3.1 Escrita → mensagens de pesquisa
| # | Onde | Efeito |
|---|---|---|
| S1 | `sidebarStatusViewModel.ts:417-426` | `semanticPreparing` (fase `preparing/waiting/validating` da **geração**) muda o título da pesquisa para "A preparar pesquisa semântica", mesmo com `semanticAvailable=true` |
| S2 | `sidebarStatusViewModel.ts:341`; `linaSearchView.ts:2702-2706` | `isEmbeddingsChecking` = Read (`runtimeState`) ∨ Write (`work.status`) ∨ Write (`semanticPreparing`) |
| S3 | `sidebarStatusViewModel.ts:491-496` | alerta "semântica indisponível" suprimido por `!semanticPreparing ∧ !embeddingsChecking` |
| S4 | `linaSearchView.ts:2914` (código morto) | `Embeddings: Prontos · A preparar pesquisa semântica…` |

## 3.2 Pesquisa → decisões de atualização
| # | Onde | Efeito |
|---|---|---|
| S5 | `sidebarStatusViewModel.ts:347-357` | `isOperational` (Read) decide se `workAvailable` se traduz em "Atualização necessária" ou noutro texto |
| S6 | `sidebarStatusViewModel.ts:362-363` | `contractState==="mismatch"` (Read) produz "Atualização necessária" (rótulo de Write), inclusive em Companion sem ação possível |
| S7 | `hybridSearch.ts:123-128` | O Read depende da configuração local do dispositivo (necessário: a consulta tem de ser embebida com o mesmo modelo). Legítimo, mas exige invalidação do Read quando a configuração muda |

## 3.3 Diagnóstico
- `deviceDiagnosticsModal.ts:276-278` já usa `runtimeEmbeddings.semanticAvailable` (correção de LINA-10 aplicada). ✔
- Mantém-se o desalinhamento `companionSearch.mode` (= `consumptionMode`, R7) vs `operationalMode`: após qualquer publicação textual posterior aos embeddings, R7 marca `embeddings: invalid` (B8), enquanto o operacional diz `full`. A modal escolhe o operacional; o campo `mode` fica incoerente para outros consumidores.
- A modal não mostra estado de escrita; **não há mistura Write→Read** no diagnóstico, mas há dupla implementação (R6).

---

# 4. Fluxo manual de geração (provider externo, modo manual)

## 4.1 Percurso completo, verificado no código
1. Utilizador edita nota → evento → fila com debounce → batch (`main.ts:3489-3521`) → publicação textual → `markEmbeddingWorkStatusDirty("text-index-published")` + `invalidateRuntimeEmbeddingIndex`.
2. Controller: `dirty` (o `workAvailable` anterior é **mantido**) → refresh agendado (250 ms) apenas se houver subscritores → `calculating` → `ready` com `workAvailable=true`.
3. Sidebar subscrita: `applyEmbeddingWorkStatus` → `refreshState` → cartão "Estado": linha **"Embeddings: Atualização necessária"** e, se o dispositivo for Active Producer com índice pronto, botão **"Atualizar embeddings"** (`mod-cta`).
4. O clique chama `confirmAndRequestEmbeddingGeneration("sidebar")` → política → modal de confirmação (provider externo ⇒ `requiresConfirmation`) → geração.
5. Existe também o comando "Lina: gerar embeddings".

## 4.2 Respostas
| Pergunta | Resposta |
|---|---|
| Há indicação clara ao utilizador? | **Parcial.** A linha "Embeddings: Atualização necessária" existe, mas **só dentro do acordeão "Estado"**. A barra compacta sempre visível mostra "Pesquisa híbrida disponível" sem qualquer indicação de atualização pendente (LINA-08 previa "(atualização pendente)"; não foi implementado). Não há contagem de notas afetadas. |
| Há botão visível? | **Sim**, no cartão "Estado", apenas para Active Producer + índice textual pronto + `workAvailable===true`. **Não** aparece em `error`, em `indeterminate`, em Companion/Standby (correto), nem com explicação quando está escondido. |
| O utilizador percebe que tem de agir? | Só se abrir/tiver aberto o acordeão. A barra superior verde transmite "tudo ok". |
| Existe um estado que diz "pronto" mas não está? | **Sim, vários** (§4.3). |

## 4.3 Estados "pronto mas não está"
| # | Situação | Mecanismo | Certeza |
|---|---|---|---|
| P1 | Índice textual **desatualizado face ao vault** com atualização automática desligada | `readTextIndexStatus` classifica `stale` (`indexStore.ts:852`), mas o VM só distingue `missing` e "disponível"; `textStatus` depende só da idade (`sidebarStatusViewModel.ts:316-327`). Os embeddings dizem "Atualizados" porque o **plano só vê os chunks do índice**, não as notas | Confirmado |
| P2 | Regras de exclusão por **conteúdo** ativas | `getTextIndexStatus` só passa `expectedNotes` quando `getExcludedContentTerms().length === 0` (`main.ts:443`); com termos definidos a deteção de `stale` fica **desligada** | Confirmado |
| P3 | Janela `dirty/calculating` após publicação textual | VM usa `embeddingWorkState.workAvailable` mesmo com `status≠ready`; o valor anterior (`false`) mostra "Atualizados" até ao fim do cálculo (250 ms + I/O; mais se `shouldDeferRefresh`, i.e. durante `persisting`) | Confirmado |
| P4 | Canónico ilegível / detalhes indisponíveis | `workAvailable=undefined` → resolver `IDLE`; VM trata como "fresh" quando operacional | Confirmado |
| P5 | Mudança de provider/modelo sem refresh de R1 | cabeçalho "Pesquisa híbrida disponível" vs aviso real de texto apenas | Confirmado |
| P6 | Embeddings desativados | linha "Desativados" + botão "Atualizar embeddings" (contradição inversa) | Confirmado |
| P7 | Sucesso de geração | mensagem de conclusão apagada por `setStatus("")` de `refreshState` (`linaSearchView.ts:2029` vs `:2687`) | Plausível |

---

# 5. `DeviceRuntimeState`

## 5.1 Criação
Três chamadores de `resolveDeviceRuntimeState` (detalhe em LINA-12B §1.1): `refreshDeviceRuntimeState` (A), ramo sem cache de `getDeviceRuntimeState` (B, com ownership fabricado e sem manifestos), `buildDeviceDiagnostics` (C, sem `embeddingsEnabled`). A e C **escrevem** a cache; B não. `embeddings.configured` não é consumido.

## 5.2 Atualização
`refreshDeviceRuntimeState`: `loadDataFromDisk` (2 ramos), `changeDeviceRole` (2 ramos), callback da modal de diagnóstico da Sidebar (`linaSearchView.ts:2879`). `getDeviceDiagnostics`: comando de diagnóstico, botão ⓘ da Sidebar, callback de refresh das modais.

## 5.3 Consumidores
Sidebar (`refreshState`, decisão do botão, gating de diagnóstico), pesquisa semântica pura (`:3755`), `getEmbeddingWorkflowState`, Definições (3 resumos + ação de papel), comando de diagnóstico.

## 5.4 Matriz de invalidação

| Evento | Altera capacidade? | Invalida hoje o estado? | Deveria invalidar? | Notas |
|---|---|---|---|---|
| Publicação de embeddings (geração concluída) | **Sim** (`exists`, `semanticAvailable`, contagens) | **Não** (`main.ts:2883-2885` invalida só índice runtime e work-status) | **Sim** | Após `publish` e após rollback |
| Recuperação de publicação interrompida | Sim | Não | Sim | idem |
| Publicação do índice textual (batch, rebuild, exclusões, rename) | **Sim** (`textIndexAvailable`, novo `generationId` ⇒ B8, contrato) | Não (`main.ts:3520, 2362`) | **Sim** | Vários pontos de escrita; usar choke point único |
| Mudança de provider | **Sim** (`incompatible`) | Não (`refreshEmbeddingConfigurationState` recarrega contrato e marca work dirty) | **Sim** | Só depois de `loadCanonicalVectorContract` |
| Mudança de modelo | Sim | Não | Sim | idem |
| Mudança de prefixo/`inputVersion` | Sim | Não | Sim | — |
| Mudança de ownership — via Definições/diagnóstico | Sim (`isActiveProducer`, `canPublish`) | Só pelo `getDeviceDiagnostics` do callback | Sim | — |
| Mudança de ownership — comando `transferir-ownership-dispositivo` | Sim | **Não** (`main.ts:787-796`) | **Sim** | Botão pode ficar visível no dispositivo despromovido |
| Mudança de papel | Sim | **Sim** (`main.ts:1185, 1200`) | Sim | Único evento corretamente coberto |
| Sincronização externa de artefactos | **Sim** | Não (`external-sync-detected` existe como razão de invalidação mas ninguém a emite) | **Sim** (por impressão digital na utilização, sem polling) | Follow-up A2 já registado |
| Criação/remoção/atualização da cópia binária | **Sim** (`binary-required/stale/invalid`) | Não (só índice runtime, `main.ts:1494`) | **Sim** | — |
| Mudança de `embeddingStorageReadPreference` | Sim | Não (efeito só invalida índice runtime) | **Sim** | — |
| Mudança de `embeddingsEnabled` | Não altera capacidade; altera `configured`/apresentação | Não | Sim (apresentação) | — |
| Carregamento do contrato vetorial (arranque) | **Sim** (Companion) | Não — o contrato é carregado **depois** do refresh | **Sim / reordenar** | §6 |
| Abertura do diagnóstico | Não | **Sim, como efeito colateral** (`main.ts:984`) | Não deve ser o mecanismo | Torna o defeito intermitente |
| Abertura da Sidebar | — | Não | Validar impressão digital | — |

---

# 6. Arranque

## 6.1 Ordem atual (`loadDataFromDisk`, `main.ts:3595-3675`)
```
1. carregar dados / migração de settings
2. loadDeviceState / papel (2 ramos: futuro vs normal)
3. OwnershipGate.evaluate()                           (autoClaim ligado)
4. refreshDeviceRuntimeState()                        ← calcula R1 aqui
5. initializeExclusionPolicy()
6. loadCanonicalVectorContract()                      ← contrato só agora
```
`getEffectiveEmbeddingConfig()` de um Companion depende do contrato (`main.ts:2495-2507`): sem contrato devolve `provider:""`, `model:""`, `isAvailable:false`.

## 6.2 Cenários
| Cenário | O que acontece | Certeza |
|---|---|---|
| **Companion, arranque normal** | R1 calculada com config vazia ⇒ `incompatible`/indisponível, **em cache**; nada a corrige até ao diagnóstico/reinício. Sidebar: "só texto" + alerta; pesquisa semântica pura: recusa; híbrida: funciona | Ordem: confirmada. Efeito final: plausível |
| **Companion, contrato novo publicado durante a sessão** | `effectiveVectorContract` só volta a ser lido em `refreshEmbeddingConfigurationState`; identidade validada contra contrato antigo | Confirmado |
| **Primeiro arranque (vault novo, produtor)** | R1 calculada sem artefactos (`text-only`/`missing`); depois da 1.ª publicação (índice textual + embeddings) não é recalculada | Confirmado |
| **Produtor com `autoClaim`** | `evaluate()` reclama ownership se não existe manifesto; dois desktops com sync intermédio podem ambos reclamar | Confirmado (mecanismo) |
| **Cache `null`** (`getDeviceRuntimeState` antes do 1.º refresh) | ramo B: sem manifestos ⇒ `textIndexAvailable=false`, "sem contrato" | Confirmado (janela curta) |
| **Estado calculado antes de `initializeExclusionPolicy`** | Sem impacto direto em R1; sem evidência de dependência | — |

## 6.3 Ordem correta
```
role/deviceState → ownership.evaluate → loadCanonicalVectorContract → (config efetiva) → refreshDeviceRuntimeState → subscrições/UI
```
Justificação: R1 depende de `getEffectiveEmbeddingConfig()`, que depende de `effectiveVectorContract` (Companion) e do papel.

---

# 7. Bugs reproduzíveis

Legenda: **C** = confirmado no código; **P** = plausível. Todos requerem o teste de caracterização indicado em §8 para passar a "reproduzido". Passos partem de `new LinaPlugin(app)` com `FakeAdapter` (padrão de `tests/device/deviceStateStartupIntegration.test.ts`).

| ID | Sev. | Cert. | Título | Passos | Esperado | Atual | Evidência | Fase |
|---|---|---|---|---|---|---|---|---|
| B1 | Alta | C | Pesquisa semântica pura bloqueada por cache antiga | Vault sem embeddings → `loadDataFromDisk` → publicar índice textual + embeddings válidos → chamar `runSemanticSearchGrouped` | Pesquisa executa | Recusa com motivo antigo | `linaSearchView.ts:3755-3759`; sem refresh em `main.ts:2883-2885` | P1 |
| B2 | Alta | C | Cache não reage a mudança de provider/modelo | Estado `available` → alterar provider/modelo → `refreshEmbeddingConfigurationState()` → ler `getDeviceRuntimeState()` | `incompatible` | Continua `available` | `main.ts:887-893` sem refresh de R1 | P1 |
| B3 | Alta | P | Companion arranca com R1 calculada sem contrato | Manifest com contrato + Companion → `loadDataFromDisk` | `semanticAvailable=true` | Estado calculado antes de `loadCanonicalVectorContract` | `main.ts:3605-3610, 3670-3675`; `main.ts:2495-2507` | P1 |
| B4 | Média | C | Sidebar afirma "Atualizados" durante `dirty/calculating` | Estado `ready/workAvailable=false` → publicar índice textual (chama `markDirty`) → `buildSidebarStatusViewModel` com `embeddingWorkState` atual | "A verificar…" | "Atualizados" (valor anterior) | `embeddingWorkStatusController.ts:168-175`; VM `:355-357` | P1 |
| B5 | Média | C | `indeterminate` apresentado como "Atualizados" | `workAvailable=undefined`, `status=ready` | "Estado desconhecido" | `IDLE`/"fresh" | `embeddingWorkflowState.ts:61, 184-189`; `embeddingWorkStatusController.ts:100-105` | P1 (mínimo) / LINA-14 |
| B6 | Média | C | Botão visível com embeddings desativados | `embeddingsEnabled=false` + chunks sem embeddings | Sem botão / CTA de ativação | Botão "Atualizar embeddings" | `linaSearchView.ts:2829-2834` (não lê `embeddingsEnabled`) | P1 |
| B7 | Média | P | Ciclo "Atualização necessária" ↔ "já atualizado" | Canónico só com registos `obsolete`, índice sem chunks | Coerente | Botão visível; clique devolve "já atualizado" | `embeddingWorkStatusController.ts:85-98` vs `embeddingUpdatePlan.ts:314` | LINA-14 |
| B8 | Média | C | `generationId` diferente tratado como embeddings `invalid` | Publicar embeddings; editar nota → nova publicação textual (novo `generationId`, `embeddings` preservado) → `evaluateCompanionConsumptionState` | Estado normal de drift; `exists=true`, `consumptionMode=full` | `embeddingsAvailability="invalid"`, `exists=false`, `consumptionMode="text-only"` | `indexStore.ts:443, 428-433`; `embeddingPersistence.ts:791`; `companionConsumptionState.ts:339-350` | P1 (mínimo) / LINA-14 |
| B9 | Média | C | Fallback por idade produz "Atualização necessária" | Não operacional (cache falsa), sem trabalho, `producer-state` antigo >48 h | Sem alarme por idade | `stale` | `sidebarStatusViewModel.ts:368-371`, `producerState.ts:259-287` | P1 |
| B10 | Baixa | C | Alertas `producer-stale/aging` por idade | `producer-state.updatedAt` >24 h/48 h | Sem alerta se nada falha | Alerta | `sidebarStatusViewModel.ts:482-511` | P1 |
| B11 | Baixa | C | Comando de transferência não atualiza `isActiveProducer` | Executar `transferir-ownership-dispositivo` no dispositivo despromovido | Botão oculto | Botão mantém-se | `main.ts:787-796` | P1 |
| B12 | Baixa | C | Sidebar não sinaliza atualização pendente na barra compacta | `workAvailable=true`, `semanticAvailable=true` | Indicação visível | "Pesquisa híbrida disponível" apenas | VM `:428-430` | P1 |
| B13 | Média | C | `textIndexStale` invisível na Sidebar | Auto-update desligado; editar nota | Aviso de índice desatualizado | Sem aviso (só idade) | `indexStore.ts:852`; VM `:316-327` | LINA-14 (ou P1 se pequeno) |
| B14 | Média | C | Deteção de `stale` desligada com termos de exclusão por conteúdo | Definir `indexExcludedContentContains` | Deteção mantida | `expectedNotes` `undefined` ⇒ nunca `stale` | `main.ts:443-447` | LINA-14 |
| B15 | Média | C | `refreshState` pesado por cada tick de progresso | 200 ticks de `setProgress` | O(1) leituras | Cada tick lê canónico + digests | `linaSearchView.ts:1977-1980`; `companionConsumptionState.ts:510-535`; `embeddingGenerator.ts:1654` | P1 (mínimo) |
| B16 | Alta | C | Sem revalidação de ownership antes de `persisting` | Transferir ownership durante geração | Publicação abortada | Publica com proveniência antiga | `main.ts:2789`; `ownershipGate.ts:186-188` | P1b (separado) |
| B17 | Baixa | C | `isChecking`/`providerReachable` mortos | — | — | `runtimeState` nunca `checking` | grep | LINA-14 |
| B18 | Baixa | P | Feedback de conclusão apagado | Geração concluída com Sidebar aberta | Mensagem de sucesso visível | `setStatus("")` seguinte | `:2029` vs `:2687` | LINA-14 |

---

# 8. Testes de caracterização (P0)

## 8.1 Estratégia
Testes que **fixam o comportamento atual** antes de alterar código: os que descrevem um bug usam `it.fails(...)` (Vitest) com a asserção do comportamento **correto**; passam (falham "como esperado") hoje e passam a falhar quando o bug for corrigido, obrigando a convertê-los em `it(...)` no PR do P1. Testes de comportamento correto já existente (§8.3) usam `it(...)` normal.

## 8.2 Plano

| ID | Bug | Camada / harness | Arrange | Assert (comportamento correto) |
|---|---|---|---|---|
| T1 | B1 | Plugin + view (`new LinaPlugin(app)` como em `deviceStateStartupIntegration.test.ts`; artefactos via `FakeAdapter`; reutilizar o construtor de artefactos de `tests/index/embeddingLifecycle.integration.test.ts`) | `loadDataFromDisk` sem embeddings → publicar índice+embeddings | `getDeviceRuntimeState().embeddings.semanticAvailable === true` e `runSemanticSearchGrouped` não devolve o motivo antigo |
| T2 | B2 | Plugin | R1 `available` → mudar provider/modelo em settings → `refreshEmbeddingConfigurationState()` | `reasonCode==="model-incompatible"` |
| T3 | B3 | Plugin | Manifesto textual com `vectorContract` + papel `companion` → `loadDataFromDisk` | `semanticAvailable===true` sem abrir diagnóstico |
| T4 | B4 | Pura (`buildSidebarStatusViewModel`) | `EmbeddingWorkRuntimeState { status:"dirty", workAvailable:false }` | linha "A verificar…", não "Atualizados" |
| T5 | B5 | Pura (`resolveEmbeddingWorkflowState`) | `status:"ready", workAvailable:undefined` | `status !== "idle"` (estado indeterminado) |
| T6 | B6 | View (`linaSearchViewHardening` como base) | `embeddingsEnabled=false`, `workAvailable=true`, produtor autorizado | sem botão `lina-sidebar-update-btn` |
| T7 | B7 | Integração de funções (`calculateEmbeddingUpdatePlan` + `hasEmbeddingWorkAvailable` + `hasAutomaticEmbeddingWork` lógica extraída em teste) | `chunks=[]`, canónico com `obsolete` | `workAvailable===false` **ou** botão inexistente; scheduler e pedido concordam |
| T8 | B8 | Pura (`evaluateCompanionConsumptionState`) | Manifesto textual com `generationId=B` e `embeddings.sourceTextGenerationId=A` | `embeddingState.available===true` (vetores válidos para chunks inalterados) |
| T9 | B9/B10 | Pura (VM) | `runtimeEmbeddings.semanticAvailable=false`, sem trabalho, `producerState` com 72 h | sem `stale` de embeddings; sem alerta `producer-stale` |
| T10 | B11 | Plugin | Callback do comando de transferência | `getDeviceRuntimeState().isActiveProducer===false` |
| T11 | B12 | Pura (VM) | `semanticAvailable=true`, `workAvailable=true` | cabeçalho ou campo de estado indica atualização pendente |
| T12 | B13 | Plugin/pura | Índice `stale` (via `readTextIndexStatus` com `expectedNotes`) | VM expõe estado `stale` do índice textual |
| T13 | B14 | Plugin | `indexExcludedContentContains` não vazio | `expectedNotes` calculado (drift detetável) |
| T14 | B15 | View com contador no `FakeAdapter` | 200 chamadas a `setProgress` | leituras de `embeddings.jsonl`/`chunks.jsonl` ≤ constante |
| T15 | B16 | Integração (padrão `embeddingLifecycle.integration`) | Transferir ownership entre `generate` e `persisting` (via `onProgress`) | publicação abortada, checkpoint preservado |
| T16 | B18 | View | Fim de operação com mensagem | mensagem visível após `refreshState` |

## 8.3 Testes de proteção (comportamento correto a preservar)
- `resolveEmbeddingWorkflowState`: `workAvailable ∧ !running ⇒ update-required`, nunca `preparing` (existe em `embeddingWorkflowState.test.ts`).
- Pesquisa textual independente de qualquer estado semântico (nova asserção nos testes de view).
- Proveniência `stale/future/unknown` nunca altera `semanticAvailable` nem dispara rebuild.
- Checkpoints nunca pesquisáveis.
- Companion nunca gera/agenda.
- Equivalência R1 ⇔ resultado da pesquisa híbrida da Sidebar para o mesmo estado publicado (novo teste de paridade; hoje falha em B1/B2).

---

# 9. Roadmap: confirmação e correções

## 9.1 LINA-13-P0 — confirmado com ajustes
- Entregáveis: este relatório + suite T1-T16 (`it.fails` para bugs) + lista de bugs B1-B18.
- **Ajuste:** os testes de plugin (T1-T3, T10, T15) exigem um *builder* de vault (índice textual + embeddings + manifest) reutilizável; existe parcialmente em `embeddingLifecycle.integration.test.ts` — extrair para `tests/helpers` faz parte do P0 (é código de teste, não de produção).

## 9.2 LINA-13-P1 — proposta refinada (correções mínimas, sem refatoração)

Ordem por risco crescente; cada item com o teste que o fecha.

| Item | Alteração | Bugs | Testes | Risco |
|---|---|---|---|---|
| P1-a | **Remover o pre-gate por cache** em `runSemanticSearchGrouped` (`:3755-3759`); a validação de identidade existente (R4) passa a ser a única | B1 (sintoma funcional) | T1, paridade R1⇔pesquisa | Muito baixo |
| P1-b | **Reordenar o arranque**: `loadCanonicalVectorContract()` antes de `refreshDeviceRuntimeState()` nos dois ramos | B3 | T3 | Baixo |
| P1-c | `getFreshDeviceRuntimeState()` (assíncrono, **single-flight e coalescido**): reutiliza o `semanticAvailability` que `refreshState` já calcula (evita 2.ª leitura) e substitui o uso síncrono na Sidebar (`refreshState`) | B1, B2 | T1, T2 | Médio |
| P1-d | **Invalidar** (chamar o refresh de P1-c ou marcar dirty) nos choke points já existentes: fim de publicação/recovery (`main.ts:2883`), publicação textual (`:3520`, `:2362`), `refreshEmbeddingConfigurationState`, callback do comando de transferência (`:792`), `onBinaryPublicationReady` (`:1494`) e efeito de preferência de leitura | B1, B2, B11 | T1, T2, T10 | Médio |
| P1-e | VM: `embeddingsWorkAvailable` só é confiado com `status==="ready"`; `dirty/calculating/error` ⇒ "A verificar…"; `undefined` ⇒ "Estado desconhecido" (fim de B4/B5); remover o fallback por idade (`:368-371`) e rebaixar/remover alertas `producer-stale/aging` | B4, B5, B9, B10 | T4, T5, T9 | Baixo |
| P1-f | **Botão explícito**: condição = `embeddingsEnabled ∧ isAuthorizedProducer ∧ workAvailable ∧ …`; acrescentar indicador de atualização pendente na barra compacta e contagem quando disponível; estado `error` com retry | B6, B12 | T6, T11 | Baixo |
| P1-g | Limitar `refreshState` durante `running` (só render leve nos ticks; refresh completo em transições de fase/estado) | B15 | T14 | Médio |
| P1-h | Remover código morto que reintroduz contradição: `renderEmbeddingDiagnosticSummary` (com "Prontos · A preparar…") | S4 | — | Muito baixo |
| **P1b** (PR separado) | **Ownership**: `isAuthorizedSync()` não autoriza escrita com `lastDecision===null`; reavaliar `evaluate(expectedEpoch)` antes de `persisting` | B16 | T15 | Médio (semântica de autorização) |

**Fora de P1:** coordenador, `classifyEmbeddingWork`, snapshot de workflow, corte do VM, `EmbeddingCorpusFacts`, tratamento de B7/B13/B14 (exigem decisões de produto: p. ex. o que significa `stale` do índice textual quando há exclusões por conteúdo).

**Critérios de aceitação de P1:** todos os `it.fails` de T1-T6, T9-T11, T14 convertidos em `it`; suite completa verde; `npm run typecheck`, `build`, `release-check`, `lint:obsidian` sem regressões (baseline 7 avisos históricos); nenhuma alteração de schema/persistência; pesquisa textual intacta.

**"getFreshSemanticCapability" (proposta do prompt):** validado, mas com forma diferente: em vez de uma função nova que recalcule tudo, `getFreshDeviceRuntimeState()` deve **reutilizar** o resultado que `refreshState` já obtém; caso contrário P1 aumenta o I/O que B15 já denuncia.

## 9.3 LINA-14 — consolidação (pergunta truncada: "Possível criação: …")
Proposta de artefactos a **criar**:
1. `EmbeddingLifecycleCoordinator` (nome sugerido; alternativa `SemanticStateCoordinator`): snapshot revisionado `{ role, read, write, textIndex, info }`, `markDirty(reason)`, lazy single-flight, `getFresh()/getSnapshot()/subscribe()`, fingerprint na utilização (sem polling).
2. `classifyEmbeddingWork(preview, ctx): none | indeterminate | pending{…}` em `embeddingUpdatePlan.ts` (ou módulo irmão), usado por controller, política, scheduler e execução.
3. `EmbeddingWorkflowSnapshot` estendido (`lastOutcome`, `action{visible,enabled,blockedReason}`, `trigger`, `cancelling`).
4. `EmbeddingCorpusFacts` (leitura única por ciclo).
5. Corte do `sidebarStatusViewModel` para `{ role, read, write, textIndex, info }`.
6. Remoção de código morto (`buildEmbeddingStatusViewModel` + `renderEmbeddingDiagnostic*`, `canUpdate` antigo, `EmbeddingWorker.state`, parâmetros `isChecking/providerReachable`, R6 duplicada).
7. Decisão de produto sobre o índice textual `stale` (B13/B14) e sobre a interpretação de `generationId` (B8).

## 9.4 Sequência recomendada
P0 (testes) → P1-a, P1-b → P1-e, P1-h → P1-c, P1-d → P1-f → P1-g → P1b → LINA-14.

---

# 10. Respostas às questões principais

1. **Fonte de verdade de "a pesquisa semântica está disponível?"** — Declarada: `DeviceRuntimeState.embeddings.semanticAvailable` (LINA-07). Efetiva: **cinco implementações** (R1, R3, R4, R5, R6) sobre R2. A pesquisa híbrida da Sidebar não usa R1. Existe divergência híbrida vs pura e a cache pode bloquear pesquisa funcional (B1).
2. **Write Path** — um planeador factual e cinco reduções booleanas divergentes (§2). Divergências: B4, B5, B6, B7.
3. **Separação** — módulos puros e dados separados; mistura na apresentação (S1-S6) e dependência do Read da configuração (S7, legítima). O diagnóstico não mistura, mas duplica R6.
4. **Fluxo manual** — há indicação e botão, mas só dentro do acordeão e apenas para Active Producer; a barra compacta não sinaliza a pendência; existem sete estados "pronto mas não está" (§4.3).
5. **`DeviceRuntimeState`** — cache sem invalidação nos eventos relevantes; matriz em §5.4; efeito colateral do diagnóstico oculta o defeito.
6. **Arranque** — o contrato é carregado depois de calcular R1; afeta Companion e primeiro arranque (§6).

## 11. Decisões a congelar (para LINA-13)
1. P1 **não** introduz coordenador nem altera contratos de dados; só invalida, reordena, alinha e sinaliza.
2. A validação de identidade sobre o índice runtime é o critério **de execução** da pesquisa (híbrida e pura); R1 é o critério **de apresentação** e deve ser fresco.
3. A idade é informação; nunca decide estado nem alerta de degradação.
4. `workAvailable` só é fiável com `status==="ready"`.
5. `embeddingsEnabled` é condição de qualquer ação de geração.
6. Reautorização de ownership antes de publicar é tratada em PR próprio (P1b).

## 12. Perguntas em aberto
- Se o pedido truncado de LINA-14 nomeia um artefacto específico, indicar o nome pretendido.
- Semântica desejada de `stale` do índice textual com exclusões por conteúdo (B14).
- Se `generationId` divergente deve ser tratado como estado normal de drift (recomendado) ou como incompatibilidade (B8).
- Reprodução em runtime de B1, B3, B4, B8, B15 pelo próprio builder de vault do P0.

## 13. Confirmações de âmbito
- Apenas este relatório foi criado; nenhum ficheiro de código, teste, configuração ou schema foi alterado.
- Nenhuma nota do vault alterada, nenhum embedding gerado, nenhuma chamada externa, nenhum commit.
