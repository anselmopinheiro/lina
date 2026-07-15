# Lina (ALFA 1)

Plugin para Obsidian que ajuda a pesquisar, organizar e enriquecer notas Markdown, com foco em controlo local, privacidade e evolução gradual.

Versão: 0.1.10 (alfa)

Manual de utilizador: [docs/manual.md](docs/manual.md)

## Estado atual

Desenvolvimento ativo. Funcionalidades abaixo implementadas e funcionais. As planeadas estão no roadmap.

## Funcionalidades implementadas

### Índice textual local
- Cria índice em .lina/index/. Gera manifest.json, notes.json, chunks.jsonl.
- Divide notas em chunks com sobreposição controlada. Exclusões configuráveis por caminho.
- Exclusão permanente de .lina/ e da pasta de configuração do Obsidian.

## Comportamento da indexação

Quando o Lina é instalado ou ativado pela primeira vez, não cria automaticamente o índice textual completo.

Para começar a usar a pesquisa do Lina, é necessário criar o índice manualmente a partir do painel do Lina ou através do comando de reconstrução do índice.

As atualizações automáticas do índice só funcionam depois de já existir um índice válido. Se o índice estiver ausente, incompleto ou corrompido, o Lina não cria um índice parcial automaticamente. Nesse caso, deve ser feita a reconstrução manual do índice.

O índice textual completo só é carregado quando é necessário para pesquisa ou para uma atualização automática real. As atualizações automáticas validam e agregam eventos do vault para evitar leituras repetidas, e os ficheiros internos do Lina em `.lina/` não provocam reindexação recursiva.

As reconstruções manuais do índice textual decorrem em pequenos lotes em background. O painel do Lina mostra o progresso e permite cancelar; um cancelamento ou erro fatal preserva o índice válido anterior.

Este comportamento é intencional e ajuda a manter o Obsidian responsivo em vaults grandes, em dispositivos móveis ou em vaults sincronizados com OneDrive ou serviços semelhantes.

A primeira criação do índice é sempre manual; depois disso, o Lina pode manter o índice atualizado automaticamente.

### Fiabilidade do índice

O Lina mantém agora o índice textual mais fiável em fluxos comuns do vault. Ao abrir o Obsidian, o Lina reconcilia alterações feitas enquanto a aplicação estava fechada, para que notas novas, alteradas, removidas ou renomeadas sejam refletidas após o arranque quando já existe um índice válido.

A indexação automática também reduz o risco de diferenças entre o índice ativo em memória e o índice guardado em disco, e alterações rápidas em várias notas são tratadas de forma independente para que a atualização de uma nota não cancele a de outra. Os fluxos críticos de indexação têm agora maior cobertura de testes de regressão.

### Pesquisa textual
- Pesquisa local no índice textual (nome, caminho ou conteúdo).
- A ordenação privilegia correspondências de palavra completa, depois prefixos e depois substrings parciais.
- Resultados com: nome, caminho, origem, pontuação, excerto destacado.
- Limite de duplicados. Abre nota ao clicar.

### Pesquisa híbrida
- Combina pesquisa textual + semântica numa lista ordenada.
- Pesos: 0.7 textual, 0.3 semântica. Usa só texto se não houver embeddings.

### Vista lateral (painel Lina)
- Painel persistente na barra lateral direita.
- Modos: Híbrido, Textual, Semântico. Mostra estado do índice e embeddings.
- Texto simples executa pesquisa. Comandos com barra são em inglês e ficam reservados para ações contextuais; `/ask` pergunta ao provider de IA configurado sobre o texto selecionado ou, se o foco o limpar, sobre a última seleção válida capturada da mesma nota. `/tags` sugere apenas tags e `/yaml` sugere apenas YAML/frontmatter, usando o mesmo fluxo seguro de contexto. Se não houver seleção, os comandos contextuais usam a nota atual e mostram metadados seguros do contexto no painel.

