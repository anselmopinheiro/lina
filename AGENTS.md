# AGENTS.md

## Descrição do Projeto Lina
O Lina é um plugin para Obsidian que visa fornecer capacidades avançadas de interação com o vault, incluindo leitura segura de ficheiros Markdown, indexação local de metadados e conteúdo, pesquisa simples e pesquisa semântica. O objetivo é criar uma base sólida para futuras integrações com modelos de linguagem (LLMs) e outras funcionalidades de IA, sempre com foco na segurança dos dados do utilizador e compatibilidade mobile.

## Estado Atual do Projeto
* Fase 0 concluída: plugin Obsidian criado, carrega corretamente, comando de teste e settings.
* Fase 1A concluída: leitura segura de ficheiros Markdown do vault.
* Fase 1B concluída: índice local simples de metadados das notas.
* Fase 1C concluída: leitura controlada do conteúdo das notas, excertos, contagem de caracteres e palavras.
* Fase 1D concluída: pesquisa simples no índice local, com modal de pesquisa e abertura da nota selecionada.
* Fase 2A concluída: settings e tipos base para providers de IA.
* Fase 2A.1 concluída: providers previstos expandidos para Ollama, OpenRouter, OpenAI, Claude/Anthropic e Gemini.
* Fase 2B concluída: teste de ligação ao Ollama funcional.
* Fase 2C concluída: teste de embedding com Ollama funcional.
* Fase 2D concluída: geração experimental de embeddings por lote no índice.
* Fase 2E concluída: pesquisa semântica experimental.
* Fase 2F concluída: preservação de embeddings ao reconstruir o índice.
* Fase 2G concluída: tamanho de lote de embeddings configurável.
* Fase 2H concluída: comandos principais normalizados.
* Fase 2I concluída: modal "Estado geral do Lina".
* Fase 2I.1 concluída: modal de estado geral polida.
* Fase 2J concluída: verificação de sincronização do índice.
* Fase 2K concluída: atualização incremental do índice.
* Fase 2L concluída: automação leve e opcional ao iniciar (verificação de sincronização e/ou atualização incremental).
* Fase 3A concluída: teste controlado de geração de resposta com Ollama e modal com atualização assíncrona.
* Fase 3A.2 concluída: modal de resposta IA abre imediatamente com atualização assíncrona, timeout de 60 segundos.
* Fase 3B concluída: índice textual simples em .lina/index/ com metadados e hash de conteúdo.
* Fase 3C concluída: modal de estado do índice textual para visualizar informação do índice.
* Fase 3D concluída: chunking textual simples com sobreposição (overlap) controlada, com filtro de chunks mínimos.
* Fase 3E concluída: filtros de exclusão configuráveis nas definições com tokenização para evitar falsos positivos.
* Fase 3F concluída: integração do índice textual com pesquisa simples.
* Fase 3G concluída: listeners de eventos do vault para atualização automática do índice textual.
* Fase B do slash command `/ask` concluída: resposta da IA pode ser aplicada à nota ativa apenas após confirmação explícita, com validação da nota, da seleção e das exclusões de conteúdo.
* Fase de transparência do slash command `/ask` concluída: o painel mostra origem, nota e dimensão do contexto usado pela IA sem expor excertos do conteúdo.
* Slash command `/tags` concluído: sugere apenas tags a partir da seleção, seleção preservada ou nota atual, com checkboxes e aplicação confirmada à nota ativa.
* Slash command `/yaml` concluído: sugere apenas campos YAML/frontmatter a partir da seleção, seleção preservada ou nota atual, reutilizando o fluxo de aplicação de YAML da análise da nota com confirmação.
* Fase 1 de robustez dos embeddings concluída: operação central single-flight, coordenação com escritores textuais, validação fail-fast, batching sequencial, progresso e cancelamento cooperativo, checkpoints retomáveis, publicação canónica com rollback e cobertura integrada do ciclo completo.
* Fase 2B concluída: estado derivado de embeddings com separação entre validade para pesquisa, reutilização para a próxima geração, checkpoint recuperável e identidade publicada estrita.
* Fase 2C concluída: planeador central de atualização manual de embeddings, com decisão explícita entre criação inicial, atualização incremental e reconstrução completa segura.
* Fase 2D concluída: controlador runtime read-only para detetar trabalho de embeddings após alterações textuais ou publicações de embeddings, com dirty flag, revisão, cálculo lazy, single-flight e subscrição da sidebar sem geração automática.
* Fase 3B concluída: índice runtime de embeddings com vetores em `Float32Array`, carregamento lazy, single-flight, reutilização entre pesquisas e invalidação segura sem alterar o formato JSONL em disco.
* Fase 9K concluída: preparação declarativa principal da settings tab; infraestrutura declarativa desligada da UI ativa.
* Fase 9L concluída: actions assíncronas declarativas preparadas para testes de ligação e operações da cópia binária, com estados tipados, feedback acessível e confirmação destrutiva injetada; modules desligados da tab ativa.
* Fase 9M-C concluída: modelo puro de credenciais com portas tipadas, campo sempre vazio, sem pré-preenchimento, guardar/limpar explícitos, sem exposição do valor guardado, sem migração de schema e sem introdução de `secretStorage`.
* Fase 9N-B2C1 concluída: binding desligado dos testes de ligação de análise/embeddings ao controlador de lifecycle por instância, com pending e invalidation independentes por domínio, neutralização de resultados tardios, feedback técnico seguro e bindings de guardar/limpar credenciais com portas injetadas; sem integração ativa em `display()`, `hide()` ou `getSettingDefinitions()`.
* Fase 9N-B2C2 concluída: binding desligado do runtime binário ao controlador de lifecycle, com domínio único `binary` para exclusividade entre check, create/update e remove, snapshot público seguro, bloqueio de create/update em `legacy-manifest`, confirmação destrutiva injetada para remove, neutralização de resultados tardios e ausência de filesystem/rede/executores concretos no binding; sem integração ativa em `display()`, `hide()` ou `getSettingDefinitions()`.
* Fase 9N-B2D1 concluída: composição declarativa candidata desligada com 12 grupos e 46 itens, derivada do blueprint canónico, com adapter runtime, lifecycle e bindings por instância, `getDiagnosticSnapshot()` seguro e `dispose()` idempotente; sem integração ativa em `display()`, `hide()` ou `getSettingDefinitions()`.
* Fase 9N-B2D3A concluída: composição declarativa candidata evoluída para 36 definitions reais ligadas a controlos, renderers e adapters existentes; 10 itens continuam explicitamente marcados como `MISSING_REAL_BINDING` (credenciais, testes de ligação, feedback e actions/status binários); sem cutover, sem alterações a `display()`, `hide()`, `src/settings.ts` ou `main.ts`.
* Fase 9N-B2D3B1 concluída: factory candidata isolada para renderers/actions de ligação e credenciais, com reutilização exclusiva do `ConnectionCredentialBindings` injetado, drafts locais ao renderer, cleanup por `owner/id`, `dispose()` idempotente, feedback/diagnóstico seguros e sem integração ativa na composição candidata.
* Fase 9N-B2D3B2 concluída: composição declarativa candidata evoluída para 42 definitions reais ligadas a controlos, renderers e adapters existentes (análise e embeddings: credenciais, testes de ligação, feedback); 4 itens continuam explicitamente marcados como `MISSING_REAL_BINDING` (binary-status, check-binary-copy, create-or-update-binary-copy, remove-binary-copy); a composição reutiliza a factory B2D3B1 e o `ConnectionCredentialBindings` existente por instância sem runtime paralelo; invalidação seletiva por domínio, diagnóstico seguro, sem integração ativa em `display()`, `hide()`, `src/settings.ts` ou `main.ts`.
* Fase 9N-B2D3C1 concluída: factory candidata isolada para renderers/actions binários (`src/settings/declarativeSettingsBinaryRenderers.ts`), com reutilização exclusiva do `DeclarativeSettingsBinaryBindings` injetado, expõe renderer de status e actions de check/create-update/remove, traduz snapshot público seguro do binding, inclui pending/feedback/bloqueio `legacy-manifest`, delega confirmação/exclusividade/tokens/invalidation ao binding, sem runtime/binding/lifecycle próprio, sem I/O, sem IDs adicionais, sem `binary-action-feedback`, expõe diagnóstico seguro e `dispose()` idempotente; composição, `src/settings.ts` e `main.ts` inalterados, quatro IDs binários ainda não ligados, contagem 42/4 mantida.
* Fase 9N-B2D3C2 concluída: composição declarativa candidata ligou os quatro IDs binários restantes (`binary-status`, `check-binary-copy`, `create-or-update-binary-copy`, `remove-binary-copy`), com uma única `binaryRenderers` por instância e cadeia composição → factory B2D3C1 → `DeclarativeSettingsBinaryBindings`; sem runtime/binding/lifecycle paralelos, sem I/O direto e sem `binary-action-feedback`; diagnóstico atualizado para 12 grupos, 46 IDs estruturais, 46 definitions reais e 0 `MISSING_REAL_BINDING`; sem integração ativa em `src/settings.ts` ou `main.ts`, sem `getSettingDefinitions()` ativo e sem cutover.
* Fase 9N-B2D4 concluída: auditoria final da composição candidata 47/47 aprovada para harness (`9N-B2D4 APROVADA PARA HARNESS`), com IDs únicos, ordem canónica, ausência de placeholders/IDs extra/`binary-action-feedback`, wiring confirmado dos 47 IDs, ownership por composição de runtime adapters/lifecycle/bindings/factories, ausência de runtime-binding-lifecycle paralelos, persistência e effects centralizados com save queue única e rollback de save, segurança de credenciais, domínio binário exclusivo com `legacy-manifest` e confirmação destrutiva injetada, lifecycle/dispose coerentes e diagnóstico seguro serializável; candidata continua detached sem integração ativa, sem `getSettingDefinitions()` e sem cutover.
* Fase 9N-C1 concluída: harness de testes para observar a execução real de `LinaSettingTab.display()` através de spies/mocks de `Setting`, produzindo manifesto normalizado, determinístico, serializável e seguro; sem reconstruir manualmente a UI, sem efeitos reais, sem valores secretos, sem ativar a candidata e sem alterações de produção. A fase prova observabilidade testável da UI imperativa, não paridade formal, mapping dos 46 IDs nem cutover; a próxima fase é 9N-C3A.
* Fase 9N-C3A concluída: `embeddings-enabled / PARITY-ROLLBACK` e `analysis-provider / PARITY-MUTATION` + `PARITY-SAVE-COUNT` foram adjudicados a favor da candidata; a semântica canónica passa a exigir rollback integral em save falhado, persistência antes de effects, materialização atómica de provider + URL + modelo com preservação de valores customizados, e `mark-embeddings-dirty` apenas após persistência confirmada; a UI imperativa histórica ainda diverge e C3 mantém-se bloqueada até C3B.
* Fase 9N-C3 BLOQUEADA: a cobertura de paridade para controls, persistência e effects comparou callbacks reais da UI imperativa e definitions/renderers reais da candidata, confirmou `device-name` como equivalente (trim, persistência local/device, um save, preservação do outro device) e deixou `embeddings-enabled` com `PARITY-ROLLBACK` e `analysis-provider` com `PARITY-MUTATION`/`PARITY-SAVE-COUNT` por adjudicar; a fase não alterou produção, não ativou `getSettingDefinitions()` e não autoriza C4 antes de C3A.

