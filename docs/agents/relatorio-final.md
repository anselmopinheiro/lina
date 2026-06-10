# docs/agents/relatorio-final.md

## Formato Obrigatório para Relatório Final

No final de cada tarefa, o agente deve apresentar um relatório curto seguindo o formato abaixo.

### Estrutura Obrigatória

1. **Ficheiros alterados/criados**
   Lista de ficheiros que foram modificados ou criados durante a tarefa.

2. **Resumo do que foi implementado**
   Descrição concisa do que foi feito, incluindo o objetivo da tarefa e as principais decisões tomadas.

3. **Comandos executados**
   Lista de comandos CLI que foram executados durante a tarefa, se aplicável.

4. **Resultado do `npm run build`**
   Indicação do resultado da compilação do plugin. Deve referir se o build foi bem-sucedido ou se houve erros/avisos.

5. **Como testar no Obsidian**
   Instruções curtas sobre como testar a funcionalidade implementada no Obsidian (ex: comando a executar, configuração a verificar, etc.).

6. **Riscos/pontos a validar**
   Lista de riscos identificados, pontos de atenção ou validações adicionais necessárias.

7. **Confirmação de que nenhuma nota foi alterada (quando aplicável)**
   Declaração explícita de que nenhuma nota do vault do utilizador foi alterada, criada ou apagada durante a execução da tarefa.

8. **Indicação de adequação do modelo**
   Indicação se a tarefa era adequada para modelo local/económico ou se exigia um modelo superior, justificando a classificação.

---

### Exemplo de Utilização

```
## Relatório Final

### Ficheiros alterados/criados
- `src/novo-modulo.ts` (criado)
- `src/modulo-existente.ts` (alterado)

### Resumo
Implementada funcionalidade X que permite ao utilizador Y.

### Comandos executados
- `npm run build`

### Resultado do `npm run build`
Build bem-sucedido sem erros ou avisos.

### Como testar no Obsidian
Recarregar o plugin (Ctrl+R) e executar o comando "Lina: novo comando".

### Riscos/pontos a validar
- Verificar compatibilidade com vaults com mais de 1000 notas.

### Confirmação de alteração de notas
Nenhuma nota do vault foi alterada durante esta tarefa.

### Adequação do modelo
Tarefa adequada para modelo local/económico. (ou: Tarefa exigiu modelo superior devido a...)