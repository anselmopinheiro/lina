# Lina (ALFA 1)

Plugin para Obsidian que ajuda a pesquisar, organizar e enriquecer notas Markdown, com foco em controlo local, privacidade e evolução gradual.

Versão: 0.1.X (alfa)

## Estado atual

Desenvolvimento ativo. Funcionalidades abaixo implementadas e funcionais. As planeadas estão no roadmap.

## Funcionalidades implementadas

### Índice textual local
- Cria índice em .lina/index/. Gera manifest.json, notes.json, chunks.jsonl.
- Divide notas em chunks com sobreposição controlada. Exclusões configuráveis por caminho.
- Exclusão permanente de .lina/ e da pasta de configuração do Obsidian.

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
- Texto simples executa pesquisa. Comandos com barra são em inglês e ficam reservados para ações contextuais; `/ask` pergunta ao provider de IA configurado sobre o texto selecionado ou, se o foco o limpar, sobre a última seleção válida capturada da mesma nota. `/tags` usa o mesmo fluxo de contexto para sugerir apenas tags. Se não houver seleção, os comandos contextuais usam a nota atual e mostram metadados seguros do contexto no painel.

### Análise de notas com IA (Ollama)
- Analisa a nota aberta com Ollama local.
- Analisa com contexto de notas relacionadas via pesquisa híbrida.
- Analisa notas Markdown de uma pasta escolhida, com subpastas opcionais e contagem com exclusões antes de executar.
- Mostra origem, pontuação e motivo curto dos candidatos nas notas relacionadas e nos links internos sugeridos pela IA.
- Escolhe links internos de forma conservadora a partir dos candidatos permitidos.
- Copia respostas de análise IA a partir do painel lateral em Markdown/texto simples legível.
- `/ask` mostra origem do contexto, nome da nota, dimensão do contexto e resposta da IA no painel lateral com ação para copiar. A resposta pode ser inserida abaixo da seleção capturada, substituir essa seleção ou ser inserida no fim da nota apenas após confirmação explícita e verificações de segurança.
- `/tags` sugere apenas tags a partir do texto selecionado, seleção preservada ou nota atual; as tags selecionadas podem ser aplicadas à nota ativa com confirmação e tags já existentes na nota não são duplicadas.
- Limpa a análise IA individual quando a nota ativa muda, mantendo os metadados sugeridos dessa nota visíveis e selecionáveis para a nota ativa.
- Preserva YAML e etiquetas de análises Inbox/pasta por nota dos resultados, sem agregar metadados de várias notas.
- Sugere YAML, etiquetas, pasta, ligações e tarefas.
- Modo sugestão (não altera automaticamente). Multilingue.

### Integração com Ollama
- Teste de ligação, teste de embedding, teste de resposta (60s timeout).
- Geração de embeddings por lote (comando manual). Estado dos embeddings.

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
- Comandos contextuais como `/ask` e `/tags` enviam apenas o texto selecionado, uma seleção preservada válida da mesma nota ativa ou o conteúdo da nota atual após ação explícita do utilizador. O Lina revalida o contexto final contra as exclusões de conteúdo configuradas imediatamente antes de contactar o provider de IA. Aplicar uma resposta do `/ask` ou sugestões selecionadas do `/tags` também exige confirmação e é bloqueado se a nota ativa mudou ou se o conteúdo atual da nota corresponder às exclusões configuradas.
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
- Ollama: funcional para embeddings, chat, análise.
- Mistral: definido nas definições; consulte código para estado.
- OpenAI, OpenRouter, Anthropic, Gemini: opções definidas; integração planeada.
- Provider, modelo, URL, chave API, timeout configuráveis por dispositivo.
- Embedding padrão: nomic-embed-text. Chat recomendado: gemma4:e2b.

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
