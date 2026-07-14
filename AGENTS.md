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
A atualização de embeddings deve ser incremental. Não regenerar embeddings se provider, modelo e hash do chunk forem iguais e o vetor existente for válido. A função `isValidEmbedding` em `embeddingGenerator.ts` é a referência para esta decisão. Em caso de erros durante a geração (incluindo 429 rate limit), preservar o progresso parcial e não descartar embeddings já gerados com sucesso antes do erro.
Todas as operações persistentes que geram ou atualizam `embeddings.jsonl` devem passar por um gestor central pertencente a `LinaPlugin`, com estado partilhado e single-flight global. Comando, sidebar e restantes pontos de entrada persistentes não podem manter flags de execução independentes nem iniciar gerações concorrentes do índice de embeddings.

### Compatibilidade Mobile e APIs
Não usar APIs exclusivas de desktop (Node.js/Electron) se a funcionalidade tiver de ser compatível com mobile, a menos que haja autorização explícita para implementar uma funcionalidade *desktop-only*.

### Pendência da API declarativa de Settings
A aba de definições do Lina ainda usa renderização imperativa através de `PluginSettingTab.display()`. Embora esta API esteja marcada como deprecated a partir do Obsidian 1.13.0, a migração para `getSettingDefinitions()` exige uma fase própria porque a UI atual combina secções condicionais, botões assíncronos, elementos HTML customizados e configurações por dispositivo. Não fazer uma migração parcial ou oportunista: quando for tratada, deve ser planeada como refactor específico da UI de settings, preservando textos, comportamento e compatibilidade mobile.

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
* Executar `npm run lint` apenas se existir script lint em `package.json`.
* Se não existir script lint, reportar isso.
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
7. Se existir script `lint`, executar `npm run lint`.

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
