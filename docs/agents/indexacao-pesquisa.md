# docs/agents/indexacao-pesquisa.md

## Regras para Indexação e Pesquisa

* **Scan do Vault**: O processo de scan do vault deve ser eficiente e não intrusivo, minimizando o impacto no desempenho do Obsidian. Deve ser capaz de lidar com grandes vaults.
* **Leitura de Markdown Segura**: A leitura de ficheiros Markdown deve ser segura, utilizando as APIs do Obsidian para aceder ao conteúdo das notas. Não deve ser feita qualquer alteração às notas durante a leitura.
* **Índice Local**: Manter um índice local dos metadados e conteúdo relevante das notas. Este índice deve ser persistente e reconstruído apenas quando necessário (ex: comando explícito do utilizador, alterações significativas no vault).
* **Excertos e Contagens**: As funcionalidades de extração de excertos, contagem de caracteres e palavras devem ser implementadas de forma a serem configuráveis e eficientes.
* **Pesquisa Simples**: A pesquisa inicial deve ser simples, baseada em correspondência de texto no índice. Deve permitir a abertura rápida da nota selecionada.
* **Futura Pesquisa Semântica**: A arquitetura deve prever a futura integração de pesquisa semântica, mas esta não deve ser implementada sem uma tarefa explícita para tal.
* **Não Alterar Notas**: Sob nenhuma circunstância o processo de indexação ou pesquisa deve alterar, criar ou apagar notas no vault do utilizador.
* **Não Criar Embeddings**: Não criar ou processar embeddings sem uma tarefa explícita para tal.
* **Não Chamar Ollama/Modelos de Linguagem**: Não realizar chamadas a modelos de linguagem (como Ollama, OpenRouter, etc.) nesta área do código sem autorização explícita e uma tarefa bem definida.
* **Preservar Estrutura de Dados Existente**: Ao estender o índice ou as funcionalidades de pesquisa, deve-se procurar preservar a estrutura de dados existente, evitando quebras de compatibilidade, a menos que seja estritamente necessário e justificado por uma melhoria significativa.