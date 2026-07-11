# docs/agents/indexacao-pesquisa.md

## Regras para Indexação e Pesquisa

### Indexação

* **Scan do Vault**: O processo de scan do vault deve ser eficiente e não intrusivo, minimizando o impacto no desempenho do Obsidian. Deve ser capaz de lidar com grandes vaults.
* **Leitura de Markdown Segura**: A leitura de ficheiros Markdown deve ser segura, utilizando as APIs do Obsidian para aceder ao conteúdo das notas. Não deve ser feita qualquer alteração às notas durante a leitura.
* **Índice Local**: Manter um índice local dos metadados e conteúdo relevante das notas. O índice inclui metadados, excertos, contagens e embeddings opcionais. Deve ser persistente e reconstruído apenas quando necessário.
* **Excertos e Contagens**: As funcionalidades de extração de excertos, contagem de caracteres e palavras devem ser implementadas de forma a serem configuráveis e eficientes.
* **Atualização Incremental**: Quando existir um índice anterior, preferir atualização incremental (adicionar notas novas, atualizar notas alteradas, remover notas apagadas) em vez de reconstruir tudo. Não ler conteúdo de notas não alteradas em atualizações incrementais.
* **Preservação de Embeddings**: Ao reconstruir ou atualizar o índice, preservar embeddings de notas não alteradas. Remover embeddings de notas alteradas, porque o conteúdo mudou.
* **Verificação de Sincronização**: O plugin pode verificar a sincronização entre vault e índice sem alterar dados. Esta verificação calcula notas novas, alteradas, removidas, sem embedding e com embeddings potencialmente desatualizados.
* **Automação ao Iniciar**: O plugin pode verificar sincronização ou atualizar o índice de forma incremental ao iniciar, se o utilizador ativar essas opções. A automação deve ser leve e não bloquear o arranque. A geração de embeddings nunca deve ser automática.
* **Não Alterar Notas**: Sob nenhuma circunstância o processo de indexação ou pesquisa deve alterar, criar ou apagar notas no vault do utilizador.

* **Atualização Automática por Eventos**: Eventos do vault usados para atualização automática devem ser validados, filtrados, agregados por caminho e processados em modo single-flight. Eventos sem caminho válido ou sobre ficheiros internos em `.lina/` ou na pasta de configuração do Obsidian não podem carregar o índice nem entrar na fila.
* **Arranque Leve do Índice Textual**: O índice textual completo não deve ser carregado durante o arranque do Obsidian. Eventos emitidos durante o carregamento inicial do vault devem ser ignorados ou compactados num estado agregado, nunca guardados individualmente em centenas de entradas pendentes.

### Embeddings

* **Geração Manual e por Lote**: A geração de embeddings deve continuar manual, por lote e explicitamente acionada pelo utilizador.
* **Nunca Gerar Embeddings Automaticamente**: Não gerar embeddings em massa automaticamente no arranque nem como efeito secundário de outra operação.
* **Não Guardar Embeddings de Queries**: Não guardar embeddings de queries de pesquisa no índice.
* **Modelo Configurável**: O modelo de embeddings deve ser configurável nas definições, separado do modelo de chat.
* **Preservar ao Reconstruir**: Ao reconstruir o índice, preservar embeddings de notas cujo mtime não mudou.
* **Remover ao Alterar**: Quando uma nota é alterada, o embedding correspondente deve ser removido do índice até futura regeneração explícita.

### Pesquisa

* **Pesquisa Simples**: A pesquisa deve ser baseada em correspondência de texto no índice. Deve permitir a abertura rápida da nota selecionada.
* **Pesquisa Semântica**: A pesquisa semântica usa embeddings previamente gerados para encontrar notas com significado semelhante. Requer embeddings gerados explicitamente pelo utilizador.
* **Não Chamar Ollama/Modelos de Linguagem**: Não realizar chamadas a modelos de linguagem (como Ollama, OpenRouter, etc.) na área de indexação ou pesquisa sem autorização explícita e uma tarefa bem definida.

### Preservação de Dados

* **Não Alterar Notas**: Sob nenhuma circunstância o processo de indexação ou pesquisa deve alterar, criar ou apagar notas no vault do utilizador.
* **Preservar Estrutura de Dados Existente**: Ao estender o índice ou as funcionalidades de pesquisa, preservar a estrutura de dados existente, evitando quebras de compatibilidade, a menos que seja estritamente necessário e justificado.
