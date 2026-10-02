# LINA-15H-B — Recovery no arranque e validação do par canónico

**Data:** 2026-10-02 · **Branch:** master · **Base:** `fa83d02bd763cbec5c68ccdc48820093a3c40ec4`.

**Estado:** implementação da alternativa A da auditoria concluída, com limites residuais explícitos. A 15H-C não foi iniciada. Sem push, tag ou release.

## 1. Problema e causa

R-01: o recovery canónico só era chamado durante geração. R-02: o reparo binário podia atribuir o publicationId antigo a um JSONL novo com contagem diferente. R-03/R-04: leitores e lifecycle mascaravam publicação incompleta/truncagem como READY ou UPDATE_AVAILABLE. R-05: o recovery validava a fence apenas no início. R-06/R-07: faltavam coordenação de recovery no arranque e chamador de produção para recovery binário.

O manifesto é partilhado com o índice textual. Publicar dois ficheiros por renames sequenciais deixa uma janela de crash; esta implementação deteta e recupera as inconsistências verificáveis pelos contratos existentes, sem substituir o modelo de persistência.

## 2. Preparação e testes antes de produção

Confirmados diretório/root `D:/_dev/obsidian/lina`, branch master, HEAD fa83d02, working tree limpa, últimos oito commits e diff-check. Consultados AGENTS.md, docs/INDEX.md, baseline LINA-14, auditoria 15H-B-A e relatórios 15A, 15B, 15C, 15D-B, 15F e 15G; formato de relatório em docs/arquivo/agents/relatorio-final.md usado apenas como formato, não como especificação técnica.

A prompt-mestra PROMPT-MESTRA-LINA-004 não foi encontrada no repositório, conforme já registado na auditoria; não se presumiu o seu conteúdo. Governação e contratos disponíveis prevaleceram.

Antes de editar produção:

- testes binários: 2 falhas intencionais / 83 passes na bateria de 85 testes; ambas as cópias indevidas eram `valid`;
- caracterização de leitura/fencing: 5 falhas intencionais; campo factual ausente e segunda remoção após revogação;
- caracterização de arranque: 1 falha intencional / 5 passes; chamadas observadas eram text → binary, sem recovery;
- typecheck de produção passou antes das alterações.

Estes testes foram mantidos e passaram depois da correção. Não se usaram providers reais nem um vault real.

## 3. Estado factual e validação

`CanonicalPairState` e `inspectCanonicalPair()` residem em embeddingPersistence.ts. A inspeção é pura; o leitor acrescenta os factos de I/O e Resource Guard.

| Facto | Significado / consequência |
|---|---|
| absent | Não existe JSONL nem declaração de embeddings; manifesto apenas textual é aceitável. Não se fabrica publicação. |
| consistent | Os campos existentes e os registos verificáveis são coerentes. Não significa prova criptográfica da origem do JSONL. |
| inconsistent | Membro ausente perante declaração/publicação, contagem divergente, truncagem, registo/identidade/contrato inválido. |
| unreadable | I/O ou manifesto ilegível/JSON inválido; distinto do teto de recursos. |
| resource-limit-exceeded | Recusa deliberada antes de ler o JSONL; conserva a semântica 15C. |
| unverifiable-legacy | Sem publicationId, mas contagem, registos e identidade verificáveis; leitura legada preservada. Não elegível para derivação binária. |

A validação partilha o verificador canónico existente: totalEmbeddings inteiro não negativo, dimensões positivas, vetores válidos, dimensões de cada vetor, chunkIds únicos, identidade provider/modelo e os dois Vector Contracts quando presentes. Os contractIds existentes são verificados pelo validador canónico, incluindo correspondência com embeddingInput. Publicações com publicationId exigem identificador não vazio, input identity válida e newline final; publicações legadas sem identificador conservam a leitura sem newline final. Truncagem numa fronteira de linha é detetada pela contagem declarada. Não foram inventados campos persistidos.

Manifestos sem totalEmbeddings são rejeitados conservadoramente: não há prova de que as linhas sobreviventes constituem uma publicação completa. Isto é mais estrito que a compatibilidade permissiva sugerida em §18.3 da auditoria e segue a instrução final de fail-closed quando falta informação para validar.

## 4. Recovery e ordem de arranque

Percurso real: MaintenanceEngine → ReconciliationWorker → porta runStartupEmbeddingRecovery → host → recoverCanonicalEmbeddingsAtStartup → recovery canónico; depois recovery binário, reconciliação textual e migração/reparo binário existente.

O recovery precede a escrita textual porque uma atualização do manifesto partilhado antes da restauração pode dificultar a identificação do par anterior. A lease existente binary-maintenance é reutilizada como escritor de manutenção; não é uma geração e não contorna o Operation Manager. Se qualquer escritor/reserva existir, o recovery não escreve.

Política implementada:

