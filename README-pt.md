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
- Resultados com: nome, caminho, origem, pontuação, excerto destacado.
- Limite de duplicados. Abre nota ao clicar.

### Pesquisa híbrida
- Combina pesquisa textual + semântica numa lista ordenada.
- Pesos: 0.7 textual, 0.3 semântica. Usa só texto se não houver embeddings.

### Vista lateral (painel Lina)
- Painel persistente na barra lateral direita.
- Modos: Híbrido, Textual, Semântico. Mostra estado do índice e embeddings.

### Análise de notas com IA (Ollama)
- Analisa a nota aberta com Ollama local.
- Analisa com contexto de notas relacionadas via pesquisa híbrida.
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
