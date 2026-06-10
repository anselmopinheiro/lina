# Lina

Assistente para Obsidian focado em pesquisa, organização e enriquecimento de notas Markdown.

## Estado do projeto

Plugin em desenvolvimento.

## Funcionalidades atuais

- Leitura segura de notas Markdown do vault.
- Índice local com metadados.
- Excertos e contagens.
- Pesquisa simples no índice.
- Definições para providers de IA.
- Teste de ligação ao Ollama.
- Teste de embeddings com Ollama.

## Requisitos

- Obsidian.
- Node.js para desenvolvimento.
- Ollama (opcional, necessário apenas para funcionalidades locais de IA).
- Modelo de embeddings recomendado: `nomic-embed-text:latest`.

## Instalação para desenvolvimento

1. Clone ou coloque os ficheiros do plugin em `<Vault>/.obsidian/plugins/lina/`.
2. Abra o terminal na pasta do plugin e execute:
   ```
   npm install
   npm run build
   ```
3. Os ficheiros necessários são:
   - `manifest.json`
   - `main.js`
   - `styles.css`

## Instalação manual no Obsidian

1. Copie os ficheiros `manifest.json`, `main.js` e `styles.css` para `<Vault>/.obsidian/plugins/lina/`.
2. No Obsidian, vá a **Definições → Plugins da comunidade**.
3. Ative o plugin **Lina**.

## Configuração no Obsidian

1. Vá a **Definições → Plugins da comunidade → Lina**.
2. Configure o provider de IA (Ollama, OpenRouter, OpenAI, Claude/Anthropic ou Gemini).
3. Se usar Ollama, defina a URL do servidor (padrão: `http://localhost:11434`).
4. Defina os modelos de chat e de embeddings.
5. Opcionalmente, pode ativar **Verificar sincronização ao iniciar** ou **Atualizar índice ao iniciar**.

## Automação opcional no arranque

- **Verificar sincronização ao iniciar**: verifica se o vault e o índice estão sincronizados quando o plugin arranca, sem alterar o índice.
- **Atualizar índice ao iniciar**: executa uma atualização incremental do índice no arranque, sem gerar embeddings.
- Se ambas estiverem ativadas, a atualização incremental tem prioridade.

## Comandos disponíveis

| Comando | Descrição |
|---------|-----------|
| Lina: testar plugin | Verifica se o plugin está ativo. |
| Lina: analisar vault | Mostra o número de notas Markdown no vault. |
| Lina: reconstruir índice | Reconstrói o índice local de metadados. |
| Lina: estado do índice | Mostra o estado atual do índice. |
| Lina: pesquisar no índice | Abre o modal de pesquisa no índice. |
| Lina: testar ligação ao Ollama | Testa a ligação ao servidor Ollama configurado. |
| Lina: testar embedding | Gera um embedding de teste com o Ollama. |
| Lina: gerar embeddings | Gera embeddings para notas do índice usando o Ollama. |
| Lina: estado dos embeddings | Mostra quantas notas têm embeddings. |
| Lina: pesquisa semântica | Pesquisa semanticamente nas notas com embeddings. |

## Privacidade

As funcionalidades atuais trabalham exclusivamente de forma local. Nenhuma nota do vault é alterada sem autorização explícita. Chamadas a serviços externos só ocorrerão quando forem configuradas e autorizadas pelo utilizador.

## Apoiar o projeto

O Lina é desenvolvido de forma independente. Se este plugin lhe for útil, considere apoiar o desenvolvimento através de [Buy Me a Coffee](https://www.buymeacoffee.com/apinheiro).

---

**Nota:** O plugin encontra-se em desenvolvimento ativo. Funcionalidades podem ser adicionadas, alteradas ou removidas a qualquer momento.