## Estratégia de Chunking
* Chunking de texto baseado em tamanho (1200 caracteres) com sobreposição (150 caracteres).
* Tamanho mínimo de chunk: 30 caracteres úteis para evitar chunks redundantes.
* Algoritmo garante que chunks no final do texto não criem duplicatas.
* Se text.length <= chunkSize, gera apenas 1 chunk.
* Chunks muito pequenos são filtrados silenciosamente.
* Preferência por terminar chunks em espaços para não partir palavras.

## Estratégia de Indexação
* A indexação é híbrida e controlada.
* Atualizar metadados, excertos e contagens pode ser manual ou opcionalmente automático.
* A geração de embeddings é manual, por lote e explicitamente acionada pelo utilizador.
* Nunca gerar embeddings em massa automaticamente no arranque.
* O plugin pode verificar sincronização ao iniciar se o utilizador ativar essa opção.
* O plugin pode atualizar incrementalmente o índice ao iniciar se o utilizador ativar essa opção.
* Índice textual simples guardado em .lina/index/ (fora do vault de dados de plugin), com manifest.json e notes.json.
* Leitura de conteúdo das notas apenas para calcular hash, sem armazenar conteúdo completo.
* Atualizações automáticas do índice textual por eventos do vault só podem correr quando já existe índice textual válido e completo: `manifest.json`, `notes.json` e `chunks.jsonl` devem existir e ser legíveis. Se o índice estiver ausente, incompleto ou corrompido, o evento automático deve sair sem ler a nota afetada, sem escrever em `.lina/index/` e sem tentar reconstruir.
* Vault events used for automatic indexing must be validated, filtered, coalesced and processed in single-flight mode.
* Internal writes under `.lina` or the Obsidian configuration folder must never trigger automatic indexing.
* The full text index must not be loaded during Obsidian startup.
* Eventos `modify` do índice textual devem usar debounce independente por caminho de nota; um ficheiro modificado não pode cancelar o debounce pendente de outro ficheiro. O debounce apenas controla a entrada na fila existente, sem substituir coalescing, batches ou single-flight.
* Após o período de arranque, quando a atualização automática está ativa e já existe um índice textual, o Lina deve comparar deterministicamente os metadados atuais do Vault com `notes.json`, agregar apenas notas novas, alteradas ou removidas na fila existente e processar essas diferenças num único batch antes de marcar as atualizações automáticas como prontas. Esta reconciliação não pode criar o primeiro índice nem depender da ordem dos eventos do Vault.
* Uma versão candidata do índice textual só pode substituir `indexedNotes`, `indexedChunks` e `textIndexLoaded` depois de `saveTextIndex()` confirmar persistência bem-sucedida. Se a gravação falhar, o último estado confirmado deve permanecer ativo em memória e no disco, sem bloquear batches automáticos posteriores.
* A leitura de `.lina/index/notes.json` deve ser defensiva: verificar ficheiro ausente, vazio ou conteúdo vazio antes de `JSON.parse`, apanhar JSON inválido com `console.warn` sem lançar exceção fatal, evitar spam repetido e tratar o índice como indisponível até reconstrução quando não for possível carregar as notas.
* A leitura de `.lina/index/chunks.jsonl` deve ser defensiva: verificar `stat.size` antes de `adapter.read`, recusar ficheiros acima do limite seguro, fazer parsing JSONL linha a linha, ignorar linhas inválidas e limitar o número de chunks carregados em memória.
* Reconstruções manuais longas do índice textual devem processar notas por lotes e ceder tempo ao renderer entre lotes. O cancelamento ou erro não pode publicar um índice parcial nem substituir o índice válido anterior. A primeira criação do índice continua sempre manual.
* Escritores persistentes do índice devem ser mutuamente exclusivos: reconstrução textual, batches automáticos textuais e geração persistente de embeddings não podem publicar `manifest.json`, `notes.json`, `chunks.jsonl` ou `embeddings.jsonl` em simultâneo. Eventos do Vault recebidos durante a geração de embeddings devem permanecer na fila existente e retomar depois da libertação dessa exclusividade.
* A geração persistente de embeddings deve validar a configuração e o provider com até três chunks reais antes de iniciar o ciclo completo. Falhas globais de configuração, ligação, timeout, autenticação, modelo ou resposta/vetor inválido devem interromper rapidamente a operação e não podem ser repetidas para todos os chunks. Falhas formalmente específicas do input podem avançar para o candidato seguinte. O fallback do Ollama para `/api/embeddings` só deve ocorrer perante incompatibilidade comprovada do endpoint/formato de `/api/embed`, não perante falhas de rede, timeout, configuração ou modelo inexistente.
* A geração persistente de embeddings deve expor progresso real através do gestor central de operações e suportar cancelamento cooperativo por uma única API central. O cancelamento deve passar por `cancelling` antes de `cancelled`, impedir novos chunks, preservar a exclusividade de escrita até ao fim seguro da operação, retomar a fila textual e nunca ser apresentado como falha. Um pedido HTTP já iniciado por `requestUrl` pode ter de terminar ou atingir timeout antes do estado terminal.
* O ponto de não retorno da geração persistente de embeddings é a entrada em `persisting`: depois de iniciada a publicação integral de `embeddings.jsonl` e atualização coerente do manifesto, a escrita crítica deve terminar e, se terminar com sucesso, a operação deve ser apresentada como concluída, não cancelada.
* A geração persistente deve ler `embeddingBatchSize` uma única vez por operação, normalizá-lo para um inteiro entre 1 e 50 sem alterar a setting guardada e dividir `toGenerate` em lotes contíguos e determinísticos. Os lotes são sempre sequenciais, sem paralelismo, e o progresso continua a ser contabilizado por chunk.
* Mistral e o endpoint moderno `/api/embed` do Ollama podem usar batching nativo. Quando a validação escolher o endpoint legado `/api/embeddings`, a operação deve fixar o modo legado, usar tamanho efetivo 1 e não voltar a testar `/api/embed` em cada chunk.
* Apenas erros formalmente específicos do input podem subdividir um lote, sempre por metades determinísticas e sequenciais até ao caso unitário. Falhas globais, respostas incompletas, associações ambíguas, vetores inválidos ou dimensões incompatíveis devem interromper imediatamente a operação. O batching não altera `embeddings.jsonl`, o manifesto nem a política de persistência.
* Resultados válidos de lotes concluídos devem ser guardados num checkpoint recuperável antes de serem apresentados internamente como preservados. Cancelamento ou falha global antes de `persisting` não pode substituir o índice canónico; uma operação posterior só pode reutilizar registos compatíveis por `chunkId`, `textHash`, provider, modelo, dimensão, versão/formato do input e `embeddingInputHash` recalculado.
* A pesquisa lê exclusivamente `embeddings.jsonl`. Os ficheiros `embeddings.checkpoint.jsonl` e `embeddings.checkpoint.meta.json` são estado parcial interno, não um índice alternativo nem um backup do canónico.
* A publicação canónica de embeddings deve preparar e validar `embeddings.publish.tmp` e `manifest.publish.tmp`, preservar os canónicos anteriores em `embeddings.publish.backup` e `manifest.publish.backup`, publicar o manifesto apenas depois dos embeddings e executar rollback explícito perante falha crítica. O checkpoint só pode ser removido depois do sucesso integral.
* Os temporários/backups internos de checkpoint (`embeddings.checkpoint.tmp`, `embeddings.checkpoint.meta.tmp`, `embeddings.checkpoint.backup`, `embeddings.checkpoint.meta.backup`) e publicação são nomes determinísticos confinados a `.lina/index/`. A recuperação só pode tratar estes nomes conhecidos, deve ser idempotente e nunca remover ficheiros desconhecidos. Estes ficheiros não devem ser editados manualmente.

## Comandos Atuais do Plugin
* Lina: testar plugin
* Lina: analisar vault
* Lina: reconstruir índice
* Lina: atualizar índice
* Lina: verificar sincronização do índice
* Lina: estado do índice
* Lina: pesquisar no índice
* Lina: testar ligação ao Ollama
* Lina: testar embedding
* Lina: gerar embeddings
* Lina: estado dos embeddings
* Lina: pesquisa semântica
* Lina: estado geral
* Lina: testar resposta IA
* Lina: reconstruir índice textual
* Lina: mostrar estado do índice

## Estratégia de Exclusão do Índice
* Exclusões por pasta: comparação exata do prefixo do caminho, sem distinguir maiúsculas/minúsculas.
* Exclusões por termo no caminho: tokenização do caminho para evitar falsos positivos (ex: "senha" dentro de "desenhada").
* Termos compostos (ex: "api key", "palavra-passe") são normalizados e comparados contra o caminho normalizado.
* Pastas .lina/ e .obsidian/ são sempre excluídas internamente, independentemente da configuração.
* As definições de exclusão são guardadas em texto multilinha nas settings do plugin.

## Regras Gerais para IA/Cline/Codex