### Análise de notas com IA (Ollama)
- Analisa a nota aberta com Ollama local.
- Analisa com contexto de notas relacionadas via pesquisa híbrida.
- Analisa notas Markdown de uma pasta escolhida, com subpastas opcionais e contagem com exclusões antes de executar.
- Mostra origem, pontuação e motivo curto dos candidatos nas notas relacionadas e nos links internos sugeridos pela IA.
- Escolhe links internos de forma conservadora a partir dos candidatos permitidos.
- Copia respostas de análise IA a partir do painel lateral em Markdown/texto simples legível.
- `/ask` mostra origem do contexto, nome da nota, dimensão do contexto e resposta da IA no painel lateral com ação para copiar. A resposta pode ser inserida abaixo da seleção capturada, substituir essa seleção ou ser inserida no fim da nota apenas após confirmação explícita e verificações de segurança.
- `/tags` sugere apenas tags a partir do texto selecionado, seleção preservada ou nota atual; as tags selecionadas podem ser aplicadas à nota ativa com confirmação e tags já existentes na nota não são duplicadas.
- `/yaml` sugere apenas campos YAML/frontmatter a partir do texto selecionado, seleção preservada ou nota atual; os campos novos selecionados podem ser aplicados à nota ativa com confirmação, sem duplicar nem sobrescrever campos existentes.
- Limpa a análise IA individual quando a nota ativa muda, mantendo os metadados sugeridos dessa nota visíveis e selecionáveis para a nota ativa.
- Preserva YAML e etiquetas de análises Inbox/pasta por nota dos resultados, sem agregar metadados de várias notas.
- Sugere YAML, etiquetas, pasta, ligações e tarefas.
- Modo sugestão (não altera automaticamente). Multilingue.

### Integração com Ollama e Mistral
- Teste de ligação, teste de embedding, teste de resposta (60s timeout).
- Geração de embeddings por lote (comando manual). Estado dos embeddings.
- Os embeddings podem ser gerados localmente via Ollama ou remotamente via Mistral.
- O botão de atualização de embeddings usa o provider de embeddings configurado.
- A atualização de embeddings é incremental: vetores existentes são reutilizados quando provider, modelo e conteúdo do chunk não mudaram.
- Antes de uma geração extensa de embeddings, o Lina valida o provider configurado com até três chunks reais do índice e interrompe rapidamente se o provider, modelo, ligação, timeout ou vetor devolvido forem inválidos.
- A geração persistente de embeddings mostra progresso real no painel do Lina e pode ser cancelada. O cancelamento impede novos chunks de começarem, embora um pedido ao provider já em curso possa demorar alguns instantes a terminar. Se a publicação final já tiver começado, o Lina termina essa escrita crítica e apresenta a operação de acordo com o que foi realmente guardado.
- Alterar o provider ou modelo de embeddings pode exigir regenerar todos os embeddings.
- Recomenda-se testar a ligação dos embeddings antes de gerar ou reconstruir embeddings.
- Com providers remotos como Mistral, a atualização incremental reduz chamadas à API.

### Diagnóstico
- Comandos para estado do índice textual e embeddings.
- Modal de estado geral do Lina.

### Configuração por dispositivo
- Estrutura por dispositivo, não campos sincronizáveis.
- Blocos: Análise IA e Embeddings. Provider, modelo, URL, chave API, timeout.

## Privacidade e rede

