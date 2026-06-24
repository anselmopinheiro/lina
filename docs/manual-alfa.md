# Manual alfa do Lina para Obsidian

## 1. Introdução

O Lina é um plugin para o Obsidian que permite pesquisar, organizar e analisar notas Markdown dentro do vault. Oferece três modos de pesquisa (textual, semântica e híbrida), indexação local de metadados e conteúdo, geração de embeddings locais e análise assistida por IA.

Este documento é o manual da versão alfa. O objetivo é orientar a instalação, configuração e primeiros testes do plugin, identificando o que funciona, o que é experimental e o que ainda está em desenvolvimento.

O Lina está desenhado para ser seguro: não altera notas do vault sem confirmação explícita, não gera embeddings automaticamente e mantém os dados do utilizador locais.

---

## 2. Requisitos

Para utilizar o Lina na versão alfa, é necessário:

- **Obsidian** instalado (versão estável recente).
- **Plugin Lina** copiado e ativado no vault.
- **Vault de teste** recomendado para os primeiros testes. Não utilizar o vault principal durante a alfa.
- **Notas Markdown** no vault. O Lina indexa apenas ficheiros `.md`.
- **Ollama** (opcional, mas necessário para embeddings locais e análise IA local).
  - Modelo de embeddings recomendado: `nomic-embed-text-v2-moe`.
  - Modelo de análise IA recomendado: `gemma4:e2b`.

Se não existir Ollama instalado, a pesquisa textual funciona normalmente. A pesquisa semântica e a híbrida requerem embeddings gerados. A análise IA requer um provider de IA configurado.

---

## 3. Instalação no vault de teste

1. Copiar a pasta do plugin Lina para a pasta `.obsidian/plugins/` do vault de teste.
2. No Obsidian, abrir Definições > Comunidade de plugins e ativar o Lina.
3. Abrir o painel lateral do Lina. Pode ser necessário usar o comando `Lina: mostrar painel lateral` ou ativar o painel pela barra lateral.
4. Confirmar que o painel lateral aparece com as secções "Pesquisa", "Ações rápidas" e "Estado".
5. Verificar que a mensagem inicial indica que o índice textual ainda não existe (é normal na primeira utilização).

[captura: painel lateral do Lina após instalação]

---

## 4. Configuração inicial

As definições do Lina estão disponíveis em Definições > Lina. As principais opções são:

- **Provider de embeddings**: escolher o provider para gerar embeddings locais. O padrão é Ollama.
- **Modelo de embeddings**: escolher o modelo. Recomendado: `nomic-embed-text-v2-moe`.
- **Provider de IA**: escolher o provider para análise de notas. Padrão: Ollama.
- **Modelo de IA**: escolher o modelo para análise. Recomendado: `gemma4:e2b`.
- **Atualização automática do índice**: se ativada, o índice textual é atualizado automaticamente quando se criam, editam ou eliminam notas.
- **Modo de diagnóstico**: permite ver informação detalhada sobre o estado do índice e dos embeddings.

[captura: definições do Lina]

---

## 5. Índice textual

### O que é

O índice textual é uma base de dados local que guarda metadados, excertos e hashes das notas do vault. Permite a pesquisa textual rápida sem reler todas as notas a cada pesquisa.

### Quando é criado

O índice é criado manualmente quando o utilizador clica em "Construir índice textual" no painel Estado, ou usando o comando `Lina: reconstruir índice textual`.

### Como reconstruir

1. Abrir o painel lateral do Lina.
2. Na secção Estado, clicar em "Ver detalhes".
3. Clicar em "Reconstruir índice textual" (ou "Construir índice textual" se ainda não existir).
4. Aguardar a conclusão.

### Como confirmar que está pronto

No painel Estado, deve aparecer:
- `Índice: pronto · N notas · M blocos`

A pesquisa textual depende de palavras e excertos reais das notas. Se o índice não estiver pronto, a pesquisa textual não devolve resultados.

[captura: painel Estado com índice pronto]

---

## 6. Embeddings locais

### O que são embeddings

Embeddings são representações numéricas do significado do texto. Permitem que o Lina compreenda o sentido das notas, não apenas as palavras exatas. Por exemplo, uma nota sobre "bicicleta azul" pode ser encontrada ao pesquisar "meio de transporte" se os embeddings estiverem gerados.

### Para que servem

Os embeddings são necessários para:
- Pesquisa semântica (procura por significado).
- Pesquisa híbrida (combina texto e significado).

Sem embeddings gerados, apenas a pesquisa textual funciona.

### Como gerar embeddings

1. Abrir o painel lateral do Lina.
2. Na secção Estado, clicar em "Ver detalhes".
3. Clicar em "Gerar embeddings locais" (ou "Atualizar embeddings locais" se já existirem alguns).
4. Aparece imediatamente a mensagem "A gerar embeddings locais..." e o botão fica temporariamente bloqueado.
5. Aguardar a conclusão. O tempo depende do número de notas e do modelo utilizado.
6. No fim, aparece uma mensagem de sucesso ou de erro.

