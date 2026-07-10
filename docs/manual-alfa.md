# Lina — Manual de introdução

Lina é um assistente para Obsidian focado em pesquisa local, pesquisa semântica e análise opcional de notas com IA.

O objetivo principal do Lina é ajudar a encontrar, relacionar e melhorar notas Markdown sem alterar automaticamente os ficheiros do utilizador.

Lina está atualmente em fase alpha.

## 1. O que o Lina faz

O Lina permite:

* criar um índice local das notas Markdown;
* pesquisar notas por nome, caminho ou conteúdo;
* fazer pesquisa textual, semântica ou híbrida;
* analisar a nota atual com IA;
* receber sugestões de YAML/frontmatter, tags, links, tarefas e organização por pasta;
* usar modelos locais através do Ollama;
* configurar providers diferentes por dispositivo.

Por defeito, o Lina trabalha localmente e não faz chamadas de rede.

## 2. Índice local

Para pesquisar as notas de forma rápida, o Lina cria um índice local dentro da vault:

```text
.lina/index/
```

Este índice pode incluir ficheiros como:

```text
manifest.json
notes.json
chunks.jsonl
```

O índice contém informação operacional necessária para a pesquisa. Não é uma cópia completa da vault, mas inclui partes processadas das notas para permitir pesquisa textual e semântica.

A pasta `.lina/` é usada pelo Lina para guardar dados locais de funcionamento.

Quando o Lina é instalado ou ativado pela primeira vez, não cria automaticamente o índice textual completo. Para começar a usar a pesquisa do Lina, é necessário criar o índice manualmente a partir do painel lateral do Lina ou através do comando de reconstrução do índice.

As atualizações automáticas do índice só funcionam depois de já existir um índice válido. Se o índice estiver ausente, incompleto ou corrompido, o Lina não cria um índice parcial automaticamente. Nesse caso, deve ser feita a reconstrução manual do índice.

Este comportamento é intencional e ajuda a manter o Obsidian responsivo em vaults grandes, em dispositivos móveis ou em vaults sincronizados com OneDrive ou serviços semelhantes.

A primeira criação do índice é sempre manual; depois disso, o Lina pode manter o índice atualizado automaticamente.

## 3. Blocos de texto

Durante a indexação, o Lina divide as notas em blocos de texto mais pequenos.

Isto permite:

* pesquisar dentro de notas longas;
* mostrar excertos relevantes;
* encontrar partes específicas de uma nota;
* enviar apenas contexto limitado para análise com IA, quando aplicável.

Em vez de tratar cada nota como um único texto grande, o Lina trabalha com blocos. Isto melhora a precisão dos resultados e evita processar mais conteúdo do que o necessário.

## 4. O que são embeddings

Embeddings são representações numéricas de texto.

De forma simples, um embedding transforma uma frase, parágrafo ou bloco de texto numa espécie de “mapa matemático” do seu significado.

Por exemplo, estas expressões têm palavras diferentes, mas significado próximo:

```text
organizar notas antigas
classificar apontamentos
arrumar informação da vault
```

Numa pesquisa textual tradicional, os resultados dependem muito das palavras exatas usadas. Com embeddings, o Lina consegue encontrar notas relacionadas pelo significado, mesmo que usem palavras diferentes.

## 5. Para que servem os embeddings no Lina

No Lina, os embeddings servem para a pesquisa semântica.

A pesquisa semântica permite encontrar notas relacionadas por significado, não apenas por correspondência exata de palavras.

Exemplo:

```text
Pesquisa: ideias para organizar aulas
```

A pesquisa textual pode encontrar notas com as palavras “ideias”, “organizar” ou “aulas”.

A pesquisa semântica pode encontrar também notas sobre:

* planificação;
* estrutura de conteúdos;
* preparação de atividades;
* organização pedagógica;
* sequências de trabalho.

Isto torna a pesquisa mais flexível, especialmente em vaults com muitas notas.

## 6. Pesquisa textual

A pesquisa textual procura correspondências diretas no índice local.

Pode encontrar resultados por:

* nome da nota;
* caminho da nota;
* conteúdo da nota.

É útil quando o utilizador sabe exatamente que palavra, expressão, ficheiro ou pasta pretende encontrar.

Exemplo:

```text
micro:bit
```

A pesquisa textual tende a funcionar bem quando as notas usam os mesmos termos da pesquisa.

## 7. Pesquisa semântica

A pesquisa semântica procura notas relacionadas pelo significado.

É útil quando o utilizador não sabe exatamente que palavras foram usadas na nota.

Exemplo:

```text
atividades para ensinar programação
```