- par validado é preservado; resíduos conhecidos podem ser limpos;
- restaura o último par de backups validado ou JSONL de backup com manifesto atual correspondente;
- pode restaurar manifesto textual anterior explicitamente sem embeddings após primeira publicação interrompida;
- backups são copiados para os nomes de staging existentes, conservados durante os renames e removidos só após validar a restauração;
- sem backup válido, não apaga o par canónico inconsistente;
- remove apenas temporários conhecidos, sem promover automaticamente um `.tmp`;
- deixa ficheiros desconhecidos intactos e conserva checkpoints retomáveis;
- recusa substituir um canónico acima do Resource Guard ou com erro de I/O por um backup apenas porque este é legível;
- arranque vazio continua sem erro e sem invalidar desnecessariamente trabalho;
- segunda execução produz o mesmo estado final.

A promoção automática histórica de primeira publicação a partir de manifest.publish.tmp foi removida por contrariar a política autorizada para temporários órfãos. O respetivo teste histórico foi atualizado para fixar a nova política.

## 5. Ownership e fencing

O host captura `{producerDeviceId, epoch}` com OwnershipGate e injeta assertCurrent. O recovery usa aquisição explicitamente sem auto-claim. Companion, Standby, unassigned ou ownership ausente não recebem fence e não escrevem.

Cada chamada mutável relevante (`mkdir`, `write`, `writeBinary`, `remove`, `rename`, incluindo retry de rename) volta a validar o mesmo token no manifesto atual. A revogação interrompe o recovery canónico; nenhum rollback/cleanup binário ultrapassa a fence. Se a revogação ocorre entre os renames, os backups completos permitem retomar com uma nova fence autorizada; o estado intermédio não é aceite pelos leitores.

**Retificação explícita da auditoria:** acquireFence() chamava evaluate() e podia herdar auto-claim da configuração da gate. Foi adicionada uma opção à aquisição existente e o recovery/maintenance binário passa `autoClaimIfUnclaimed:false`. A avaliação histórica dos outros chamadores e o modelo de ownership não foram substituídos. assertFence continua sem auto-claim.

## 6. Cópia binária

check/create-update/recovery validam primeiro a publicação canónica verificável. São confrontados sourcePublicationId, totalEmbeddings/recordCount, dimensões, provider/modelo, inputVersion e prefixMode. Os digests SHA-256 e tamanhos dos membros binários continuam verificados pelo storage existente.

recoverBinaryEmbeddingPublication tem chamador de produção através do controller, sob a lease existente e adapter fenced. Só restaura backups correspondentes à publicação atual; um conjunto antigo válido não se torna a cópia atual. Conserva backups até validar a restauração e não promove temporários no percurso de produção. Após provar o canónico, um derivado irrecuperável pode ser descartado e reconstruído pelo fluxo existente, sem tocar em JSONL/manifesto canónico.

O runtime também rejeita contagem/identidade binária divergentes e valida o par pequeno antes de o aceitar; o cache inclui totalEmbeddings na identidade. A primeira carga de uma cópia binária pequena acrescenta uma leitura canónica de validação; pesquisas seguintes reutilizam o cache. Ficheiros acima do teto continuam sem leitura JSONL: o percurso binário 15C exige publicationId, contagem, identidade e digests válidos. O estado factual não passa por isso a consistent. O controller de manutenção devolve unsupported quando o teto impede a prova do par, sem o classificar como corrupção nem reconstruir cegamente.

## 7. Lifecycle e gates existentes

O facto percorre EmbeddingIndexStatus → EmbeddingWorkSummary → adapter → EmbeddingLifecycleSnapshot.info.canonicalPairState. É preservado também no ramo vivo indeterminado do host. O plano central recebe apenas este novo facto, sem alterar a estrutura persistida nem criar outra decisão.

Par inconsistente → full-rebuild / canonical-pair-inconsistent → INCOMPATIBLE no Producer ativo, pesquisa semanticamente fechada e confirmação necessária. Escolheu-se INCOMPATIBLE para permitir o rebuild confirmado existente, após o recovery de arranque tentar restaurar backups; não se criou uma avaliação paralela de backup recuperável na UI. Standby mantém a precedência STANDBY e continua sem capacidade de escrita; Companion mantém isolamento. Nenhum deles apresenta semântica pesquisável para inconsistência conhecida.

Ilegibilidade → INDETERMINATE. Resource limit conserva full-rebuild confirmado / INCOMPATIBLE da 15C, distinto de corrupção. deriveEmbeddingWritePathDecision, Scheduler, Worker e Operation Manager não foram reescritos: os gates existentes recusam dispatch automático de rebuild ou indeterminação. Os testes exercitam a decisão do Scheduler e evaluateOperationStartGate.

## 8. Sincronização e compatibilidade

JSONL primeiro ou manifest primeiro, com divergência verificável, permanece inconsistente até ambos convergirem. Leitura e classificação não escrevem no recetor; não se assume ferramenta de sincronização nem se bloqueia sincronização externa. Não há publicação fabricada a partir de dados parcialmente recebidos.

Reutilizado o publicationId existente. Zero alterações ao formato das linhas JSONL, schema de settings, data.json, manifesto de ownership, providers/settings 15F/15G ou VectorContractV1. Não há identificador por linha, novo coordenador, gate, máquina de estados ou lifecycle paralelo.

## 9. Testes e gates

Cobertura permanente nova/ampliada:

