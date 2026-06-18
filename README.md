# Lina

Plugin para Obsidian que ajuda a pesquisar, organizar e enriquecer notas Markdown, com foco em controlo local, privacidade e evolução gradual para pesquisa semântica e assistência com IA.

## Estado atual

O Lina encontra-se em desenvolvimento ativo. As funcionalidades abaixo estão implementadas e funcionais.

## Funcionalidades implementadas

### Índice textual local

- Criação de um índice textual dentro do vault, em `.lina/index/`.
- Geração de `manifest.json`, `notes.json` e `chunks.jsonl`.
- Divisão de notas em blocos textuais (chunks) com sobreposição controlada.
- Exclusões configuráveis por pasta e por termos no caminho.
- Exclusão permanente de `.lina/` e `.obsidian/`.
- Comando para reconstruir o índice textual.
- Comando para mostrar estado do índice textual, se existir.

### Análise de notas com IA

- Análise da nota atualmente aberta usando Ollama local.
- Análise da nota atual com contexto de notas relacionadas (usando pesquisa híbrida).
- Sugestões de YAML, tags, pasta de destino, links internos e tarefas.
- Modo de sugestão por defeito - não altera notas automaticamente.
- Suporte para múltiplos idiomas configuráveis.
- Limite de caracteres enviado ao modelo para evitar truncamento.
- Interface na vista lateral com resultados formatados.
- Tratamento de erros e timeouts.
- Preservação das definições do utilizador.

### Pesquisa textual

- Pesquisa local no índice textual (notes.json + chunks.jsonl).
- Modal de pesquisa textual com resultados.
- Cada resultado mostra: nome da nota, caminho, origem do match (Nome, Caminho ou Conteudo), pontuacao textual e excerto com termo destacado.
- Limite de duplicados por nota.
- Abertura da nota ao clicar no resultado.

### Pesquisa híbrida

- Novo comando principal `Lina: pesquisar`.
- Abre a vista lateral do Lina no painel direito do Obsidian.
- Combina pesquisa textual local e pesquisa semântica local numa única lista.
- Dá mais peso à pesquisa textual por predefinição (0.7 textual, 0.3 semântica).
- Mostra origem do resultado, relevância textual, semelhança semântica e pontuação final.
- Continua a funcionar apenas com pesquisa textual quando embeddings locais não existem ou não podem ser usados.

### Vista lateral

- A pesquisa principal do Lina abre numa vista lateral persistente no painel direito.
- A vista permite escolher entre os modos Híbrida, Textual e Semântica.
- A vista mostra um estado resumido do índice textual e dos embeddings locais.
- Os detalhes técnicos ficam recolhidos em "Ver detalhes", incluindo ações como reconstruir o índice textual e gerar/atualizar embeddings.
- Os resultados são clicáveis e abrem diretamente a nota.
- As modais antigas de pesquisa continuam disponíveis temporariamente para comparação e diagnóstico.

### Integração com Ollama

- Teste controlado de ligação ao Ollama.
- Teste de geração de embedding com Ollama.
- Teste controlado de geração de resposta com Ollama (com modal e timeout).
- Comando para gerar embeddings por lote.
- Comando para verificar estado dos embeddings.

### Configuração local por dispositivo

- O Lina tem configuração local por dispositivo, guardada em `localStorage` (não em `data.json`).
- Existem dois blocos de configuração: **Análise IA** e **Embeddings**.
- Cada bloco tem: Provider, Modelo, URL base, Chave API (apenas para providers remotos) e Tempo limite.
- Providers disponíveis: Ollama, Mistral, OpenRouter, OpenAI, Gemini, Anthropic, Outro / compatível.
- Providers podem ser diferentes em cada dispositivo.
- Chaves API ficam locais no dispositivo e não são sincronizadas.
- Notas com possíveis dados sensíveis são bloqueadas por defeito em providers remotos nesta versão.
- As definições antigas em `data.json` são preservadas como fallback.

### Compatibilidade de pesquisa semântica