### Pesquisa textual independente da pesquisa semântica
A pesquisa textual deve manter-se disponível e independente da pesquisa semântica. A pesquisa semântica deve ser adicionada como modo complementar, não como substituição. Os comandos de pesquisa textual não devem ser removidos quando a pesquisa semântica for implementada.

### Pesquisa híbrida como modo principal
A pesquisa híbrida deve ser o modo principal de pesquisa do Lina, mantendo a pesquisa textual e a pesquisa semântica disponíveis para comparação.

### Ranking textual
A pesquisa textual deve privilegiar correspondências de palavra completa acima de prefixos e substrings parciais. Correspondências parciais continuam permitidas para descoberta, mas devem ter peso menor. Matches em título/nome, headings e metadados/tags Markdown devem receber boost claro em relação ao corpo normal.

### Notas linkáveis
As sugestões de notas linkáveis devem partir de candidatos reais do índice/pesquisa, sem permitir que a IA invente caminhos. A proximidade de pasta pode ajudar no ranking, mas não deve eliminar automaticamente bons candidatos de outras pastas. A própria nota, notas já linkadas no conteúdo atual e duplicados por path devem ser removidos antes de passar candidatos para a IA.

### Análise em lote por pasta
Fluxos de análise em lote devem reutilizar a recolha genérica de notas por pasta e respeitar exclusões por caminho e por conteúdo antes de enviar conteúdo a providers de IA. A Inbox deve usar a mesma recolha genérica, sem subpastas por defeito.
Metadados preservados globais só podem vir de análises individuais; análises em lote devem manter sugestões YAML/tags por nota/cartão e nunca agregá-las numa lista global aplicável à nota ativa.
Análise individual simples e análise com notas relacionadas são scope `single-note`; Inbox e análise por pasta são scope `batch`.
Análises batch podem preservar metadados por `path` para a nota ativa correspondente, mas nunca de forma agregada; a aplicação desses metadados deve ser bloqueada se a nota ativa não for exatamente a nota de origem.

### Vista lateral como interface principal de pesquisa
A pesquisa principal do Lina deve usar uma vista lateral; as modais antigas podem permanecer temporariamente para comparação ou diagnóstico.

### Vista lateral orientada por estado
A vista lateral do Lina deve orientar o utilizador quando o índice ou os embeddings estão em falta, oferecendo ações diretas no painel.

### Vault Enumeration e Privacidade
A enumeração do vault é aceitável no Lina porque é funcionalmente necessária à indexação e pesquisa:
- A indexação principal enumera apenas ficheiros Markdown usando `vault.getMarkdownFiles()`.
- O plugin respeita exclusões configuradas pelo utilizador (pastas e termos no caminho).
- O índice local é armazenado em `.lina/` dentro do vault.
- O plugin não envia conteúdo de notas para serviços externos sem configuração explícita e ação explícita do utilizador.
- Qualquer alteração futura que mexa em privacidade, rede ou armazenamento deve atualizar README e AGENTS.

### Documentação em português (legada)
- `README.md` e o manual em inglês (`docs/manual.md`) são os documentos ativos e devem continuar a ser mantidos.
- `README-pt.md` e o manual em português (`docs/manual-alfa.md`) são ficheiros legados e desatualizados; não devem ser atualizados em tarefas futuras.
- A única alteração permitida nesses ficheiros é manter ou corrigir o aviso de desatualização no início absoluto de cada ficheiro.
- Documentação funcional nova deve ser escrita ou atualizada exclusivamente nos ficheiros em inglês.
- Não remover os ficheiros portugueses sem decisão explícita do responsável pelo projeto.

### Armazenamento Local
- Não usar `localStorage`, `sessionStorage`, `globalThis.localStorage` ou `globalThis.sessionStorage`.
- Usar `loadData()` / `saveData()` para persistência de configuração do plugin (data.json).
- O índice operacional pesado (notas, chunks, embeddings) pode continuar armazenado em `.lina/` no vault.
- Dados locais pequenos (perfil de IA ativo, chaves API, configuração por dispositivo) devem ser persistidos como campos em `LinaSettings` e `DEFAULT_SETTINGS`, guardados via `loadData()`/`saveData()` no ficheiro `data.json` do plugin. Este ficheiro é sincronizável entre dispositivos. Se for necessário lidar com configurações por dispositivo que NÃO devem sincronizar, deve ser desenvolvido um mecanismo adequado com um identificador de dispositivo.

### Leitura Obrigatória
Antes de qualquer alteração no código, é **obrigatória** a leitura dos ficheiros de orientação relevantes (`docs/agents/*.md`) para garantir o alinhamento com a arquitetura e as melhores práticas do projeto Lina.

### Entrada contextual e slash commands
Na vista lateral, texto sem barra deve continuar a executar pesquisa normal. Entradas começadas por `/` são comandos explícitos em inglês e não devem disparar pesquisa acidental. Slash commands que enviem conteúdo a providers de IA devem limitar o contexto ao texto selecionado ou à nota atual, respeitar exclusões configuradas e nunca modificar notas sem confirmação explícita.
Comandos contextuais que usem texto selecionado devem capturar e validar a seleção da nota ativa antes de o foco na sidebar a limpar, e nunca reutilizar seleções pertencentes a outra nota.
Antes de qualquer chamada a provider de IA, o contexto final escolhido para um slash command deve ser revalidado contra `indexExcludedContentContains`; se corresponder, a chamada deve ser bloqueada sem construir prompt com esse conteúdo.
Aplicar respostas de `/ask` à nota deve manter o botão de cópia e exigir confirmação explícita. Antes de escrever, o Lina deve revalidar que a nota ativa é a nota de origem, que a seleção guardada ainda corresponde ao conteúdo quando a ação depende dela, e que o conteúdo atual da nota não corresponde a `indexExcludedContentContains`. Se não houver seleção válida, a aplicação permitida deve ser inserção no fim da nota.
O painel do `/ask` deve mostrar metadados seguros do contexto usado (origem, nota e dimensão aproximada), mas não deve mostrar excertos do conteúdo da nota/seleção apenas para fins de transparência.
O slash command `/tags` deve reutilizar o mesmo fluxo seguro de contexto dos comandos contextuais, sugerir apenas tags, mostrar checkboxes, aplicar apenas tags selecionadas, não duplicar tags existentes e nunca gerar YAML, links, tarefas, pasta, título ou análise geral.
O slash command `/yaml` deve reutilizar o mesmo fluxo seguro de contexto dos comandos contextuais e o sistema de YAML/frontmatter da análise da nota. Deve sugerir apenas campos YAML permitidos, permitir aplicar apenas campos selecionados, não sobrescrever campos existentes sem validação, não duplicar campos e nunca gerar tags, links, tarefas, pasta, título ou análise geral.

### Limitação de Exploração
Não é permitido explorar o projeto inteiro de uma só vez. A leitura e análise de ficheiros deve ser limitada aos poucos ficheiros relevantes para a tarefa em questão, de forma a manter o foco e evitar dispersão.

### Identificação do Domínio da Tarefa
Antes de iniciar qualquer tarefa, o agente deve identificar a que domínio pertence:
* Indexação (vault, metadados, excertos, contagens, sincronização)
* Embeddings (geração, preservação, modelos)
* Pesquisa (simples, semântica)
* Provider de IA (Ollama, OpenRouter, OpenAI, Anthropic, Gemini)
* UI (modals, notices, definições, comandos)
* Segurança das notas (leitura, escrita, confirmação)
* Documentação (agents, README)

### Não Alterar Notas do Vault
Sob nenhuma circunstância o plugin ou o agente devem alterar, criar ou apagar notas no vault do utilizador sem autorização explícita e um mecanismo de confirmação rigoroso.

### UI e diagnóstico de embeddings
A UI e as mensagens de diagnóstico não devem descrever embeddings como locais quando o provider selecionado pode ser remoto (ex: Mistral). Botões, toasts e mensagens de erro devem usar linguagem neutra ("Gerar embeddings", "Atualizar embeddings") em vez de "embeddings locais". Erros de geração de embeddings devem incluir diagnóstico seguro com provider, modelo, endpoint e status HTTP, sem expor chaves API nem conteúdo de notas.

### Atualização incremental de embeddings
A atualização de embeddings deve ser incremental. O calculador central em `src/index/embeddingState.ts` é a referência para classificar `missing`, `valid`, `stale` e `obsolete`, e para decidir `reusableForNextGeneration`. A validade publicada para pesquisa (`validForSearch`) não muda apenas porque a configuração local seguinte escolheu outro provider ou modelo. A pesquisa semântica exige identidade de espaço estrita (provider, modelo, dimensão, formato/prefixo e hashes compatíveis), não apenas dimensão igual; registos stale, inválidos, duplicados ou obsolete são excluídos. Checkpoints permanecem recuperáveis, não canónicos e não pesquisáveis. Em caso de erros durante a geração (incluindo 429 rate limit), preservar o progresso parcial e não descartar embeddings já gerados com sucesso antes do erro.
O planeador central em `src/index/embeddingUpdatePlan.ts` é a referência para decidir `initial-build`, `incremental` ou `full-rebuild` numa ação manual. `incremental` só pode preservar registos canónicos reutilizáveis quando a identidade publicada completa coincide estritamente com a identidade alvo resolvida. Mudanças de provider, modelo, dimensão, versão/formato do input, modo de prefixo, manifestos incompletos ou canónicos com identidade incompatível exigem `full-rebuild`, sem transportar vetores canónicos antigos para a publicação seguinte. Checkpoints compatíveis podem ser reutilizados em qualquer modo, mas nunca alteram a decisão do modo nem são pesquisáveis. Obsoletos só são removidos durante uma publicação segura.
O controlador runtime em `src/index/embeddingWorkStatusController.ts` apenas gere estado derivado em memória para indicar trabalho de embeddings disponível. Invalidações por índice textual, embeddings, checkpoint ou settings são O(1), não escrevem em `.lina`, não criam sidecars, não chamam providers e não geram embeddings. O cálculo exato é read-only, lazy, single-flight e protegido por revisão; sem consumidores ativos deve permanecer `unknown`/`dirty` até pedido explícito. `pending` continua reservado para trabalho selecionado por uma operação ativa, nunca para chunks simplesmente `missing` ou `stale`.
Todas as operações persistentes que geram ou atualizam `embeddings.jsonl` devem passar por um gestor central pertencente a `LinaPlugin`, com estado partilhado e single-flight global. Comando, sidebar e restantes pontos de entrada persistentes não podem manter flags de execução independentes nem iniciar gerações concorrentes do índice de embeddings.

