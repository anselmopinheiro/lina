# LINA-14A-IMPLEMENT-PURE-LIFECYCLE-MODEL-001

## 1. Análise e Contexto
Na sequência das auditorias LINA-12, LINA-12B, LINA-13 e LINA-14, identificou-se que o Lina possuía múltiplos subsistemas a calcular de forma dispersa a capacidade semântica, necessidade de atualização de embeddings e estado do workflow.

O objetivo da fase **LINA-14A** é criar a camada lógica pura e determinística que serve de fundação para o modelo unificado de ciclo de vida dos embeddings, preparando a integração nas fases seguintes sem alterar o comportamento ativo de produção nem introduzir dependências ou efeitos secundários.

## 2. Decisões Arquiteturais

### 2.1 Modelo Puro e Sem Efeitos Secundários
Criou-se o módulo [`src/index/embeddingLifecycleModel.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts) com isolamento total de dependências:
- Zero dependências de APIs do Obsidian (DOM, Vault, Workspace);
- Zero acesso ao sistema de ficheiros (I/O) ou rede;
- Totalmente determinístico e testável em ambiente unitário.

### 2.2 Comparação Canónica de Identidade (`compareEmbeddingIdentity`)
- Unifica a verificação de compatibilidade entre identidades de embeddings (publicada vs alvo da próxima geração vs contrato do dispositivo).
- Suporta o atalho canónico de igualdade de `contractId` quando ambos os lados dispõem de contrato formal.
- Normaliza provider (case-insensitive) e valida detalhadamente provider, modelo, dimensões, `inputVersion` e `prefixMode`.
- Devolve motivos de divergência tipados (`provider-mismatch`, `model-mismatch`, `dimensions-mismatch`, `input-version-mismatch`, `prefix-mode-mismatch`, `incomplete-identity`).

### 2.3 Classificação Pura de Trabalho (`classifyEmbeddingWork`)
- Classifica de forma factual e determinística a necessidade de atualização:
  - `none`: todos os trechos estão indexados e atualizados, sem publicações de limpeza pendentes.
  - `indeterminate`: índice ilegível ou factos insuficientes.
  - `pending` com modos operacionais específicos:
    - `initial-build`: índice canónico ausente com trechos disponíveis;
    - `full-rebuild`: incompatibilidade estrutural de identidade (provider/modelo/dimensões alterados);
    - `incremental`: trechos novos, alterados ou em falta;
    - `publish-only`: apenas trechos obsoletos a remover ou checkpoints a consolidar (custo zero).

### 2.4 Resolução do Ciclo de Vida e Matriz de Estados Primários (`resolveEmbeddingLifecycle`)
- Produz um `EmbeddingLifecycleSnapshot` unificado com 4 regiões ortogonais:
  - `read`: capacidade e modo efetivo de pesquisa semântica (`full`, `text-only`, `unavailable`);
  - `write`: avaliação de trabalho, severidade, custo e aplicabilidade ao papel do dispositivo;
  - `process`: fases operacionais de execução (`idle`, `checking`, `preparing`, `generating`, `persisting`, `finalizing`, `cancelling`), progresso e cancelabilidade;
  - `history`: registo de última operação, sucesso ou falha;
  - `capability`: autoridade de disparo de atualização e bloqueios por papel ou estado;
  - `upstream`: estado do índice textual upstream;
  - `info`: metadados de publicação e proveniência;
  - `primary`: único estado canónico de apresentação de produto entre os 12 estados formais:
    - `NO_TEXT_INDEX`, `DISABLED`, `INDEX_ONLY`, `VERIFYING`, `READY`, `UPDATE_AVAILABLE`, `INCOMPATIBLE`, `INDETERMINATE`, `UPDATING`, `CANCELLING`, `ERROR`, `STANDBY`.

### 2.5 Resolução do Papel Companion (C1)
- Em dispositivos Companion, `write.applicable` é estritamente `false`, `write.updateRequired` é `false` e `capability.canRequestUpdate` é `false`.
- A pesquisa semântica continua perfeitamente disponível (`read.semanticAvailable = true`, `primary = READY`) com base no contrato herdado.

### 2.6 Verificação de Invariantes Arquiteturais (I1 a I15)
- O módulo inclui o helper `validateLifecycleInvariants()` para validar formalmente que nenhum snapshot produzido viola regras como:
  - `READY` implica ausência de trabalho e semântica disponível (I1);
  - `UPDATE_AVAILABLE` implica trabalho pendente e semântica disponível (I2);
  - `INCOMPATIBLE` implica modo degradado text-only (I3 — Zero Silent Fallback);
  - `persisting` implica `cancellable = false` (I7 — ponto de não retorno);
  - `write.applicable = false` implica bloqueio de pedidos de atualização (I9).

## 3. Ficheiros Criados e Alterados
- **Criados:**
  - [`src/index/embeddingLifecycleModel.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts): Tipos, interfaces e funções puras do ciclo de vida.
  - [`tests/index/embeddingLifecycleModel.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/embeddingLifecycleModel.test.ts): Suíte com 32 testes unitários.
  - [`docs/audits/architecture/LINA-14A-IMPLEMENT-PURE-LIFECYCLE-MODEL-001.md`](file:///d:/_dev/obsidian/lina/docs/audits/architecture/LINA-14A-IMPLEMENT-PURE-LIFECYCLE-MODEL-001.md): Relatório de implementação.
- **Alterados:**
  - [`AGENTS.md`](file:///d:/_dev/obsidian/lina/AGENTS.md): Registo da conclusão da Fase LINA-14A.
  - [`CHANGELOG.md`](file:///d:/_dev/obsidian/lina/CHANGELOG.md): Registo no changelog.
  - [`main.js`](file:///d:/_dev/obsidian/lina/main.js): Build de produção atualizado.

## 4. Testes Executados
A nova suíte `tests/index/embeddingLifecycleModel.test.ts` valida:
- Comparação de identidade com match exato de `contractId`, match campo a campo, case-insensitivity e deteção de todas as divergências;
- Classificação de trabalho para `initial-build`, `full-rebuild`, `incremental`, `publish-only`, `none` e `indeterminate`;
- Resolução do ciclo de vida para todos os 12 estados primários (`NO_TEXT_INDEX`, `DISABLED`, `INDEX_ONLY`, `VERIFYING`, `READY`, `UPDATE_AVAILABLE`, `INCOMPATIBLE`, `INDETERMINATE`, `UPDATING`, `CANCELLING`, `ERROR`, `STANDBY`);
- Isolamento estrito do papel Companion (`write.applicable = false`);
- Validação sistemática de invariantes arquiteturais (I1 a I15).

### Resultados da Validação Global:
- `npm test`: 128 ficheiros de teste / 1732 testes aprovados.
- `npm run typecheck`: Aprovado sem erros (`tsc --noEmit`).
- `npm run lint:obsidian:strict`: Aprovado com 0 erros e 0 avisos.
- `npm run build`: Compilação de produção e cópia para test-vault concluídas.
- `npm run release-check`: Todos os ficheiros e condições de release validados.
- `git diff --check`: Nenhuma anomalia de formatação ou whitespace.

## 5. Limitações
- A Fase LINA-14A cria exclusivamente a fundação lógica pura.
- Não substitui nem altera os fluxos ativos de produção existentes (UI, Sidebar, Workers, Scheduler, etc.), mantendo isolamento total até às fases de integração controladas.

## 6. Próximos Passos (Roadmap LINA-14)
- **LINA-14B (Fact Loader & Shadow Evaluation):** Criar loader unificado de factos (`EmbeddingCorpusFacts`) e avaliação do snapshot em modo shadow.
- **LINA-14C (Coordinator & Subscription):** Criar `EmbeddingLifecycleCoordinator` com suporte a revisões e subscrições.
- **LINA-14D (Presentation Cutover):** Migrar a Sidebar e vistas de diagnóstico para consumir diretamente o `EmbeddingLifecycleSnapshot`.