- Os embeddings das notas podem ser sincronizados entre dispositivos via OneDrive.
- Cada dispositivo precisa de conseguir gerar o embedding da pesquisa com provider/modelo compatível.
- Se não houver compatibilidade, o Lina usa pesquisa textual automaticamente.
- Não mistura embeddings de modelos diferentes.
- O estado da semântica é mostrado no painel: "disponível" ou "indisponível neste dispositivo".

### Gestão do índice

- Comando para reconstruir o índice de metadados do vault.
- Comando para atualizar o índice de forma incremental.
- Verificação de sincronização do índice.
- Automação opcional ao iniciar: verificação de sincronização e/ou atualização incremental.

## O que ainda nao esta implementado

- Sugestoes automaticas de YAML.
- Sugestoes automaticas de tags.
- Sugestoes automaticas de links internos.
- Sugestao automática de pasta de destino.
- Integracao completa com OpenRouter, OpenAI, Claude/Anthropic ou Gemini (definicoes existem, mas nao ha funcionalidade real).
- Analise de PDFs, DOCX ou imagens.
- Compatibilidade mobile validada.
- Aplicação automática de sugestões (YAML, tags, links, etc.).

## Modelos locais recomendados

Para embeddings:

- `nomic-embed-text-v2-moe`

Para análise e organização de notas:

- mínimo recomendado validado em testes: `gemma4:e2b`
- modelos mais pequenos podem servir para testes rápidos, mas tendem a falhar mais no cumprimento de instruções;
- modelos maiores podem melhorar a qualidade, mas serão mais lentos.

A análise de notas é apenas sugestiva:

- não altera notas;
- não escreve YAML;
- não aplica tags;
- não cria links;
- não move ficheiros.
- A análise da Inbox permite abrir uma nota e enviá-la para a pré-visualização individual.
- Aplicar alterações continua a exigir seleção manual e confirmação explícita.

## Privacidade e funcionamento local

- O indice e guardado localmente dentro do vault, em `.lina/index/`.
- A pesquisa textual usa os ficheiros do indice, nao le o vault inteiro.
- As notas do vault nao sao alteradas pela reconstrucao do indice.
- As exclusoes impedem que certas notas entrem no indice textual.
- Ollama corre localmente, quando usado.
- Mistral pode ser usado como provider remoto para analise, se configurado pelo utilizador.
- Embeddings ainda nao sao gerados automaticamente.

Nao e garantida privacidade absoluta. O plugin trabalha localmente por predefinicao, mas funcionalidades futuras com APIs externas podero alterar este comportamento se configuradas pelo utilizador.

## Ficheiros criados no vault

O indice textual e guardado em `.lina/index/`:

- `manifest.json` -- metadados do indice: data de criacao, total de notas, total de chunks, opcoes de chunking, estatisticas de exclusao.
- `notes.json` -- lista de notas indexadas com basename, caminho, contagem de caracteres, contagem de palavras, hash de conteudo e data de indexacao.
- `chunks.jsonl` -- blocos textuais (um por linha) com identificador, caminho da nota, indice do bloco, texto, hash e data de criacao.

## Exclusoes do indice

O Lina suporta dois tipos de exclusao, configuraveis nas definicoes do plugin:

- Exclusoes por pasta: comparacao exata do prefixo do caminho, sem distinguir maiusculas/minusculas.
- Exclusoes por termo no caminho: tokenizacao do caminho para evitar falsos positivos.

As pastas `.lina/` e `.obsidian/` sao sempre excluidas automaticamente.

As exclusoes sao aplicadas antes de criar `notes.json` e `chunks.jsonl`. A exclusao e por caminho, nao por conteudo.

Exemplo:
- Uma nota chamada "Senhas diversas.md" pode ser excluida pelo termo "senhas" no caminho.
- Uma nota permitida que mencione "senha" no conteudo pode aparecer na pesquisa textual, porque a exclusao por conteudo ainda nao existe.

## Pesquisa textual

A pesquisa textual:

- Usa `notes.json` e `chunks.jsonl`.
- Nao pesquisa diretamente o vault inteiro.
- Nao usa IA nem embeddings.
- Procura em nome, caminho e conteudo dos blocos.
- Mostra a origem do resultado (Nome, Caminho ou Conteudo).
- Mostra uma pontuacao textual (relevancia heuristica, nao e percentagem nem avaliacao semantica).
- Destaca visualmente o termo pesquisado no excerto.
- Limita duplicados por nota (maximo 3 resultados por nota).
- Permite abrir a nota ao clicar no resultado.