- canonicalPairRecovery: ausência, membros em falta, contagem/truncagem, terminação, dimensões/provider/modelo, duplicados, contrato/input identity, legacy, sincronização em duas ordens, recursos, lifecycle, gates, recovery real no startup, lease, rollback, idempotência, ownership válido/perdido antes/durante, Companion/Standby/unclaimed, não promoção de temporários;
- binary controller/storage: R-02, contagem incoerente, fence revogada entre promoções, recovery do backup correspondente, rejeição do backup de outra publicação;
- runtime: validação do par pequeno antes de aceitar binário e rejeição de contagem incompatível mesmo com digests válidos;
- worker startup: ordem recovery → text → binary;
- fixtures antigos de publicações saudáveis passaram a declarar a contagem realmente existente; testes de incompatibilidade e recursos conservaram as expectativas funcionais.

| Gate | Resultado |
|---|---|
| npm ci | Passou após repetir fora do sandbox (primeira tentativa: spawn EPERM). 412 pacotes; 8 vulnerabilidades reportadas pelo npm, dependências não alteradas. |
| npm test | 161 ficheiros / 2135 testes aprovados. |
| npm run typecheck | Passou. |
| npm run lint:obsidian | Passou. |
| npm run lint:obsidian:strict | Passou, 0 erros / 0 avisos. |
| npm run build | Passou; cópia para test vault desativada. main.js gerado restaurado antes do commit. |
| npm run release-check | Passou, versão 0.3.1. Não constitui execução de release. |
| git diff --check | Passou. |

Vitest continua a emitir o aviso histórico de chave deviceRuntimeState duplicada em embeddingPlanLifecycleReconciliation.test.ts; não é um finding novo nem um aviso ESLint de produção. npm install/audit fix não foram executados.

## 10. Findings residuais e riscos

1. **Identidade física de igual contagem:** o JSONL não tem marcador de publicação nem digest ligado ao manifesto. Dois JSONL de gerações diferentes com a mesma contagem, dimensões e provider/modelo podem satisfazer os contratos existentes. A alternativa A resolve os cenários demonstrados R-02/R-03/R-04 com divergência verificável, mas não prova correspondência criptográfica. Não se apresenta esta limitação como resolvida. jsonlByteLength não bastaria para conteúdo diferente de igual tamanho; optou-se por não adicionar campos parciais nem alterar schema nesta fase.
2. **Acima do Resource Guard:** preservada a semântica 15C; sem leitura JSONL não há prova integral do par. O runtime binário verifica a publicação por campos existentes e digests do derivado, com o mesmo limite de identidade física do ponto anterior. Recovery não substitui/reconstrói cegamente o canónico guardado.
3. **Renames sequenciais:** ainda pode existir um estado físico intermédio se houver crash/revogação. Não é atomicidade distribuída; backups preservados e leitores fechados mitigam-no. Fencing só deteta a transferência quando o manifesto atualizado está observável localmente.
4. **Custo:** inspeção linear do JSONL dentro do limite, incluindo validação adicional da primeira carga binária pequena. Não foi iniciada otimização de arranque/performance nem 15H-C.
5. **Dependências:** npm ci reportou 5 vulnerabilidades moderadas / 3 altas preexistentes. Não houve alteração de dependências nem tratamento fora de âmbito.
6. **Validação interativa:** não executada em Obsidian/mobile reais. Validar num vault de testes descartável: reiniciar Producer com backup de publicação interrompida; verificar restauração e ausência de dispatch automático durante inconsistência; repetir como Companion/Standby e confirmar zero mutações partilhadas; testar um índice saudável e fallback binário guardado.

## 11. Ficheiros e limites deliberados

Produção: main.ts; src/device/ownershipGate.ts; src/index/{embeddingPersistence, embeddingGenerator, embeddingUpdatePlan, embeddingLifecycleAdapter, embeddingLifecycleModel, embeddingWorkStatusController, embeddingBinaryCopyController, embeddingBinaryStorage}.ts; src/maintenance/reconciliationWorker.ts; src/search/runtimeEmbeddingIndex.ts.

Testes: tests/index/{canonicalPairRecovery, embeddingBinaryCopyController, embeddingPersistence}.test.ts; tests/maintenance/{reconciliationWorker, mainRuntimeSnapshotConsolidation}.test.ts; tests/search/{runtimeEmbeddingIndex, semanticAvailabilityStatusConsistency}.test.ts; tests/settings/embeddingConfigurationRuntimeWiring.test.ts. Documentação: este relatório, docs/INDEX.md, AGENTS.md e README.md.

Não foram alteradas notas do vault, gerados embeddings reais, executadas chamadas a providers, guardados dados reais com saveData ou criados comandos. npm ci usou o registry para dependências; isto não é chamada de IA. Não houve migração, redesign, release, push ou alterações da 15H-C. A tarefa exigiu raciocínio arquitetural e análise de concorrência/fencing, acima de uma edição simples adequada a modelo económico.

Commit atómico previsto: `fix(embeddings): recover and validate canonical publication pair`; o hash efetivo é comunicado no relatório final da execução, sem autorreferência circular neste documento.