### Índice Runtime de Embeddings (Fase 3B)
* A persistência canónica de embeddings continua em JSONL (`embeddings.jsonl`). O formato em disco não é alterado.
* `Float32Array` é exclusivamente runtime: a representação residente dos vetores é convertida para `Float32Array` contíguo; cada registo canónico permanece como `number[]` em JSONL.
* O cache runtime (`RuntimeEmbeddingIndexCache`) não é fonte canónica. A fonte canónica de verdade continua a ser `embeddings.jsonl`.
* O carregamento é lazy: o índice runtime só é construído quando `getOrLoad()` é chamado, normalmente durante a primeira pesquisa semântica ou híbrida.
* O carregamento usa single-flight: múltiplos pedidos concorrentes partilham a mesma operação de carga.
* O índice runtime não é carregado durante o startup do Obsidian nem durante a abertura da sidebar. A sidebar só lê o estado derivado do `EmbeddingWorkStatusController`, que não depende do índice runtime.
* O índice runtime não conserva `number[]` residentes após construção: os vetores originais de cada `EmbeddingRecord` são copiados para `Float32Array` e os metadados do registo não incluem o vetor.
* A pesquisa semântica usa apenas registos `validForSearch` do índice runtime, filtrados pelo mesmo `calculateEmbeddingState` usado pelo resto do sistema.
* A pesquisa híbrida mantém a componente textual separada e funcional; se o índice runtime não estiver disponível ou for incompatível, a pesquisa híbrida cai para apenas texto.
* Publicação canónica, rollback e recuperação de embeddings invalidam o cache runtime.
* Alterações textuais que tornem chunks `stale` ou `obsolete` invalidam o cache runtime, mas não o recarregam automaticamente.
* `dispose()` liberta o índice runtime e impede novas operações.
* Não existe polling: a invalidação é acionada por eventos conhecidos (publicação canónica, rollback, alteração textual, unload).
* A sincronização externa (ex: Syncthing) que altere `embeddings.jsonl` ou `manifest.json` é tratada de forma conservadora: se a identidade de source (`sourceIdentity`) mudar entre chamadas `getOrLoad()`, o cache é recarregado. Não existe deteção automática de alterações externas.
* Formato binário nativo e memory mapping pertencem a fases futuras e não estão implementados.
* Mobile: o carregamento lazy e a ausência de polling mantêm o consumo de memória controlado. O cache não persiste entre reinícios. A primeira pesquisa num dispositivo móvel pode demorar mais por ter de carregar e converter o JSONL.

### Cópia Binária Experimental (Fase 3E)
* JSONL e checkpoint continuam canónicos. A cópia binária (`embeddings.binary.manifest.json`, `embeddings.meta.jsonl`, `embeddings.vectors.f32`) é derivada do JSONL canónico e mantida adicionalmente.
* A cópia binária é experimental e opt-in; não é formato canónico.
* Existem duas opções visíveis nas settings, específicas por dispositivo e persistidas em `deviceSettingsById`: `maintainBinaryEmbeddingCopy` (booleano, `false` por defeito) e `embeddingStorageReadPreference` (`"jsonl"` ou `"prefer-binary"`, `"jsonl"` por defeito).
* A manutenção (`maintainBinaryEmbeddingCopy`) não cria a cópia imediatamente. Solicita uma shadow copy apenas depois de uma futura publicação JSONL válida.
* `maintainBinaryEmbeddingCopy` não pode ser ativada por defeito e não pode escrever fora do fluxo canónico validado.
* O `BinaryEmbeddingCopyController` gere o ciclo da cópia derivada: `maintainAfterCanonicalPublication()` é chamado após publicação JSONL, faz deduplicação por `publicationId`, e trabalho substituído termina como `superseded/outdated`.
* A publicação binária (`BinaryEmbeddingPublisher`) é transacional: escreve temporários, valida temporários, cria backup canónico, publica vetores/metadados/manifesto nessa ordem e executa rollback explícito em falha.
* O manifesto binário exige `byteOrder: "little-endian"`, `numericType: "float32"` e checksums `sha256` para metadados e vetores.
* A preferência de leitura (`embeddingStorageReadPreference`) só aceita a cópia binária quando o trio está completo, válido, e o `sourcePublicationId` coincide exatamente com o `publicationId` do manifesto JSONL canónico atual.
* O runtime opera em dual-read seguro: tenta binário quando elegível e recorre a JSONL quando binário está ausente, inválido, incompleto ou desatualizado e o JSONL for seguro.
* O fallback nunca pode iniciar uma leitura que exceda guardrails de memória. Perfis desktop/mobile usam limites distintos e conservadores.
* O estado `no-safe-source` deve bloquear segunda tentativa previsivelmente perigosa (binário inseguro + JSONL inseguro).
* O parser JSONL para estimativa real deve contar registos por conteúdo útil (evitando falso positivo por newline final) antes da validação de pico real.
* O `RuntimeEmbeddingIndexCache.getOrLoad()` considera `publicationId` e `storageFormat` como parte da identidade do cache. Uma cópia binária antiga ou desatualizada nunca entra no cache runtime.
* O cache runtime mantém vetores em `Float32Array`, com carregamento lazy, single-flight, invalidação explícita e sem polling.
* `dispose()`, mudança de preferência e lifecycle devem impedir publicação tardia de resultados e suportar retry posterior.
* O diagnóstico runtime (`EmbeddingReadDiagnosticState`) é transitório e não é fonte de verdade: armazena preferência configurada, fonte efetiva da última leitura, motivo de fallback, `canonicalPublicationId`, `binarySourcePublicationId`, contagens, duração de carga e estado de cache.
* Abrir settings não pode forçar carregamento de embeddings. Settings são passivas.
* Falhas da shadow copy (escrita, digest, validação) não transformam a publicação JSONL em falha.
* O checkpoint (`embeddings.checkpoint.jsonl`, `embeddings.checkpoint.meta.json`) nunca é alterado pela manutenção binária. JSONL nunca é apagado.
* No mobile, a manutenção automática deve permanecer desligada no cenário recomendado; criar/atualizar a cópia no desktop e sincronizar.
* Desktop e Android foram validados manualmente para a fase.
* iOS ainda não foi validado manualmente.
* Validações futuras devem continuar a separar explicitamente cenários desktop, Android e iOS.
* É proibido tornar o binário canónico, remover JSONL canónico ou remover o fallback JSONL sem fase explícita aprovada e validada.

### Invariantes obrigatórios da Fase 3E
1. JSONL é sempre a fonte canónica.
2. Binário nunca substitui o JSONL.
3. Binário só pode ser lido quando corresponde à publicação JSONL atual.
4. Nenhum fallback pode iniciar uma leitura que exceda os limites de memória.
5. Settings são passivas.
6. A preferência e a manutenção da cópia são por dispositivo.
7. Falhas binárias não invalidam um JSONL válido.
8. Nenhum resultado parcial entra no cache.

### Compatibilidade Mobile e APIs
Não usar APIs exclusivas de desktop (Node.js/Electron) se a funcionalidade tiver de ser compatível com mobile, a menos que haja autorização explícita para implementar uma funcionalidade *desktop-only*.

### Sincronização entre dispositivos (Syncthing)
Nas tarefas que envolvam documentação, configuração ou comportamento do Lina com sincronização entre dispositivos:
- Nunca recomendar excluir `.lina/` da sincronização quando o objetivo for o dispositivo móvel consumir o índice textual e os embeddings gerados no PC.
- Manter sempre a distinção clara entre: (1) pasta de configuração do Obsidian (`.obsidian/`), (2) pasta do plugin Lina (`.obsidian/plugins/lina/`), (3) pasta de índice e embeddings do Lina (`.lina/`).
- Preservar o modelo "PC produtor / mobile consumidor": o PC gera o índice e embeddings; o mobile consome-os via sincronização.
- O plugin Lina deve ser instalado localmente em cada dispositivo (Community Plugins), nunca distribuído por sincronização.
- As settings do Lina (provider, modelo, API keys, timeout) são por dispositivo e, na configuração recomendada, não são partilhadas porque a pasta `.obsidian/` está excluída da sincronização.
- Documentar que o ficheiro `.stignore` do Syncthing pode conter `/.obsidian*`, `/.trash/`, `*.tmp` e `*.sync-conflict-*` para o cenário recomendado.
- Explicar que `data.json` não sincroniza se `.obsidian/` estiver excluído da sincronização, em vez de afirmar "data.json não sincroniza por defeito" de forma absoluta.

### Pendência da API declarativa de Settings
A aba de definições do Lina ainda usa renderização imperativa através de `PluginSettingTab.display()`. Embora esta API esteja marcada como deprecated a partir do Obsidian 1.13.0, a migração para `getSettingDefinitions()` exige uma fase própria porque a UI atual combina secções condicionais, botões assíncronos, elementos HTML customizados e configurações por dispositivo. Não fazer uma migração parcial ou oportunista: quando for tratada, deve ser planeada como refactor específico da UI de settings, preservando textos, comportamento e compatibilidade mobile.

#### Estado da migração declarativa
- O inventário estrutural preparatório atual do blueprint é 47/47 (`complete: true`) e inclui correspondentes explícitos para `autoUpdateIndexOnFileChanges` e `maxSuggestedTags`.
- `complete: true` no blueprint significa apenas preparação completa dos descritores declarativos, não settings declarativas ativas.
- `complete: true` indica apenas cobertura estrutural do inventário conhecido.
- Não significa cutover concluído nem paridade validada na UI real.
- Não prova bindings de produção, lifecycle por instância, side effects, paridade visual nem autorização para cutover.
- `display()` continua a implementação ativa até uma fase de integração explícita e aprovada.
- `getSettingDefinitions()` não pode ser ativado incidentalmente nem por migração parcial.
- `complete: true` só é aceitável quando todos os elementos ativos de `display()` têm correspondente explícito no blueprint.
- A contagem do blueprint deve ser comparada com o inventário real da UI imperativa ativa.
- Novos controlos adicionados a `display()` exigem atualização simultânea do inventário declarativo e dos testes de cobertura/paridade.
- Um elemento ativo sem nó declarativo invalida qualquer alegação de paridade completa.
- Descritores ou adapters preparados não substituem prova de comportamento em runtime.
- Antes do cutover, é obrigatório executar inventário de paridade e manter evidência auditável.