## Pesquisa híbrida

A pesquisa híbrida:

- Usa a pesquisa textual como base principal.
- Tenta complementar os resultados com pesquisa semântica local quando existem embeddings.
- Não regenera embeddings nem altera `embeddings.jsonl`, `chunks.jsonl` ou `notes.json` durante a pesquisa.
- Normaliza a pontuação textual para 0 a 100 com base no melhor resultado textual da pesquisa atual.
- Normaliza a semelhança semântica para 0 a 100 com `clamp(similarity * 100, 0, 100)`.
- Calcula a pontuação final com pesos conservadores: `textual * 0.7 + semântica * 0.3`.
- Limita os resultados a 20 no total e a 3 por nota.
- Mantém os comandos textual e semântico separados para comparação e diagnóstico.

Se os embeddings locais não existirem, estiverem indisponíveis ou a query não puder ser embebida, o Lina apresenta os resultados textuais e mostra um aviso discreto.

A pesquisa textual continua disponível mesmo sem embeddings. Quando os embeddings não estão disponíveis, a pesquisa híbrida usa fallback textual.

## Ollama

O Lina tem integracao basica com Ollama, local:

- Teste de ligacao ao servidor Ollama configurado.
- Teste de geracao de embedding com o modelo configurado.
- Teste controlado de geracao de resposta com o modelo de chat configurado, com modal e timeout de 60 segundos.
- Geracao de embeddings por lote (comando manual).
- O Ollama nao pesquisa automaticamente o vault nessa fase.

## Instalacao em desenvolvimento

Requisitos: Node.js e npm.

```
npm install
npm run build
```

Os ficheiros necessarios para o plugin sao: `manifest.json`, `main.js` e `styles.css`.

Em desenvolvimento, o plugin pode ser ligado ao vault de teste atraves de junction ou symlink para a pasta `.obsidian/plugins/lina/`.

## Instalacao manual no Obsidian

1. Copie os ficheiros `manifest.json`, `main.js` e `styles.css` para `<Vault>/.obsidian/plugins/lina/`.
2. No Obsidian, va a Definicoes > Plugins da comunidade.
3. Ative o plugin Lina.

## Comandos disponiveis

| Comando | Descricao |
|---------|-----------|
| Lina: pesquisar | Abre a vista lateral principal de pesquisa |
| Lina: reconstruir indice textual | Reconstrui o indice textual (chunks) |
| Lina: mostrar estado do indice | Mostra estado do indice textual, se existir |
| Lina: pesquisar no indice textual | Abre o modal de pesquisa textual |
| Lina: gerar embeddings locais | Gera ou atualiza embeddings locais dos chunks |
| Lina: mostrar estado dos embeddings locais | Mostra o estado atual dos embeddings locais |
| Lina: pesquisar semanticamente | Abre o modal de pesquisa semântica local |

## Roadmap

### Curto prazo

- Estabilizar a pesquisa híbrida.
- Melhorar documentacao e README.
- Afinar ranking entre pesquisa textual e semântica.
- Validar melhor a experiência em mobile.

### Medio prazo

- Sugestoes de YAML.
- Sugestoes de tags.
- Sugestoes de links internos.
- Sugestao de pasta de destino.
- Integracao com OpenRouter, OpenAI, Claude/Anthropic e Gemini.
- Compatibilidade mobile validada.

### Futuro

- Analise de PDF, DOCX e imagens.
- Publicacao do plugin para outros utilizadores.
- Eventual botao Buy Me a Coffee.

## Limitacoes atuais

- Projeto em desenvolvimento, nao pronto para producao.
- Embeddings ainda nao sao gerados automaticamente.
- Mobile ainda nao validado.
- IA ainda nao usa automaticamente o indice textual.
- Exclusoes sao por caminho, nao por conteudo.
- A pesquisa textual nao substitui a pesquisa normal do Obsidian.
- Providers OpenRouter, OpenAI, Claude/Anthropic e Gemini estao definidos nas configuracoes, mas nao ha funcionalidade real implementada.

## Licenca

MIT
