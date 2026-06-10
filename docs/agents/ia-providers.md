# docs/agents/ia-providers.md

## Regras para Integração com IA

*   **Arquitetura com Providers**: A integração com modelos de linguagem deve seguir uma arquitetura baseada em providers (ex: interface `LLMProvider`), permitindo alternar entre diferentes fornecedores de forma transparente.
*   **Providers Previstos**:
    *   Ollama (local)
    *   OpenRouter
    *   OpenAI
    *   Claude / Anthropic
    *   Gemini
*   **OllamaProvider**: Deve existir um provider para execução local via Ollama, para utilizadores que preferem processamento local sem dependências externas.
*   **OpenRouterProvider**: Deve existir um provider para acesso a modelos através do OpenRouter, oferecendo flexibilidade na escolha de modelos e fornecedores.
*   **Modelo de Chat Separado de Modelo de Embeddings**: A arquitetura deve permitir configurar separadamente o modelo usado para chat/conversação e o modelo usado para embeddings. São conceitos distintos e podem exigir modelos diferentes.
*   **Não Prender Arquitetura a Modelos Específicos**: A implementação não deve assumir ou depender de modelos específicos como Gemma, DeepSeek, GPT, etc. A arquitetura deve ser agnóstica em relação ao modelo subjacente.
*   **Settings para URL/Modelos**: As definições (settings) do plugin devem permitir configurar o URL do servidor (ex: endpoint do Ollama ou OpenRouter) e os modelos a usar para chat e embeddings.
*   **Chamadas Externas com Autorização Explícita**: Qualquer chamada a APIs externas (ex: OpenRouter) deve ser precedida de um mecanismo de autorização explícita do utilizador, respeitando a política de segurança do plugin.
*   **Cuidado Especial com Mobile**: Em dispositivos mobile, o Ollama local não estará disponível. A arquitetura deve prever esta limitação e, se aplicável, recorrer a providers remotos com a devida autorização do utilizador. Chamadas de rede em mobile devem ser eficientes e respeitar o consumo de dados.