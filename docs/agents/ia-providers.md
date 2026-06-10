# docs/agents/ia-providers.md

## Regras para Integração com IA

### Arquitetura

* **Arquitetura com Providers**: A integração com modelos de linguagem deve seguir uma arquitetura baseada em providers, permitindo alternar entre diferentes fornecedores de forma transparente.
* **Providers Previstos**:
  * Ollama (local) — funcional para ligação, embeddings e, em breve, geração de texto.
  * OpenRouter — previsto, sem implementação funcional.
  * OpenAI — previsto, sem implementação funcional.
  * Claude / Anthropic — previsto, sem implementação funcional.
  * Gemini — previsto, sem implementação funcional.
* **Modelo de Chat Separado de Modelo de Embeddings**: A arquitetura permite configurar separadamente o modelo usado para chat/conversação e o modelo usado para embeddings. São conceitos distintos e podem exigir modelos diferentes. Não usar o modelo de chat para embeddings.
* **Não Prender Arquitetura a Modelos Específicos**: A implementação não deve assumir ou depender de modelos específicos. A arquitetura deve ser agnóstica em relação ao modelo subjacente.

### Estado Atual do Ollama

* **Teste de Ligação**: Comando funcional que verifica a ligação ao Ollama local via endpoint `/api/tags`.
* **Teste de Embeddings**: Comando funcional que gera um embedding de teste e devolve a dimensão.
* **Geração de Embeddings por Lote**: Funcional, com tamanho de lote configurável, usando modelo configurável.
* **Pesquisa Semântica**: Funcional, usando embeddings previamente gerados.
* **Geração de Texto**: Ainda não implementada. A Fase 3A será o teste controlado de geração de resposta com Ollama.
* **Modelo Recomendado para Embeddings**: `nomic-embed-text:latest`.

### Definições

* **Settings para URL/Modelos**: As definições do plugin permitem configurar o URL do servidor e os modelos a usar para chat e embeddings.
* **Não Guardar API Keys**: Não guardar chaves de API sem uma tarefa explícita para tal.
* **Chamadas Externas com Autorização Explícita**: Qualquer chamada a APIs externas deve ser precedida de um mecanismo de autorização explícita do utilizador.

### Mobile

* **Cuidado Especial com Mobile**: Em dispositivos mobile, o Ollama local não estará disponível. A arquitetura deve prever esta limitação e, se aplicável, recorrer a providers remotos com a devida autorização do utilizador.
* **Providers Externos Ainda Não Implementados**: OpenRouter, OpenAI, Anthropic e Gemini continuam apenas previstos, sem implementação funcional. Não implementar sem autorização explícita.