#### Composição declarativa candidata

- Cada composição candidata representa uma futura instância da settings tab; o seu adapter runtime, lifecycle controller e bindings pertencem a essa instância e não podem ser partilhados globalmente.
- A composição deriva do blueprint canónico; não manter uma segunda lista manual divergente de IDs; validar sempre 12 grupos, 47 itens, IDs únicos e ordem canónica; qualquer novo controlo adicionado a `display()` exige atualização simultânea do blueprint, da composição e dos testes de paridade.
- `getDiagnosticSnapshot()` devolve apenas informação estrutural e estado público seguro; nunca inclui snapshots persistidos completos, hosts, drafts, credenciais, paths absolutos, erros brutos ou objetos runtime internos; deve ser serializável.
- Construir a composição não executa render, actions, save, effects, rede ou I/O; os imports do módulo não podem ter side effects; a composição permanece fora do bundle ativo até integração explícita.
- 47/47 prova apenas cobertura estrutural; não prova paridade comportamental, efeitos, visibilidade, estado disabled, cleanup ou UX; não autoriza `getSettingDefinitions()` nem cutover.
- A prontidão de cada item deve distinguir explicitamente: structurally present, real definition bound, missing real binding, blocked.
- Estado atual da composição candidata: **47 definitions reais** ligadas a controlo/renderer/action existente; **0 itens `MISSING_REAL_BINDING`**. As quatro definitions binárias (`binary-status`, `check-binary-copy`, `create-or-update-binary-copy`, `remove-binary-copy`) estão ligadas na candidata. O blueprint não contém `binary-action-feedback`; não introduzir esse item sem aprovação explícita.
- Cada definition candidata deve estar ligada a control, renderer ou action real; read/write/save/effects devem passar pelos adapters e ports já definidos; não são permitidos writes diretos em settings nem calls diretas a `saveSettings()` ou `saveData()`; labels, descriptions, placeholders, options, `visible`, `disabled`, cleanup e i18n fazem parte da paridade funcional e devem estar presentes antes do cutover.
- Definitions candidatas não podem ser registadas na tab ativa antes de concluído o harness de paridade e a auditoria pré-cutover.

#### Limite pré-cutover (Fase 9N-B2D4)

- 47/47 definitions reais significa composição candidata estruturalmente completa e todos os IDs estruturais com binding real.
- A decisão final desta fase é: **9N-B2D4 APROVADA PARA HARNESS**.
- Esta aprovação significa apenas que a arquitetura candidata está estável para comparação sistemática com a UI imperativa.
- Não significa paridade comportamental final, harness concluído, settings declarativas ativas ou cutover autorizado.
- Não existe `getSettingDefinitions()` ativo; `display()` continua a implementação ativa.
- Não existe integração na tab ativa nem cutover; a UI imperativa continua inalterada.
- Próxima fase: **9N-C3B — Reconciliar rollback de save e materialização persistida dos effects de provider**.

#### Harness de paridade da UI imperativa (Fase 9N-C1)

- A fonte de verdade imperativa é a execução real de `LinaSettingTab.display()`; o harness não pode reconstruir manualmente uma lista de settings nem derivá-la do blueprint candidato.
- Manter a instrumentação em testes sempre que possível. O harness observa a API `Setting` e helpers realmente usados por `display()`, sem alterar a UI de produção, ativar a candidata declarativa, criar tab paralela ou fazer cutover.
- O manifesto imperativo é uma representação de teste determinística, serializável e baseada apenas em informação observável. Pode conter ordem, secção inferível, nome, descrição, tipo de controlo, `disabled`, `visible`, metadados de controlo (`inputType`, presença de valor inicial, presença de placeholder), presença de `onChange`/`onClick` e label segura de action.
- O manifesto nunca contém funções, callbacks reais, DOM, `App`, `Plugin`, `Vault`, snapshots de host, valores de inputs, credenciais, headers `Authorization`/`Bearer`, paths absolutos ou erros brutos. `SUPER_SECRET_SENTINEL` é exclusivamente um sentinel de teste e nunca pode entrar no manifesto, JSON ou logs.
- O harness não executa callbacks de alteração ou action nesta fase: pode observar a sua presença como metadado, mas deve bloquear `saveSettings`, `saveData`, rede, filesystem, vault, providers, ações binárias e persistência reais.
- Execuções equivalentes devem gerar o mesmo manifesto; instâncias do harness não podem partilhar estado capturado e não podem depender do vault real.
- A 9N-C1 não atribui artificialmente os 46 IDs candidatos aos itens imperativos. A correspondência formal e a comparação de estrutura/conteúdo pertencem exclusivamente à 9N-C2; não criar mappings inventados que escondam divergências futuras.
- O harness deve manter um guard rail negativo: o caminho imperativo não pode importar `declarativeSettingsCandidateComposition`; se importar, o teste deve falhar.
- **9N-C1 CONCLUÍDA** significa apenas que a UI imperativa pode ser observada de forma segura, determinística e testável. Não significa paridade provada, 46 IDs mapeados, settings declarativas ativas, `getSettingDefinitions()` ativo ou cutover autorizado.

#### Auditoria final B2D4 (pré-harness)

- Auditoria confirmou wiring dos 46 IDs, IDs únicos, ordem canónica preservada, ausência de placeholders e ausência de IDs extra.
- Auditoria confirmou ausência de `binary-action-feedback`.
- Auditoria confirmou ownership por composição e ausência de runtimes/bindings/lifecycles paralelos.
- Persistência e effects permanecem centralizados nos runtime adapters, com save queue única, rollback de save e effects apenas após save bem-sucedido.
- Credenciais continuam redigidas no estado público e drafts permanecem renderer-local.
- Análise e embeddings mantêm domains independentes; binário mantém domínio exclusivo `binary`.
- `legacy-manifest`, confirmação destrutiva injetada para remove, cancelamento inerte e ausência de check extra pós create/update permanecem preservados.
- Lifecycle por instância, cleanup e `dispose()` idempotente permanecem coerentes.
- Diagnóstico e feedback permanecem serializáveis e seguros.
- Integração negativa permanece confirmada (`src/settings.ts`/`main.ts`/`getSettingDefinitions()`/cutover inativos).
- Validação final da auditoria: testes focados verdes (10 ficheiros / 82 testes) e suíte completa verde (45 ficheiros / 614 testes).

#### Bloqueios pré-cutover
- Não ativar `getSettingDefinitions()` enquanto existirem controlos ativos omitidos no blueprint.
- Não remover `display()` antes de adapters de produção, validação de lifecycle e harness de paridade.
- O cutover deve ser isolado, reversível e com rollback operacional para a implementação imperativa.
- A implementação imperativa deve permanecer disponível até validação manual explícita do cutover.

#### Lifecycle da settings tab
- Estado assíncrono deve pertencer à instância ativa da tab.
- Cada abertura da tab deve ter instância própria; estados de análise, embeddings, binário e credenciais não podem ser globais partilhados.
- `update()` não pode recriar runtimes e perder estado já controlado.
- Operações pending devem ser canceladas ou neutralizadas ao fechar a tab.
- Operações assíncronas devem usar tokens monotónicos (ou equivalente tipado) e só podem publicar resultado quando o token ainda é o atual.
- Invalidação por mudança de configuração deve ser seletiva por domínio; `dispose()` invalida todos os domínios/tokens.
- Drafts secretos devem ser limpos também no lifecycle de encerramento da tab.
- Callbacks tardios não podem atuar sobre DOM já destruído.
- Operações duplicadas no mesmo domínio devem ser bloqueadas, sem bloquear domínios independentes.
- Pending/locks devem ser libertados em sucesso, erro e `dispose()`, sem locks permanentes.

#### Isolamento dos módulos desligados
Renderers, definições e actions declarativas desligados:
- não importam `Plugin`, `App`, `Vault`, DOM ou `LinaSettingTab`;
- não executam persistência direta, rede nem I/O;
- usam portas tipadas e injetadas;
- não alteram `display()`, `hide()` nem introduzem registos em `getSettingDefinitions()`;
- permanecem fora de `main.ts` e da tab ativa até cutover autorizado.

#### Actions assíncronas declarativas
- usam estados tipados e impedem execução concorrente;
- normalizam erros desconhecidos sem propagar erros brutos;
- usam feedback acessível;
- confirmações destrutivas são explícitas e injetadas;
- cancelamento não pode produzir efeitos laterais.

#### Bindings desligados de ligação e credenciais

- Cada teste de ligação usa o domínio de lifecycle correspondente; análise e embeddings mantêm tokens e pending independentes.
- Mudança de provider, modelo, URL base, timeout ou disponibilidade de credencial invalida o teste do domínio correspondente.
- Resultados tardios e resultados após `dispose()` não podem alterar estado nem feedback.
- Feedback público pode incluir provider, modelo e URL base quando são dados não secretos; headers, tokens, credenciais, request bodies e erros brutos nunca entram no estado público; o diagnóstico seguro não deve ser reduzido sem justificação.
- Drafts secretos só atravessam o binding no momento da ação; não entram no controlador de lifecycle nem em snapshots públicos.
- Após guardar ou limpar uma credencial, o teste do domínio correspondente deve ser invalidado.
- O binding não resolve nem devolve valores secretos.

#### Factory candidata de renderers/actions de ligação e credenciais

