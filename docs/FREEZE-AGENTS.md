# FREEZE — instruções para agentes

**Estado: `FROZEN`**

O desenvolvimento do Lina está **congelado até autorização explícita de retoma**. Este documento é operacional e curto; o contexto humano está em [FREEZE.md](FREEZE.md) e a decisão técnica em [architecture/LINA-0.3.4-DECISAO-ROADMAP-EMBEDDINGS-001.md](architecture/LINA-0.3.4-DECISAO-ROADMAP-EMBEDDINGS-001.md).

Estado resumido:

| Item | Estado |
|---|---|
| Versão em validação funcional | **0.3.3** |
| Desenvolvimento | **FROZEN** |
| 0.3.4 | **não iniciada** |
| M-series (M0–M6) | **`DORMANT`** (código preservado, sem cutover, flags inalteradas) |
| Pendência do lifecycle (JSONL acima do limite vs rejeição pré-publicação) | **ABERTA** |

---

## Permitido

- Leitura do repositório e da documentação.
- Utilização normal do Lina.
- Diagnóstico pedido explicitamente pelo humano.
- Registo documental de falhas reais e recolha de casos de regressão (query, modo, resultado esperado).
- Tarefas explicitamente autorizadas pelo humano que **não** impliquem retoma implícita do desenvolvimento.

## Proibido sem autorização explícita de retoma

- Implementar a 0.3.4 ou qualquer parte da solução leve.
- Corrigir preventivamente os problemas descritos (incluindo `canonical-resource-limit-exceeded`).
- Alterar a arquitetura de embeddings, a persistência ou a publicação.
- Ativar o M-series, ou alterar as suas flags (`producerSqlite*`, `producerImmutableGenerationPublicationEnabled`, `companionPublishedGeneration*`).
- Alterar a dimensionalidade (1024 permanece fixa) ou avaliar 768/512.
- Alterar resource guards ou limites de recursos.
- Introduzir sharding ou quantização.
- Fazer refactoring oportunista.
- Transformar observações em implementação.
- Interpretar uma auditoria, discussão ou relatório como autorização para desenvolver.

## Contratos fixados (não reabrir)

1024 dimensões; sem quantização; sem aumento simples de resource limits; sem sharding; JSONL canónico mantido; binário não canónico; M-series dormente.

## Questão aberta (não decidir)

Colisão entre (1) rejeitar antes da publicação um candidato acima do resource limit e (2) impedir que o crescimento do JSONL bloqueie o binário dentro dos seus limites. Existe uma hipótese preferida, **não aprovada**. Decidir-se-á na primeira fase de desenho após descongelamento. Não a implementar nem a tratar como decidida.

## Regra de retoma

**Só uma instrução humana inequívoca para retomar ou descongelar o desenvolvimento permite iniciar implementação.**

Pedidos de análise, auditoria, documentação ou utilização normal **não** constituem descongelamento. Em caso de dúvida, assumir `FROZEN` e perguntar.