Mesmo que uma nota não contenha exatamente essa frase, pode aparecer nos resultados se estiver relacionada com programação, algoritmos, pensamento computacional ou atividades digitais.

Para usar pesquisa semântica, é necessário gerar embeddings.

No estado atual do Lina, a geração de embeddings é manual.

## 8. Pesquisa híbrida

A pesquisa híbrida combina:

* pesquisa textual;
* pesquisa semântica.

É o modo recomendado para a maioria dos casos.

A pesquisa textual ajuda a encontrar correspondências exatas.
A pesquisa semântica ajuda a encontrar relações de significado.

O Lina combina estas duas pontuações numa lista única de resultados.

Por defeito, os pesos são:

```text
texto: 0.7
semântica: 0.3
```

Estes valores podem ser ajustados nas configurações.

Um peso textual mais alto favorece resultados com palavras iguais ou muito próximas da pesquisa.

Um peso semântico mais alto favorece resultados relacionados pelo significado.

## 9. O que significa relevância, similaridade e origem

Nos resultados de pesquisa, o Lina pode apresentar diferentes indicadores.

### Relevância

A relevância indica a força geral do resultado na pesquisa combinada.

Na pesquisa híbrida, a relevância resulta da combinação entre texto e semântica.

### Similaridade

A similaridade indica a proximidade semântica entre a pesquisa e o conteúdo encontrado.

Quanto maior a similaridade, mais próximo é o significado do bloco encontrado em relação à pesquisa.

### Origem do resultado

A origem indica por que razão a nota apareceu nos resultados.

Pode estar relacionada com:

* nome da nota;
* caminho do ficheiro;
* conteúdo textual;
* resultado semântico;
* resultado híbrido.

Isto ajuda o utilizador a perceber se o resultado apareceu por causa de uma palavra exata, de uma relação de significado ou de ambos.

## 10. O que é a AI Analysis

A AI Analysis é a análise da nota atual com apoio de IA.

No Lina, esta função pode usar um modelo local através do Ollama.

A análise pode sugerir:

* YAML/frontmatter;
* tags;
* links para notas relacionadas;
* tarefas;
* possível pasta de organização;
* melhorias de estrutura;
* resumo ou análise contextual.

O objetivo não é substituir o utilizador, mas apresentar sugestões úteis para melhorar a organização da nota.

Por defeito, o Lina trabalha em modo de sugestão. Isto significa que a análise não altera automaticamente a nota.

## 11. Como funciona a análise com contexto

Quando o Lina analisa uma nota, pode usar contexto de notas relacionadas.

Esse contexto é obtido através da pesquisa híbrida.

O processo geral é:

1. O Lina lê a nota atual.
2. Procura notas relacionadas através da pesquisa híbrida.
3. Usa excertos relevantes como contexto.
4. Envia a nota atual e o contexto selecionado para o modelo de IA configurado.
5. Apresenta sugestões ao utilizador.

O Lina não lê automaticamente toda a vault para cada análise. Usa contexto recuperado a partir da pesquisa.

## 12. Ollama

Ollama permite executar modelos de IA localmente no computador.

Quando o Lina usa Ollama:

* o processamento é local;
* as notas não são enviadas para serviços externos;
* é necessário ter o Ollama instalado e em execução;
* é necessário ter modelos disponíveis no Ollama.

Ollama é especialmente indicado para computadores com capacidade suficiente para executar modelos locais.

Em dispositivos móveis, o uso de Ollama local normalmente não é o cenário principal.

## 13. Providers remotos

O Lina está preparado para permitir diferentes providers de IA.

Exemplos de providers previstos ou configuráveis:

* Ollama;
* Mistral;
* OpenAI;
* OpenRouter;
* Anthropic;
* Gemini.

O estado funcional pode variar entre providers.

Quando é usado um provider remoto, o conteúdo necessário para a operação pode ser enviado para esse serviço externo.

Isto só deve acontecer quando o utilizador:

1. configura explicitamente um provider remoto;
2. introduz os dados necessários, como API key;
3. executa uma ação que requer esse provider.

Antes de usar providers remotos, o utilizador deve confirmar a política de privacidade do serviço escolhido.

## 14. Configurações principais

As configurações do Lina estão organizadas para permitir diferentes comportamentos por dispositivo.

Isto é útil quando a mesma vault é sincronizada entre vários dispositivos.

Por exemplo:

* computador principal com Ollama local;
* portátil mais fraco com provider remoto;
* smartphone com provider remoto;
* tablet apenas para pesquisa.

## 15. Analysis AI

A secção Analysis AI define o provider usado para análise de notas.