- Renderers/actions candidatos devem receber e reutilizar exclusivamente a instância de `ConnectionCredentialBindings` injetada pela composição.
- É proibido criar lifecycle, runtime ou bindings próprios/paralelos dentro da factory candidata.
- Cada instância de composição mantém factory, binding, owners, drafts e `dispose()` independentes; não usar singletons, caches globais nem estado partilhado.
- Drafts de credenciais pertencem exclusivamente ao renderer.
- Inputs de credenciais começam sempre vazios e com tipo password; valores persistidos nunca podem ser pré-preenchidos no input.
- Drafts nunca entram no lifecycle, na composição, em snapshots diagnósticos, logs, erros públicos nem snapshots persistidos.
- `save` com sucesso limpa o draft; `save` com erro preserva o draft; cleanup e `dispose()` também limpam drafts.
- Cleanup deve ser registado por `owner/id` estável e cleanup/`dispose()` devem ser idempotentes.
- Callbacks tardios não podem atualizar hosts já destruídos.
- Quando o lifecycle já fornece cleanup por `owner/id`, é proibido criar um segundo mecanismo de cleanup.
- `save`, `clear`, confirmação destrutiva, pending, invalidation e testes de ligação são sempre delegados ao binding.
- O feedback público pode expor apenas estado e mensagens normalizadas; `operation` pode distinguir operações seguras, mas nunca transportar dados secretos.
- Limite da fase: esta factory continua desligada da composição candidata, os seis IDs continuam sem ligação, a contagem mantém-se em 36 definitions reais e 10 `MISSING_REAL_BINDING`, `getSettingDefinitions()` permanece inativo e não existe cutover; a próxima fase é a ligação explícita desses seis IDs.

#### Bindings desligados da cópia binária

- Check, create/update e remove usam o mesmo domínio `binary`; operações concorrentes nesse domínio são bloqueadas.
- Pending deve indicar a operação em curso; locks são libertados em sucesso, erro, invalidation e `dispose()`.
- O snapshot público inclui apenas estado binário, pending action, feedback normalizado e predicates; paths absolutos, stack traces, conteúdo binário, objetos de erro, dados do vault e detalhes internos desnecessários nunca entram no estado público.
- Create/update é adicionalmente bloqueado quando o manifesto está em estado `legacy-manifest`.
- Remove exige confirmação destrutiva injetada; cancelamento da confirmação não chama executor, não gera erro e não altera estado.
- Após create/update não é executado check automático adicional, salvo comportamento funcional comprovado e explicitamente definido.
- Executores concretos de filesystem, vault I/O e rede ficam fora do binding.

#### Factory binária candidata

- Renderers/actions binários candidatos devem receber a instância de `DeclarativeSettingsBinaryBindings` pertencente à composição.
- Cada composição cria e mantém uma única `binaryRenderers` por instância.
- Não podem criar `createPureBinaryRuntime(...)` nem qualquer runtime paralelo.
- Não podem criar binding ou lifecycle próprios.
- Não podem executar filesystem, vault I/O ou rede.
- Devem consumir apenas estado público seguro do binding.
- Confirmação, pending, tokens, invalidation e exclusividade pertencem ao binding/lifecycle já existente.
- Renderers devem traduzir apenas o snapshot público seguro do binding.
- Actions devem delegar diretamente no binding para check, create/update e remove.
- `legacy-manifest` deve continuar a bloquear create/update.
- Remove mantém confirmação destrutiva injetada; cancelamento deve ser inerte.
- Não executar check adicional após create/update quando o comportamento real não o faz.

#### Invalidation binária (auditoria B2D3C2)

- A auditoria B2D3C2 não introduz invalidation adicional no binding binário.
- Os controls relevantes existentes continuam apenas a marcar embeddings/runtime index como dirty.
- Não executar checks binários automáticos sem comportamento comprovado.

#### Ownership na factory binária

- A factory binária pertence à composição candidata.
- Duas composições não partilham factory, binding ou estado.
- A factory não deve dispor recursos cuja ownership pertence à composição/lifecycle.
- `dispose()` da factory deve ser idempotente.
- Owner IDs, se existirem, devem ser estáveis por instância.

#### Ownership por composição (auditoria B2D4)

| recurso | owner |
| --- | --- |
| runtime adapters | composição |
| lifecycle controller | composição |
| connection bindings/factory | composição |
| binary bindings/factory | composição |

Cada composição é independente e não partilha estes recursos com outra composição.

#### Regra explícita: `binary-action-feedback`

`binary-action-feedback` não pertence ao blueprint candidato. Portanto:

- não criar esse ID;
- não o adicionar ao blueprint;
- não o adicionar à composição;
- não o usar como requisito de prontidão;
- qualquer código legado com esse conceito permanece fora da candidata.

#### Limite da fase (Fase 9N-B2D4)

- A factory binária (`src/settings/declarativeSettingsBinaryRenderers.ts`) mantém ligação ativa na composição candidata para os quatro IDs binários.
- A composição mantém 47 definitions reais e 0 `MISSING_REAL_BINDING`.
- A candidata permanece detached; não existe `getSettingDefinitions()` ativo.
- Não existe integração ativa em `src/settings.ts` ou `main.ts`, nem cutover.
- Aprovação para harness não autoriza paridade final nem ativação declarativa.
- A 9N-C1 concluiu a instrumentação do harness sem integração ativa; a próxima fase é 9N-C3A (adjudicação estreita da semântica canónica de rollback e materialização persistida dos effects de provider).

#### Adapters runtime desligados (pré-cutover)
- Adapters runtime para settings globais/locais permanecem desligados da tab ativa e sem integração em `display()` ou `getSettingDefinitions()`.
- Mutações que escrevem no mesmo envelope persistido devem passar por fila comum e reler o snapshot dentro da secção crítica.
- É proibido persistir com snapshots capturados antes da entrada na fila crítica.
- Atualizações devem copiar apenas os níveis alterados, preservando `{ settings, index }`, campos desconhecidos, aliases legacy, credenciais, perfis e entradas de outros dispositivos.
- Input inválido não altera snapshot, não persiste e não executa efeitos.
- Falha de save restaura o snapshot em memória anterior; locks/filas são sempre libertados em sucesso e erro.
- Falha de efeito posterior não repete save nem reverte uma mutação já confirmada em disco.
- Erros públicos de adapters devem ser normalizados e sem exposição de detalhes internos.
- Side effects devem ser modelados como união fechada e tipada, com efeitos auditados por key, sem duplicar execução e preservando a ordem mutação → save → efeito.
- Modelos puros não executam side effects diretamente.
- Scheduler de update deve ser injetado e testável, com coalescing explícito de pedidos e sem updates após `dispose()`.
- Cleanups devem ser associados por owner/id, correr no máximo uma vez e manter execução dos restantes mesmo quando um cleanup falha.
- `dispose()` deve ser idempotente e usar neutralização cooperativa para resultados tardios, sem prometer cancelamento real de rede.

#### Persistência canónica e effects
- Controls persistidos via runtime adapters seguem a ordem canónica mutation lógica → save serializado → effects; save falhado restaura o snapshot anterior em memória e não executa effects.
- Depois de um save confirmado, effects podem falhar sem provocar rollback nem repetir save; a falha deve ser normalizada pela infraestrutura existente.
- Mutações seguintes partem sempre do último estado confirmado, nunca de um snapshot local que tenha ficado à frente do disco após uma falha.

#### Credenciais
Regras permanentes para o modelo de credenciais:
- valores secretos nunca entram em descritores declarativos, blueprint, estado público, feedback, logs, snapshots nem mensagens de erro;
- a camada declarativa recebe apenas disponibilidade/obrigatoriedade; `credentialAvailable` é booleano e não transporta a chave;
- campos de credenciais começam sempre vazios; credenciais guardadas nunca são pré-preenchidas;
- string vazia não significa limpar; guardar, substituir e limpar são operações explícitas;
- limpar exige confirmação destrutiva;
- drafts secretos são efémeros e isolados por instância; não são serializados nem partilhados entre análise e embeddings;
- o valor secreto só atravessa o boundary runtime estritamente necessário;
- o valor secreto só pode existir no boundary runtime estritamente necessário e executores podem recebê-lo apenas durante a chamada;
- resultados e erros públicos nunca podem devolver o valor secreto;
- logs não podem incluir o valor, prefixo, sufixo nem comprimento do segredo;
- a bridge runtime de credenciais usa dependências injetadas e permanece desligada da tab ativa até cutover explícito;
- a persistência atual por dispositivo deve ser preservada até existir uma migração deliberada;
- `secretStorage` não deve ser introduzido incidentalmente;
- alterar storage ou schema exige fase própria, migração, compatibilidade e rollback;
- proteção contra exposição na UI não deve ser descrita como segurança em repouso.

#### Persistência e limpeza de credenciais
- `analysisApiKey` e `embeddingsApiKey` permanecem por dispositivo;
- guardar, substituir ou limpar credenciais de análise não pode alterar credenciais de embeddings, e vice-versa;
- outros dispositivos, perfis e aliases legacy devem ser preservados;
- limpar remove apenas a credencial primária do domínio visado;
- fallbacks legacy não podem ser apagados incidentalmente;
- após limpar, a disponibilidade efetiva deve ser recalculada;
- o feedback não pode indicar indisponibilidade quando um fallback continua ativo.

#### Concorrência de credenciais
- mutações da mesma referência de credenciais devem ser serializadas ou bloqueadas;
- mutações de análise e embeddings podem permanecer independentes quando não partilham a mesma referência;
- locks devem ser libertados em sucesso e erro;
- nenhuma gravação pode substituir snapshot desatualizado nem perder alterações externas.

#### Providers e credenciais
- Ollama não exige credencial; providers remotos exigem credencial.
- A resolução de fallbacks legacy deve permanecer centralizada e testada.
- Renderers não resolvem precedência nem leem valores persistidos.

#### Mudança de provider
- `analysis-provider` e `embeddings-provider` devem calcular antes da persistência o estado final de provider + URL + modelo, preservando valores customizados e substituindo apenas campos vazios ou defaults conhecidos.
- A mutação lógica de provider é atómica e deve resultar numa única escrita serializada do snapshot final.
- Effects de runtime/UI só podem correr depois da persistência bem-sucedida; em embeddings, `mark-embeddings-dirty` só ocorre após o save confirmado.
- Se o save falhar, o snapshot anterior é restaurado integralmente e nenhum effect é executado; se um effect falhar depois do save, a persistência permanece confirmada, sem novo save nem rollback.