### Notas novas e embeddings em falta

Quando se adicionam notas novas ao vault, os embeddings dessas notas não são gerados automaticamente. O painel Estado pode indicar "em falta" e é necessário gerar embeddings novamente para incluir as notas novas.

[captura: botão de gerar embeddings com aviso "A gerar embeddings locais..."]

---

## 7. Painel Estado

O painel Estado mostra a situação atual do índice e dos embeddings. Para o ver, abrir o painel lateral do Lina e expandir a secção "Estado".

### Resumo do índice

- `Índice: pronto · N notas · M blocos` — o índice textual está pronto e contém N notas e M blocos de texto.
- `Índice: em falta` — o índice ainda não foi construído.

### Resumo dos embeddings

O Lina mostra o estado dos embeddings com diferentes mensagens:

- **`Embeddings: prontos · N válidos`** — tudo está correto. Existem N embeddings válidos e compatíveis com a configuração atual.

- **`Embeddings: em falta · N válidos · M em falta`** — existem N embeddings válidos, mas M notas não têm embeddings. Isto acontece quando se adicionam notas novas sem gerar embeddings novamente.

- **`Embeddings: desatualizados · N válidos · P desatualizados`** — existem P embeddings que foram gerados com uma configuração diferente (modelo ou modo de prefixo alterado) e precisam de ser atualizados.

- **`Embeddings: atenção necessária · N válidos · M em falta · P desatualizados`** — existem simultaneamente notas sem embeddings e embeddings desatualizados.

- **`Embeddings: desatualizados ou incompatíveis`** — o provider ou modelo atual nas definições é diferente do que foi usado para gerar os embeddings. É necessário atualizar os embeddings antes de usar a pesquisa semântica ou híbrida.

### Detalhes dos embeddings

Ao clicar em "Ver detalhes", aparece informação adicional:

- **Provider dos embeddings**: o provider usado para gerar (ex.: ollama).
- **Modelo dos embeddings**: o modelo usado (ex.: nomic-embed-text-v2-moe).
- **Dimensão**: o tamanho do vetor de embeddings (ex.: 768).
- **Modo de prefixo**: como o texto é preparado antes de gerar embeddings. Para modelos Nomic, é "Nomic search_query/search_document".
- **Prefixo da query**: o prefixo aplicado à pesquisa (ex.: `search_query:`).
- **Prefixo dos documentos**: o prefixo aplicado ao índice (ex.: `search_document:`).
- **Modo guardado no manifesto**: o modo de prefixo que foi efetivamente usado ao gerar os embeddings.

### Prefixos Nomic

Os modelos Nomic (como `nomic-embed-text-v2-moe`) usam prefixos especiais para distinguir entre texto de pesquisa e texto de documento:

- Query: `search_query:`
- Documentos: `search_document:`

O Lina aplica estes prefixos automaticamente. Se o modo de prefixo guardado no manifesto for diferente do esperado, os embeddings estão desatualizados e devem ser regenerados.

### Avisos de compatibilidade

O painel Estado pode mostrar avisos quando existe incompatibilidade:

- **Provider diferente**: "Atenção: os embeddings foram gerados com outro provider. Atualize os embeddings antes de usar a pesquisa semântica."
- **Modelo diferente**: "Atenção: os embeddings foram gerados com outro modelo. Atualize os embeddings antes de usar a pesquisa semântica."
- **Modo de prefixo diferente**: "Atenção: os embeddings foram gerados com outro modo de prefixo. Atualize os embeddings."
- **Embeddings em falta**: "Existem embeddings em falta. Algumas notas recentes podem não aparecer na pesquisa semântica ou híbrida."
- **Embeddings desatualizados**: "Existem embeddings desatualizados. Atualize os embeddings para garantir resultados corretos."
- **Tudo correto**: "Embeddings compatíveis com a configuração atual." (aparece em verde)

[captura: painel Estado com embeddings prontos e compatíveis]

---

## 8. Pesquisa textual

### Quando usar

A pesquisa textual é útil quando se conhece o termo exato que se procura. Funciona sempre, mesmo sem embeddings gerados.

### Como funciona

A pesquisa textual procura termos concretos no índice. Mostra excertos com os termos encontrados destacados. Os resultados são agrupados por nota, mostrando o excerto mais relevante.

### Exemplos

- Pesquisar `bicicleta azul` encontra notas que contenham "bicicleta" e "azul".
- Pesquisar `marmeladaazul` encontra notas que contenham exatamente "marmeladaazul" (sem espaço).

### Limitações