Esta configuração controla a IA usada quando o utilizador pede ao Lina para analisar uma nota.

Campos habituais:

### Provider

Define o serviço ou sistema de IA usado para análise.

Exemplo:

```text
Ollama
```

### Model

Define o modelo de chat/análise.

Exemplo:

```text
gemma4:e2b
```

### Base URL

Define o endereço do serviço.

Para Ollama local, normalmente será algo semelhante a:

```text
http://localhost:11434
```

### API key

Chave de acesso usada em providers remotos.

Para Ollama local, normalmente não é necessária.

### Timeout

Tempo máximo que o Lina espera por uma resposta da IA.

Um timeout mais alto pode ser útil para modelos locais lentos.
Um timeout mais baixo evita que o Obsidian fique demasiado tempo à espera de uma resposta.

## 16. Embeddings

A secção Embeddings define o provider e o modelo usados para gerar embeddings.

Esta configuração é independente da Analysis AI.

Isto significa que o utilizador pode usar:

* um modelo para embeddings;
* outro modelo para análise de notas.

Campos habituais:

### Provider

Define onde os embeddings são gerados.

Exemplo:

```text
Ollama
```

### Model

Define o modelo usado para gerar embeddings.

Exemplo:

```text
nomic-embed-text
```

### Base URL

Endereço do serviço usado para gerar embeddings.

Para Ollama local:

```text
http://localhost:11434
```

### API key

Chave de acesso para providers remotos.

Para Ollama local, normalmente não é necessária.

### Timeout

Tempo máximo de espera para geração de embeddings.

## 17. Pesos da pesquisa híbrida

O Lina permite ajustar os pesos da pesquisa híbrida.

Estes pesos definem a importância relativa da pesquisa textual e da pesquisa semântica.

Exemplo:

```text
Textual weight: 0.7
Semantic weight: 0.3
```

Se a pesquisa textual estiver a dar melhores resultados, pode fazer sentido aumentar o peso textual.

Se a pesquisa semântica estiver a encontrar melhores relações entre notas, pode fazer sentido aumentar o peso semântico.

Em geral:

```text
Mais texto = mais precisão por palavras exatas.
Mais semântica = mais descoberta por significado.
```

## 18. Exclusões

O Lina permite configurar exclusões por caminho.

As exclusões servem para impedir que determinadas pastas ou ficheiros sejam incluídos no índice.

Isto pode ser útil para excluir:

* pastas temporárias;
* notas privadas;
* ficheiros técnicos;
* conteúdos que não devem entrar na pesquisa;
* conteúdos que não devem ser usados como contexto para IA.

Algumas pastas são excluídas permanentemente, como:

```text
.lina/
.obsidian/
```

Estas exclusões evitam que o Lina indexe os seus próprios dados operacionais ou a configuração interna do Obsidian.

## 19. Dados sensíveis

O utilizador deve evitar guardar senhas, tokens, API keys ou dados sensíveis em notas que possam ser indexadas ou analisadas.

Quando existirem exclusões ou filtros de termos sensíveis, é recomendável reconstruir o índice depois de alterar essas configurações.

Isto garante que os dados anteriormente indexados são substituídos por uma versão atualizada do índice.

## 20. Painel lateral do Lina

O painel lateral do Lina fica disponível na barra lateral do Obsidian.

É o local principal para usar a pesquisa e consultar o estado do plugin.

No painel lateral, o utilizador pode:

* pesquisar notas;
* escolher o modo de pesquisa;
* consultar resultados;
* abrir notas encontradas;
* verificar o estado do índice;
* verificar o estado dos embeddings;
* aceder a ações relacionadas com pesquisa e análise.

## 21. Modos do painel lateral

O painel lateral pode apresentar diferentes modos de pesquisa.

### Hybrid

Combina pesquisa textual e semântica.

É o modo recomendado para uso geral.

### Text

Usa apenas pesquisa textual.

É útil para procurar palavras, nomes, ficheiros, expressões exatas ou caminhos.

### Semantic

Usa apenas pesquisa semântica.

É útil para encontrar notas relacionadas por significado.

Requer embeddings gerados.

## 22. Resultados no painel lateral

Os resultados apresentados no painel lateral podem incluir:

* nome da nota;
* caminho;
* excerto relevante;
* origem do resultado;
* pontuação textual;
* similaridade semântica;
* pontuação combinada.

Ao clicar num resultado, o Lina abre a nota correspondente no Obsidian.

## 23. Estado do índice

O painel lateral pode mostrar informação sobre o índice.

Esta informação ajuda a perceber se o Lina já tem dados suficientes para pesquisar.

O estado do índice pode indicar, por exemplo:

