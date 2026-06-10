# docs/agents/seguranca-notas.md

## Regras para Segurança das Notas do Utilizador

### Regra Máxima

* **Não Alterar Notas Sem Autorização Explícita**: Esta é a regra mais importante do plugin. Sob nenhuma circunstância o plugin ou o agente devem alterar, criar ou apagar notas no vault do utilizador sem autorização explícita e um mecanismo de confirmação rigoroso.

### Operações de Leitura

* **Operações de Leitura São Permitidas**: A leitura de notas é permitida quando solicitada ou quando faz parte de uma funcionalidade autorizada (ex: scan do vault para indexação, pesquisa, extração de excertos, verificação de sincronização). A leitura deve ser realizada sem modificar qualquer conteúdo.
* **Atualização Incremental e Leitura**: A atualização incremental do índice apenas lê o conteúdo de notas novas ou alteradas. Notas não alteradas não são lidas.

### Escrita em Markdown

* **Escrita em Markdown Só em Tarefas Específicas**: Qualquer funcionalidade de escrita ou modificação de notas em Markdown só deve ser implementada no contexto de uma tarefa específica que a exija. Nunca como efeito secundário de outra operação.
* **Sugestões Futuras em Modo Sugestão**: Funcionalidades futuras que sugiram alterações a notas (YAML, tags, links internos) devem começar em modo sugestão, apresentando a alteração proposta ao utilizador antes de aplicar.

### Confirmação

* **Confirmação Antes de Alterar Notas**: Antes de executar qualquer função que altere, crie ou apague notas, deve existir um mecanismo de confirmação explícita do utilizador (ex: modal de confirmação, Notice com opção de cancelar). Alterações automáticas ou silenciosas são proibidas.
* **Evitar Alterações em Massa Sem Mecanismo de Revisão**: Operações que afetem múltiplas notas (ex: atualizar tags em lote, renomear ficheiros) devem incluir um mecanismo de revisão e confirmação prévia, permitindo ao utilizador ver o que será alterado antes de aplicar.

### Proteção de Conteúdo

* **Proteger YAML, Tags, Links e Conteúdo Original**: Qualquer operação de modificação deve respeitar e preservar o formato YAML, as tags, os links internos do Obsidian e o conteúdo original, a menos que a modificação desses elementos seja o objetivo explícito da tarefa.
* **Preferir Modo Sugestão Antes de Aplicar Alterações**: Sempre que possível, o plugin deve primeiro apresentar sugestões de alteração ao utilizador (ex: mostrar diff, mostrar texto proposto) e só aplicar após confirmação explícita.

### Indexação e Automação

* **Indexação Não Altera Notas**: A indexação, reconstrução, atualização incremental e verificação de sincronização do índice não alteram notas Markdown.
* **Automação ao Iniciar Não Altera Conteúdo**: A automação opcional no arranque (verificação de sincronização, atualização incremental) nunca deve alterar conteúdo Markdown. A atualização incremental apenas atualiza o índice interno do plugin.
* **Geração de Embeddings Não Altera Notas**: A geração de embeddings apenas lê o conteúdo das notas e guarda dados no índice do plugin.