A pesquisa textual não compreende sinónimos nem significado. Se a nota disser "veículo de duas rodas", a pesquisa por "bicicleta" não a encontra.

[captura: pesquisa textual com termos destacados]

---

## 9. Pesquisa semântica

### Quando usar

A pesquisa semântica é útil quando se procura por significado, não por palavras exatas. É especialmente útil quando não se recorda o termo preciso usado na nota.

### Como funciona

A pesquisa semântica usa os embeddings para comparar o significado da pesquisa com o significado das notas. Mostra resultados com uma percentagem de semelhança.

### Requisitos

- Embeddings gerados e válidos.
- O provider de embeddings deve estar acessível (ex.: Ollama ligado).

### Exemplos

- Pesquisar `meio de transporte` pode encontrar notas sobre bicicletas, autocarros ou carros.
- Pesquisar `forma de se deslocar pela cidade` pode encontrar notas sobre mobilidade urbana.
- Pesquisar `animal a correr` pode encontrar notas sobre cães ou cavalos.

### Estado atual

A pesquisa semântica é funcional, mas deve ser considerada experimental na versão alfa. Os resultados dependem da qualidade dos embeddings e do modelo utilizado.

[captura: pesquisa semântica com score de semelhança]

---

## 10. Pesquisa híbrida

### Quando usar

A pesquisa híbrida combina pesquisa textual e semântica. É o modo recomendado para a maioria das pesquisas, pois aproveita a precisão da pesquisa textual e a flexibilidade da pesquisa semântica.

### Como funciona

A pesquisa híbrida executa ambas as pesquisas em paralelo e combina os resultados. Cada resultado mostra:

- **Score final**: a pontuação combinada (ponderada).
- **Score textual**: a pontuação da componente textual.
- **Score semântico**: a pontuação da componente semântica.
- **Origem**: como o resultado foi encontrado.

### Origens possíveis

- `texto` — encontrado apenas pela componente textual.
- `semântica` — encontrado apenas pela componente semântica.
- `texto + semântica` — encontrado por ambas as componentes.

### Exemplos

- Pesquisar `forma de se deslocar pela cidade` pode encontrar notas por significado semântico e por palavras-chave textual.
- Pesquisar `meio de transporte urbano` combina resultados de ambas as componentes.
- Pesquisar `ir de um sítio para outro na cidade` pode encontrar notas sobre mobilidade.
- Pesquisar `veículo para mobilidade diária` pode encontrar notas sobre bicicletas ou transportes.

### Estado atual

A pesquisa híbrida é funcional e validada para a versão alfa, mas deve ser assinalada como experimental, pois os pesos e a combinação podem ser ajustados em versões futuras.

[captura: pesquisa híbrida com score textual e semântico]

---

## 11. Análise IA

### O que é

A análise IA permite que o Lina analise a nota aberta e sugira melhorias, título, organização ou ações rápidas, conforme o estado atual do plugin.

### Como funciona

1. Abrir uma nota no Obsidian.
2. No painel lateral do Lina, clicar em "Analisar nota atual" ou "Analisar com notas relacionadas".
3. O Lina envia o conteúdo da nota ao provider de IA configurado.
4. A resposta é apresentada no painel lateral, com sugestões estruturadas.

### Requisitos

- Provider de IA configurado (ex.: Ollama com `gemma4:e2b`).
- O provider deve estar acessível.

### Limitações na alfa

- Respostas locais podem demorar mais, especialmente com modelos grandes.
- Modelos locais pequenos podem ser menos consistentes nas sugestões.
- A análise IA não altera a nota automaticamente. O utilizador deve rever e confirmar qualquer alteração.

---

## 12. Renomear ficheiro

### Regra de nomes legíveis

O Lina segue uma regra clara para nomes de ficheiro:

- **H1 da nota**: título natural em português europeu, com acentos e espaços.
- **Nome do ficheiro**: igual ao H1, limpo apenas de caracteres inválidos para nomes de ficheiro.
- **Slug**: formato técnico com hífens, minúsculas e sem acentos. Usado apenas para YAML, URLs, IDs internos ou nomes técnicos. Nunca como título visível da nota.

### Exemplo correto

```
# Backup e Restauração de Drivers Windows
```

Nome do ficheiro: `Backup e Restauração de Drivers Windows.md`

O nome visível usa espaços, preserva acentos, usa capitalização natural e não duplica a extensão `.md`.

### Exemplo incorreto

```
backup-e-restauracao-de-drivers-windows.md
```

Este formato com hífens é um slug técnico. Não deve ser usado como nome visível da nota. Se aparecer como sugestão, é uma regressão.

### Regras adicionais

- Hífens ficam reservados para slugs, URLs, IDs internos ou nomes técnicos.
- O Lina não duplica a extensão `.md`.
- Caracteres inválidos para nomes de ficheiro (`\ / : * ? " < > |`) são substituídos por espaços.