### Implementação de IA
Não implementar funcionalidades de IA como Ollama, OpenRouter, embeddings, ou integração com modelos de linguagem sem uma tarefa explícita para tal. Foco apenas no que foi solicitado.

### Catálogo Local de Modelos
O catálogo local de modelos deve listar apenas providers suportados pelo Lina. Alterações futuras na UI de seleção de modelos devem continuar a permitir modelo manual/custom, especialmente para Ollama, para não bloquear modelos instalados localmente que ainda não estejam no catálogo. A UI de catálogo não deve substituir silenciosamente modelos existentes; valores que não estejam no catálogo devem ser preservados como modelo manual/custom.
Defaults de Base URL por provider devem estar centralizados e só podem preencher/substituir o campo quando estiver vazio ou ainda contiver um default conhecido de provider. Nunca sobrescrever URLs custom do utilizador. Entradas do catálogo de modelos não devem expor providers/modelos que o runtime não consiga executar.
Testes de ligação de embeddings devem usar texto fixo que não venha do vault, não devem ler notas, não devem escrever no índice e não devem acionar geração, atualização ou reconstrução de embeddings.

### Português Europeu
Todos os textos visíveis na interface de utilizador (UI) devem seguir o português europeu correto, incluindo acentos, cedilhas e terminologia PT-PT.
User-facing text must remain in European Portuguese with valid UTF-8. Technical diagnostic logs should use English.

### Evitar Refactors Oportunistas
Evitar refactors oportunistas ou modificações de código que não estejam diretamente relacionadas com a tarefa atual. O foco deve ser na implementação direta e na resolução do problema em questão.

### Plano de Alterações
Antes de qualquer alteração significativa no código, deve ser apresentado um plano claro e conciso ao utilizador, descrevendo as alterações propostas e o seu impacto.

### Relatório Final
No final de cada tarefa, deve ser apresentado um relatório curto, seguindo o formato definido em `docs/agents/relatorio-final.md`.

### Regras para IA e Organização de Notas
As funcionalidades de IA para análise e organização de notas devem manter modo de sugestão por defeito. A resposta deve ser compacta, não deve listar notas inteiras e qualquer escrita no vault deve exigir confirmação explícita do utilizador.

Modelo mínimo local atualmente validado para análise de notas: `gemma4:e2b`. Modelo recomendado para embeddings locais: `nomic-embed-text-v2-moe`.

### Multilingue
O Lina deve distinguir idioma da interface, idioma das notas e idioma predefinido dos embeddings. As notas permanecem sempre no respetivo idioma; o Lina não deve traduzir automaticamente conteúdo, títulos, H1 ou nomes de ficheiro. Na alfa, a interface fica em português europeu por defeito. O idioma predefinido dos embeddings serve apenas como configuração/metadado de trabalho e não altera o conteúdo das notas.

### Internacionalização (i18n)
Os textos visíveis da UI devem passar pela infraestrutura de i18n (`src/i18n/strings.ts`) sempre que possível. Português europeu é o fallback obrigatório. Não traduzir conteúdo das notas, títulos, H1 ou nomes de ficheiro. Não traduzir chaves técnicas, ids internos, providers, modelos ou prefixos.

### Persistência de Settings
Ao carregar as configurações (`loadDataFromDisk`), assegurar que todas as propriedades das settings são corretamente preservadas e que os valores por defeito (`DEFAULT_SETTINGS`) só são aplicados para propriedades que não foram definidas pelo utilizador (ou seja, `undefined`). Evitar que `DEFAULT_SETTINGS` sobrescreva configurações existentes do utilizador (incluindo `false` para booleans).

## Qualidade de Código, Validação e Ambiente

### TypeScript / Source quality
* Promises devem usar `await`, `.catch()`, ou `void` apenas quando for fire-and-forget intencional e seguro.
* Chamadas fire-and-forget relevantes devem ter `.catch()` com tratamento mínimo de erro.
* Usar `window.setTimeout` e `window.clearTimeout` em vez de `setTimeout`/`clearTimeout` globais.
* `case` com `const`/`let` deve usar bloco `{}`.
* Evitar `any` sem necessidade; preferir `unknown` e narrowing explícito, especialmente em `catch`.
* Evitar cast direto para `TFile`; usar `instanceof TFile`.
* Remover imports, variáveis e funções não usadas.
* Evitar type assertions desnecessárias.
* Não deixar atribuições inúteis como `settings.embeddingModel = settings.embeddingModel`.
* Não fazer refactor largo apenas para satisfazer avisos, salvo fase própria.
* Manter comportamento funcional estável.

### CSS / UI
* Evitar `!important`.
* Preferir ordem de origem, especificidade adequada ou classes próprias do Lina.
* Evitar seletores globais agressivos que afetem o Obsidian inteiro.
* Não fazer redesign numa fase de lint/hardening.
* Alterações CSS devem ser testadas no painel Lina, ações rápidas, acordeões, resultados de pesquisa, área de análise e settings quando aplicável.

### Migrações DOM (prefer-create-el)
* Migrações `prefer-create-el` devem ser executadas em lotes pequenos e auditáveis, limitando cada lote por ficheiros afetados e número de ocorrências.
* Classificar risco antes de editar: casos simples como `createEl("span") → createSpan()` apresentam risco mínimo; casos com lógica condicional ou manipulação dinâmica apresentam risco maior.
* Não usar `eslint --fix` automaticamente em alterações de conformidade.
* Preservar estrutura DOM, classes CSS, atributos, referências internas e listeners de eventos; validar que o resultado é funcionalmente idêntico ao original.
* Validar a redução exata do warning count do lint após cada lote; se o count não corresponder ao esperado, investigar discrepâncias antes de continuar.
* Não misturar ocorrências simples com casos condicionais ou dinâmicos no mesmo lote; separá-los em fases distintas quando o risco diferir significativamente.
* Após cada lote de migrações DOM, executar: `npm run typecheck`, testes aplicáveis, `npm run build`, `npm run release-check` e `npm run lint:obsidian`. Confirmar lint antes de prosseguir.

### Validação obrigatória
* Antes de fechar tarefas técnicas, executar:
  ```
  npm ci
  npm run typecheck
  npm run build
  npm run release-check
  git diff --check
  git status --short
  ```
* Em alterações técnicas relevantes, executar `npm run lint:obsidian` para validar com o lint oficial do Obsidian.
* Executar `npm run lint:obsidian:strict` para medir o baseline; este modo só deve bloquear releases quando não existirem warnings conhecidos.
* Não executar `eslint --fix` automaticamente em alterações de conformidade.
* Não adicionar `eslint-disable`, `ts-ignore`, `ts-expect-error`, `as any` ou casts duplos para silenciar o lint.
* Não desativar regras de `eslint-plugin-obsidianmd` sem justificação técnica documentada, nem ignorar ficheiros de produção para ocultar avisos.
* Tratar erros antes de warnings, corrigir warnings em fases pequenas e auditáveis e comparar discrepâncias com a revisão da comunidade quando aplicável.
* Manter `main.js` e outros artefactos gerados fora da análise ESLint.
* Não integrar o modo strict no `release-check` enquanto existirem warnings conhecidos no baseline.
* Para alterações apenas documentais, `git diff --check` e revisão do diff podem ser suficientes.
* Não substituir `npm ci` por `npm install` na validação de release.
* `npm install` só deve ser usado quando houver decisão explícita para alterar dependências/lockfile.

### Ambiente Windows / PowerShell
* Se `npm ci` falhar com EPERM/EBUSY/ENOTEMPTY em `node_modules`, não trocar por `npm install`.
* Fechar Obsidian, VS Code/Cursor/Cline e terminais Node.
* Se necessário, parar processos:
  ```
  taskkill /F /IM node.exe
  taskkill /F /IM esbuild.exe
  ```
* Remover `node_modules` e repetir `npm ci`:
  ```
  Remove-Item -Recurse -Force .\node_modules
  npm cache verify
  npm ci
  ```
* Se continuar a falhar, reportar erro exato.
* Não continuar para build se `npm ci` falhou numa validação obrigatória.

### PowerShell / curl
* Em PowerShell, não usar `curl` simples.
* Usar `curl.exe` ou `Invoke-RestMethod -Uri`.
* Se o PowerShell ficar a pedir `Uri:`, cancelar com Ctrl+C.
* Prompts futuros para comandos GitHub/API devem usar explicitamente `curl.exe` ou `Invoke-RestMethod -Uri`.

### Relatório final
Para além do formato definido em `docs/agents/relatorio-final.md`, o relatório final deve indicar:
* Ficheiros lidos (AGENTS.md e guias).
* Ficheiros alterados.
* Comandos executados.
* Resultado dos comandos.
* Se `npm ci` foi executado ou, em alteração documental, justificar por que não foi necessário.
* Confirmar que não foram alteradas notas do vault.
* Confirmar que não foram gerados embeddings.
* Confirmar que não houve chamadas externas, salvo se a tarefa as exigia.
* Confirmar que não houve alterações fora do âmbito.
* Indicar commit realizado.

### Testes Automatizados
* Os testes devem usar Vitest como framework (já configurado).
* O módulo `obsidian` é mockado em `tests/helpers/mockObsidian.ts` porque é types-only.
* Nunca depender de um vault real ou Obsidian aberto para testes.
* Usar `FakeAdapter` (em `tests/helpers/fakeAdapter.ts`) para simular o sistema de ficheiros em memória.
* Testes de indexação devem usar o `FakeApp` + `asApp()` para compatibilidade com tipos.
* Testes de cancelamento/concorrência devem usar `YieldControl` injetável e `shouldCancel` em vez de delays reais.
* Alterações ao motor de indexação (indexStore.ts, rebuild, etc.) devem incluir ou atualizar testes.
* Não usar `Promise.all` sobre todo o vault em testes.
* Preferir asserts de propriedade (ex: "processed never exceeds total") a asserts de tempo.
* Manter `npm run test` funcional antes de qualquer commit que mexa em src/index/ ou testes.
* Executar `npm test` (ou `npm run test:index`) e `npm run typecheck` antes de alterar código de produção.