* se existe índice;
* quantas notas foram indexadas;
* se há chunks disponíveis;
* se é necessário reconstruir o índice.

Quando a vault muda, pode ser necessário atualizar ou reconstruir o índice.

## 24. Estado dos embeddings

O estado dos embeddings indica se a pesquisa semântica está pronta a ser usada.

A pesquisa semântica depende da existência de embeddings.

Se os embeddings ainda não tiverem sido gerados, o Lina pode continuar a usar pesquisa textual.

Na pesquisa híbrida, se não houver embeddings disponíveis, o Lina pode recorrer apenas à pesquisa textual.

## 25. Fluxo recomendado de utilização

Um fluxo simples para começar a usar o Lina:

1. Instalar e ativar o plugin.
2. Confirmar as configurações básicas.
3. Criar manualmente o índice textual.
4. Testar a pesquisa textual.
5. Configurar embeddings.
6. Gerar embeddings.
7. Testar a pesquisa semântica.
8. Usar a pesquisa híbrida como modo principal.
9. Configurar a Analysis AI.
10. Testar a ligação ao provider de IA.
11. Analisar uma nota.
12. Rever as sugestões antes de aplicar qualquer alteração.

## 26. Fluxo recomendado com Ollama

Para usar IA local com Ollama:

1. Instalar o Ollama no computador.
2. Descarregar os modelos necessários.
3. Confirmar que o Ollama está em execução.
4. Configurar o provider Analysis AI como Ollama.
5. Definir o modelo de análise.
6. Configurar o provider Embeddings como Ollama.
7. Definir o modelo de embeddings.
8. Testar a ligação.
9. Gerar embeddings.
10. Usar análise e pesquisa híbrida.

Exemplos de modelos:

```text
Embeddings: nomic-embed-text
Analysis AI: gemma4:e2b
```

## 27. Privacidade

O Lina foi desenhado com foco em controlo local.

Por defeito:

* lê ficheiros Markdown da vault;
* cria dados locais em `.lina/`;
* não usa `localStorage`;
* não usa `sessionStorage`;
* não faz chamadas de rede;
* não altera notas automaticamente.

O conteúdo só deve ser enviado para serviços externos se o utilizador configurar explicitamente um provider remoto e executar uma ação que o utilize.

## 28. Sincronização

Se a vault estiver dentro de uma pasta sincronizada, como OneDrive, Google Drive, Dropbox ou outro serviço semelhante, a pasta `.lina/` também pode ser sincronizada.

Isto pode ter vantagens e desvantagens.

Vantagens:

* o índice pode acompanhar a vault;
* alguns dados operacionais podem estar disponíveis noutros dispositivos.

Desvantagens:

* ficheiros operacionais podem ocupar espaço;
* pode haver conflitos de sincronização;
* dados indexados podem circular pelo serviço de sincronização.

Cada utilizador deve decidir se pretende sincronizar `.lina/` ou excluir essa pasta da sincronização.

## 29. Boas práticas

Recomendações gerais:

* começar por testar o Lina numa vault pequena ou numa pasta de teste;
* confirmar as exclusões antes de indexar toda a vault;
* não guardar senhas ou tokens em notas indexadas;
* reconstruir o índice depois de mudar exclusões importantes;
* validar os resultados da pesquisa antes de confiar totalmente neles;
* rever sempre as sugestões de IA antes de aplicar alterações;
* usar Ollama quando o objetivo for manter tudo local;
* usar providers remotos apenas quando necessário e com consciência das implicações de privacidade.

## 30. Limitações atuais

O Lina está em alpha.

Algumas limitações atuais:

* os embeddings ainda são gerados manualmente;
* algumas funcionalidades móveis ainda estão em validação;
* a análise com IA usa contexto recuperado pela pesquisa híbrida;
* a pesquisa textual não substitui a pesquisa nativa completa do Obsidian;
* providers remotos ainda estão em evolução;
* PDF, DOCX, imagens e OCR fazem parte de desenvolvimento futuro.

## 31. Resumo rápido

O Lina ajuda a encontrar e melhorar notas dentro do Obsidian.

A pesquisa textual encontra palavras e caminhos.
A pesquisa semântica encontra significado.
A pesquisa híbrida combina as duas.
Os embeddings permitem a pesquisa por significado.
A AI Analysis sugere melhorias para a nota atual.
O painel lateral é o centro principal de pesquisa e consulta.
Ollama permite usar IA local.
Providers remotos podem ser usados, mas exigem atenção à privacidade.

O princípio principal do Lina é simples:

```text
Ajudar a organizar e compreender notas sem retirar controlo ao utilizador.
```