[captura: proposta de renomeação de ficheiro com nome legível]

---

## 13. Notas em vários idiomas

As notas permanecem no idioma em que foram escritas. O Lina não traduz automaticamente notas, títulos, H1 ou nomes de ficheiro.

O multilingue, nesta fase, aplica-se ao idioma da interface e ao idioma predefinido usado como referência para embeddings.

### Idioma da interface

Na versão alfa, a interface do Lina está em português europeu. Nas definições do Lina, a opção "Idioma da interface" permite selecionar o idioma dos textos visíveis. Na alfa, o único idioma disponível é Português europeu.

### Idioma predefinido dos embeddings

A opção "Idioma predefinido dos embeddings" indica o idioma principal esperado para os embeddings. Esta opção não traduz notas nem altera o conteúdo; serve para orientar a configuração e futura validação dos modelos.

Opções disponíveis:
- **Português europeu** (`pt-PT`) — idioma predefinido.
- **Inglês** (`en`).
- **Espanhol** (`es`).
- **Francês** (`fr`).
- **Multilingue** (`multi`) — para vaults com notas em vários idiomas.
- **Automático** (`auto`) — o Lina tenta detetar o idioma.

### Vaults com vários idiomas

Em vaults com notas em vários idiomas, pode ser preferível usar um modelo de embeddings multilingue. A qualidade da pesquisa semântica depende do modelo de embeddings escolhido.

### Nomes de ficheiro e idioma

Os nomes de ficheiro continuam a respeitar o idioma natural da nota. O Lina não converte nomes para outro idioma. A regra de renomeação mantém-se:
- H1: título natural no idioma da nota.
- Nome do ficheiro: igual ao H1, limpo apenas de caracteres inválidos.
- Slug: apenas técnico, separado.

[captura: definições multilingue do Lina]

---

## 14. Boas práticas durante a alfa

- **Testar primeiro num vault de teste.** Não utilizar o vault principal durante a alfa.
- **Gerar embeddings depois de adicionar muitas notas.** Os embeddings não são gerados automaticamente.
- **Verificar o painel Estado antes de testar pesquisa semântica ou híbrida.** Confirmar que os embeddings estão prontos e compatíveis.
- **Não confiar cegamente nas sugestões da IA.** Rever sempre antes de aplicar.
- **Validar sempre as renomeações antes de aplicar.** O Lina pede confirmação, mas é bom verificar o nome proposto.

---

## 15. Problemas frequentes

### A pesquisa semântica não encontra notas recentes.

**Resposta:** Os embeddings podem estar em falta para as notas novas. Verificar o painel Estado e gerar embeddings locais.

### Mudei o modelo e a semântica deixou de funcionar.

**Resposta:** Os embeddings foram gerados com o modelo anterior e estão incompatíveis. Atualizar embeddings com o novo modelo.

### O Ollama está desligado e a pesquisa semântica falha.

**Resposta:** A componente semântica da pesquisa requer o provider de embeddings ativo. Ligar o Ollama ou mudar para outro provider.

### A pesquisa textual funciona, mas a semântica não.

**Resposta:** O índice textual pode estar pronto, mas os embeddings podem estar em falta ou desatualizados. Verificar o painel Estado.

### O nome sugerido para a nota parece técnico (com hífens).

**Resposta:** Na versão atual, o Lina deve propor nomes legíveis. Se aparecer um slug com hífens como sugestão, é uma regressão. Reportar o problema.

### Os embeddings mostram "desatualizados ou incompatíveis".

**Resposta:** O provider ou modelo nas definições foi alterado. Clicar em "Atualizar embeddings locais" no painel Estado para regenerar com a configuração atual.

### A análise IA não responde ou demora muito.

**Resposta:** Verificar se o Ollama está a correr e se o modelo configurado está disponível. Modelos locais grandes podem demorar mais. Aumentar o tempo limite nas definições se necessário.

---

## 16. Estado alfa validado

### Funcionalidades validadas

- [x] Pesquisa textual: validada.
- [x] Pesquisa semântica: validada.
- [x] Pesquisa híbrida: funcional e validada para alfa, mas experimental.
- [x] Feedback visual ao gerar embeddings: validado.
- [x] Painel Estado dos embeddings: melhorado.
- [x] Renomeação com nome legível: validada.

### Funcionalidades experimentais

- Pesquisa híbrida: funcional, mas os pesos e a combinação podem mudar.
- Pesquisa semântica: dependente da qualidade dos embeddings e do modelo.
- Análise IA: dependente do provider e modelo configurados.

### Funcionalidades previstas para versões futuras

- Análise de notas com contexto de notas relacionadas.
- Integração com mais providers de IA (OpenRouter, OpenAI, Anthropic, Gemini).
- Melhorias na organização automática de notas.
- Compatibilidade mobile completa.