## Privacidade, Armazenamento e Compatibilidade Obsidian

### Privacidade e acesso ao vault
* A enumeração do vault é aceitável no Lina porque o plugin é de pesquisa/indexação.
* A indexação deve limitar-se a ficheiros Markdown, salvo funcionalidade futura explicitamente implementada.
* Respeitar sempre as exclusões configuradas pelo utilizador.
* O README deve explicar claramente:
  - acesso ao vault;
  - índice local;
  - privacidade;
  - comportamento de rede;
  - providers locais/remotos.
* Não enviar conteúdo de notas para serviços externos sem configuração explícita e ação explícita do utilizador.

### Armazenamento
* É proibido usar `localStorage`.
* É proibido usar `sessionStorage`.
* Evitar `globalThis` em runtime.
* Settings pequenas do plugin devem usar `loadData()` / `saveData()`.
* A pasta `.lina/` fica reservada para índice e dados operacionais locais, não para settings genéricas.
* `.lina/index` é o local esperado para o índice operacional.
* Configurações por dispositivo não devem ser guardadas como campos planos sincronizáveis em `LinaSettings`. Devem usar uma estrutura por dispositivo (`deviceSettingsById`) ou mecanismo equivalente.
* Cada dispositivo deve ler e escrever apenas a sua própria entrada.
* O identificador do dispositivo atual deve ser calculado em runtime ou obtido por mecanismo que não crie um campo plano global sincronizável.

### Compatibilidade Obsidian
* Não assumir que a pasta de configuração do vault se chama `.obsidian` em código runtime.
* Usar `app.vault.configDir` ou `vault.configDir` quando for necessário referir a pasta de configuração do Obsidian.
* Distinguir referências documentais a `.obsidian` de lógica runtime.
* Usar APIs públicas e documentadas do Obsidian sempre que possível.
* Evitar APIs internas.
* Manter `manifest.json` com `isDesktopOnly: false`, salvo decisão explícita e justificada para uma funcionalidade específica.
* Qualquer alteração que afete mobile deve ser validada com atenção.


## Release e Validação CI

### Workflow CI
O GitHub Actions é a fonte oficial de verdade para o estado de CI. O workflow (`ci.yml`) executa as validações principais por esta ordem:
1. `npm ci` — instala dependências a partir do `package-lock.json` (reprodutível)
2. `npm run typecheck` — verificação de tipos TypeScript
3. `npm run build` — compilação com esbuild
4. `npm run release-check` — validação estrutural do release nas execuções de release

### Release automática por tag
A release do plugin para Obsidian Community é criada automaticamente pelo GitHub Actions quando uma tag de versão é enviada para o repositório. Não criar release manualmente, salvo decisão explícita e justificada.

Enviar a tag aciona o GitHub Actions, que cria a release. Depois disso, confirmar que o workflow ficou verde e que a release tem os assets corretos.

### Versionamento
* `manifest.json`, `package.json` e `package-lock.json` devem ter sempre a mesma versão.
* `versions.json` deve mapear a versão do plugin para o respetivo `minAppVersion`.
* Em bump de versão ou preparação de release, verificar e atualizar `README.md` para manter coerência com `manifest.json`, `package.json` e `versions.json`. `README-pt.md` é ficheiro legado e não deve ser atualizado.
* Não é necessário atualizar README em cada build normal.
* O `release-check` atual não valida automaticamente a coerência de versão dos README.
* A validação automática desta coerência no `release-check` é recomendada, mas não deve ser descrita como implementada enquanto não existir.
* Para preparar uma nova versão, usar:
  ```
  npm run release:bump -- <versão|patch|minor|major>
  ```
* O build normal (`npm run build`) não deve incrementar versões nem alterar `manifest.json`, `package.json`, `package-lock.json` ou `versions.json`.
* `release:bump` não cria tag, release, commit nem push. Apenas atualiza os ficheiros de versão na working tree.
* Depois do bump: validar, fazer commit, preferir merge para `master`, criar tag e enviar a tag.

### Fluxo de release e validação obrigatória
Antes de criar ou enviar uma tag de release:
1. Executar `npm ci`.
2. Executar `npm run typecheck` (sem erros).
3. Executar `npm run build` (sem erros).
4. Executar `npm run release-check` (passa).
5. Executar `git diff --check`.
6. Executar `git status --short` para confirmar working tree limpa.
7. Executar `npm run lint:obsidian`. O modo `npm run lint:obsidian:strict` só bloqueia a release quando o baseline não tiver warnings conhecidos.

Depois da validação:
1. Fazer commit das alterações, incluindo o bump de versão.
2. Preferir merge para `master` antes de criar a tag.
3. Garantir que a working tree está limpa.
4. Verificar se a tag já existe local e remotamente:
   ```
   git tag --list <versão>
   git ls-remote --tags origin <versão>
   ```
   Se a tag já existir, parar e reportar. Não apagar nem recriar tags sem autorização explícita.
5. Criar a tag sobre o HEAD validado de `master`.
6. Enviar `master` antes da tag:
   ```
   git push origin master
   ```
7. Enviar a tag para acionar o workflow:
   ```
   git push origin <versão>
   ```
8. Confirmar que o GitHub Actions ficou verde e que a release automática tem os assets corretos.

### Fluxo Git por fases
* Trabalhar em fases pequenas e validáveis.
* Antes de iniciar nova fase, se o estado atual estiver validado, fazer commit.
* Não avançar para tag/release com alterações pendentes ou validações locais em falta.
* Não apagar nem recriar tags sem autorização explícita.

### Regras da tag e da release
* A tag deve ser exatamente a versão em `manifest.json`, sem prefixo `v` (ex: `0.1.3`).
* O título/nome da release deve ser igual à versão (ex: `0.1.3`).
* Assets manuais permitidos na release (apenas estes):
  - `main.js`
  - `manifest.json`
  - `styles.css`
* Assets manuais proibidos na release (não anexar):
  - `README.md`
  - `LICENSE.md`
  - `versions.json`
  - ZIP ou qualquer ficheiro extra
* Source code zip/tar.gz automáticos do GitHub são normais.
* Artifact attestations devem ser geradas pelo workflow via `actions/attest-build-provenance@v2`.

### Regras do `release-check.js`
O `scripts/release-check.js` é um validador **estrutural apenas**. Deve:
- Verificar que `manifest.json` existe, é JSON válido e tem `version`.
- Verificar que `main.js` e `styles.css` existem.
- **Não** verificar README.md ou LICENSE.md como assets de release.
- **Não** inspecionar o conteúdo JavaScript compilado.
- **Não** usar heurísticas frágeis como procurar por `"src/"`, `"exports"`, `"module"` ou `"Object.defineProperty"`.
- **Não** depender de padrões específicos do bundler (esbuild, rollup, webpack, etc.).
- **Não** exigir um nome de ficheiro `LICENSE` específico.
- **Não** usar o tamanho do ficheiro como condição de falha.

### Observações
- O validador assume que o build já correu com sucesso (executa depois de `npm run build` no CI).
- A correção do bundle é da responsabilidade do esbuild, não do `release-check.js`.
- Texto visível da UI deve seguir português europeu. Não alterar ids, endpoints, nomes, atributos de dados ou seletores.
- README.md e LICENSE.md continuam no repositório e devem ser mantidos atualizados, mas não são incluídos como assets manuais da release.
- `fail_on_unmatched_files: true` faz a release falhar caso algum dos ficheiros listados nos assets não exista. Este parâmetro não bloqueia ficheiros extra no repositório; os ficheiros extra simplesmente não são anexados porque a release usa uma lista explícita de assets permitidos.

## Obsidian API and Community Compliance

### UI development

New UI components must prefer official Obsidian UI helpers and patterns.

Prefer:

* `createEl()`
* `createDiv()`
* `createSpan()`
* Obsidian Modal classes
* Obsidian Settings helpers

Avoid introducing:

* `document.createElement()`
* direct DOM manipulation when an Obsidian helper exists

Large UI migrations require an explicit task.

### Confirmation dialogs

Do not introduce browser native confirmation dialogs.

Avoid:

```ts
confirm(...)
```

Use:

* `ConfirmationModal`
* Modal classes
* Obsidian UI patterns

### Settings API

When creating or modifying settings:

* consider declarative settings API compatibility;
* avoid increasing technical debt in `PluginSettingTab`;
* evaluate `getSettingDefinitions()` when appropriate.

Do not perform partial migrations.

### Window and DOM compatibility

Avoid:

* `globalThis` when window context is required;
* unsafe `instanceof` checks across windows.

Prefer:

* `window`;
* `activeWindow`;
* Obsidian helpers.

### Vault configuration

Never assume `.obsidian`.

Always use:

```ts
app.vault.configDir
```

The configuration folder is user configurable.

### Async operations

Floating promises are not allowed.

Every Promise must be:

* awaited;
* handled with `catch`;
* or explicitly ignored using:

```ts
void operation()
```

### Community review checklist

Before completing implementation work, verify:

* no new avoidable Obsidian community warnings;
* public Obsidian APIs are preferred;
* lifecycle resources are managed correctly;
* desktop and mobile compatibility is considered;
* unnecessary browser APIs are avoided.

### Sentence-case lint compliance

The Obsidian community lint rule `ui/sentence-case` is designed to normalize UI text to sentence case. However, some documented terms must be preserved as-is:

* **Brand names and acronyms**: "Lina", "IA", "Buy Me a Coffee" must not be converted to lowercase.
* **Official command names**: Exact command names as they appear in the UI (e.g. "Lina: testar plugin") must match the defined command, not be normalized.
* **Technical identifiers**: File paths, tokens, field names, code samples and technical terms are not natural language text and should not be modified.
* **Proper nouns and product names**: External product names, real place names and official service names.

**Analysis and handling**:

* Each occurrence must be evaluated in its own context, not changed globally.
* Suppressions (`eslint-disable-next-line`) require explicit justification and are not the default solution.
* `eslint --fix` must not be used on these cases, as it produces semantically incorrect results.
* Confirmed false-positive warnings should be enumerated as a protected baseline in release reports while they persist.
* When the rule or related content changes, revisit and re-evaluate the baseline.
