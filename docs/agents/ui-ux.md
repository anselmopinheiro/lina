# docs/agents/ui-ux.md

## Regras para Interface e Experiência do Utilizador

### Princípios Gerais

* **Interface Simples**: A interface do plugin deve ser simples, minimalista e funcional. Evitar excesso de elementos visuais, opções complexas ou layouts confusos.
* **Português Europeu Correto**: Todos os textos visíveis na interface (rótulos, descrições, mensagens, notices, modals, settings) devem seguir o português europeu correto, incluindo acentos, cedilhas e terminologia PT-PT.
  * Exemplos: "pesquisar", "índice", "configurações", "ação", "conteúdo", "metadados".
* **Sem Ícones Salvo Pedido Explícito**: Não adicionar ícones ou elementos gráficos decorativos à interface, a menos que seja explicitamente solicitado numa tarefa.
* **Mensagens Notice Curtas**: As mensagens temporárias (Notice) devem ser curtas, diretas e informativas, evitando texto excessivo que desapareça antes de ser lido.
* **Modals Simples**: Os modais devem ser simples, com opções mínimas e claras. Evitar modais complexos com múltiplos separadores ou configurações avançadas sem necessidade.

### Definições

* **Evitar Excesso de Opções**: As definições do plugin devem conter apenas as opções estritamente necessárias. Opções avançadas ou raramente usadas devem ser evitadas ou colocadas numa secção recolhível.
* **Buy Me a Coffee**: As definições incluem um link para Buy Me a Coffee no topo, com imagem e texto de apoio ao projeto.
* **Toggles de Automação**: As definições incluem toggles para "Verificar sincronização ao iniciar" e "Atualizar índice ao iniciar", ambos desligados por defeito.

### Comandos

* **Comandos com Prefixo Lina**: Todos os comandos do plugin usam o prefixo "Lina: " para fácil identificação e organização na paleta de comandos do Obsidian.
* **Comandos Principais**: testar plugin, analisar vault, reconstruir índice, atualizar índice, verificar sincronização do índice, estado do índice, pesquisar no índice, estado geral.
* **Comandos de IA**: testar ligação ao Ollama, testar embedding, gerar embeddings, estado dos embeddings, pesquisa semântica.
* **Evitar Excesso de Comandos Novos**: Quando uma modal ou o estado geral resolvem o problema, preferir não adicionar comandos novos à paleta.

### Modal de Estado Geral

* A modal "Estado geral do Lina" mostra: Configuração, Índice, Embeddings, Sincronização e Ligação.
* Deve ser simples, legível e atualizada com os dados atuais do plugin.

### Textos Visíveis com PT-PT

* Garantir que todos os textos visíveis usam a ortografia correta do português europeu, incluindo:
  * Acentos: "índice", "conteúdo", "metadados", "pesquisa", "válido"
  * Cedilhas: "configuração", "execução", "informação"
  * Terminologia: "ficheiro" (não "arquivo"), "separador" (não "tab"), "ecrã" (não "tela"), "remover" (não "deletar"), "atalho" (não "shortcut")