- Lê ficheiros Markdown do vault para indexação e pesquisa.
- Dados locais em .lina/ dentro do vault.
- **Por omissão, sem chamadas de rede.**
- Conteúdo enviado para serviços externos apenas se utilizador configurar provider remoto E acionar ação.
- Comandos contextuais como `/ask`, `/tags` e `/yaml` enviam apenas o texto selecionado, uma seleção preservada válida da mesma nota ativa ou o conteúdo da nota atual após ação explícita do utilizador. O Lina revalida o contexto final contra as exclusões de conteúdo configuradas imediatamente antes de contactar o provider de IA. Aplicar uma resposta do `/ask`, sugestões selecionadas do `/tags` ou campos selecionados do `/yaml` também exige confirmação e é bloqueado se a nota ativa mudou ou se o conteúdo atual da nota corresponder às exclusões configuradas.
- Providers locais (Ollama) processam localmente.
- Providers remotos podem receber excertos necessários. Consulte políticas do provider.
- .lina/ pode sincronizar se dentro de pasta sincronizada.

## Dados locais e armazenamento

- Sem localStorage ou sessionStorage.
- Settings usam loadData/saveData do Obsidian.
- Configurações por dispositivo têm estrutura dedicada.
- .lina/ reservado para índice e dados operacionais. Caminho: .lina/index/.

## Providers e modelos

- Modelo de embeddings e modelo de chat configurados separadamente.
- As definições de Análise IA e Embeddings mostram modelos conhecidos para Ollama e Mistral, mantendo a possibilidade de indicar modelos manuais/custom.
- A URL base é preenchida automaticamente ao escolher Ollama ou Mistral, exceto se o valor atual for um URL custom.
- URLs base predefinidos: Ollama `http://localhost:11434`; Mistral `https://api.mistral.ai/v1`.
- As definições de Embeddings incluem um botão de teste de ligação. O teste envia apenas a frase fixa `Lina embedding test`, não lê notas do vault, não guarda embeddings e não reconstrói o índice.
- Alterar o modelo de embeddings pode exigir a reconstrução dos embeddings semânticos.
- Os embeddings podem ser gerados localmente via Ollama ou remotamente via Mistral.
- O botão de atualização de embeddings usa o provider de embeddings configurado.
- O progresso da geração vem do estado central da operação; a mesma ação de cancelamento está disponível pela paleta de comandos e pelo painel do Lina.
- Recomenda-se testar a ligação dos embeddings antes de gerar ou reconstruir embeddings.
- Alterar o provider ou modelo de embeddings exige atualizar os embeddings.
- Ollama: funcional para embeddings, chat, análise.
- Mistral: funcional para chat/análise e embeddings. Os embeddings Mistral usam a API Mistral e exigem chave API.
- OpenAI, OpenRouter, Anthropic, Gemini: opções definidas; integração planeada.
- Provider, modelo, URL, chave API, timeout configuráveis por dispositivo.
- Embedding padrão: nomic-embed-text. Embedding local recomendado: nomic-embed-text-v2-moe. Chat recomendado: gemma4:e2b.

## Compatibilidade desktop e mobile

- isDesktopOnly: false. Funciona em desktop e mobile.
- Ollama local é cenário desktop. Providers remotos podem ser usados em mobile.
- Mobile ainda não totalmente validado.

## Limitações atuais

- Fase alfa. Embeddings apenas manuais.
- Mobile não validado para todas as funções.
- Análise IA usa contexto híbrido, não leitura automática do índice.
- Exclusões por caminho. Pesquisa textual não substitui pesquisa do Obsidian.
- OpenAI, OpenRouter, Anthropic, Gemini definidos mas sem implementação funcional para análise.

## Planeado

### Curto prazo: estabilizar ordenação híbrida, validar mobile, melhorar docs.

### Médio prazo: sugestões YAML, etiquetas, ligações, pasta. Integração remota. Mobile completo.

### Futuro: análise PDF/DOCX/imagem, publicação comunidade.

## Instalação

### Community Plugins: pesquisar "Lina" quando aprovado.

### Manual: copiar manifest.json, main.js, styles.css para <Vault>/.obsidian/plugins/lina/. Ativar em Plugins da comunidade.

## Desenvolvimento

```
npm ci
npm run build
```
Ficheiros: manifest.json, main.js, styles.css.
Comandos: dev, build, typecheck, release-check, release:bump.

## Licença

MIT
