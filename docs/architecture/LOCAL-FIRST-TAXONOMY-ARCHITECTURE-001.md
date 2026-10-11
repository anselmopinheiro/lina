# Arquitetura e Validação Runtime — Taxonomia Local-First (LINA)

## 1. Visão Geral e Arquitetura Final

A recomendação taxonómica do Lina opera segundo o princípio **local-first**: o cofre (vault) e as notas estruturadas existentes são a fonte primária de verdade para metadados (propriedades YAML e Tags). A inteligência artificial (LLM) atua unicamente como fallback pontual para preencher lacunas onde a evidência local é inexistente ou estatisticamente insuficiente.

O pipeline estruturado segue o fluxo determinístico:

```text
Nota Ativa
  ↓
Vizinhança Semântica Existente (Runtime Embedding Index — 0 embeddings adicionais)
  ↓
Taxonomia Local Experimental (`runSemanticTaxonomyExperiment`)
  ↓
Plano Taxonómico (`TaxonomyPlan` — decisão local vs IA por propriedade)
  ↓
Execução Seletiva de IA (LLM consultado apenas para propriedades em lacuna — 0 chamadas adicionais)
  ↓
Reconciliação (`reconcileTaxonomyRecommendations` — precedência absoluta da evidência local)
  ↓
Pré-visualização Estruturada (Preview com badges informativos de origem e estado)
  ↓
Seleção Explícita pelo Utilizador
  ↓
Confirmação
  ↓
Aplicação à Nota Ativa
```

## Estado deste Checkpoint

Este documento descreve os motores, contratos e a validação de desenvolvimento da taxonomia local-first. O checkpoint que o acompanha consolida esses módulos autónomos, os seus testes e esta documentação.

A integração runtime em `src/search/linaSearchView.ts` permanece deliberadamente fora deste checkpoint, no working tree de desenvolvimento, por estar entrelaçada com alterações de UI não pertencentes à taxonomia. Consequentemente, este commit isolado não ativa sozinho o percurso runtime completo; essa integração será consolidada num Commit B posterior.

## 2. Princípios e Políticas

### 2.1 Eficiência e Custo Zero Adicional
- **0 Embeddings adicionais**: A vizinhança semântica de notas similares reutiliza estritamente os vetores já calculados e publicados no índice runtime (`runtimeEmbeddingIndex`). Nenhuma chamada de embedding é feita para derivar taxonomia.
- **0 Chamadas LLM adicionais**: A execução seletiva de IA utiliza a chamada de análise estruturada pré-existente (`runAiAnalysisOnNote`), instruindo o modelo a focar-se exclusivamente nas lacunas que a evidência local não cobre.

### 2.2 Identidade e Hierarquia de Tags
- As Tags do Obsidian suportam hierarquias compostas (`categoria/subcategoria`).
- A normalização e comparação preservam estritamente o separador `/`, respeitando maiúsculas/minúsculas e a identidade canónica do vocabulário do cofre.
- **Penalização de Entidades**: Tags sugeridas pelo LLM com padrão de entidade (ex.: nomes próprios capitalizados) sem correspondência ou histórico suficiente no cofre sofrem penalização de ranking, evitando poluição taxonómica com termos únicos.

### 2.3 Contrato YAML Tipado
- A leitura do frontmatter das notas vizinhas aceita valores escalares (`string`, `number`, `boolean`) e listas homogéneas de escalares.
- Valores numéricos e booleanos funcionam como evidência taxonómica sem coerções de tipo destrutivas.
- A geração de propostas graváveis estreita os tipos de volta ao contrato seguro de escrita do plugin.

### 2.4 Precedência na Reconciliação
- Quando uma propriedade atinge suporte local qualificado no cluster semântico, o valor local é adotado imediatamente no plano (`source = "local"`).
- O prompt do LLM é configurado para omitir essa propriedade ou marcá-la como já resolvida.
- Na reconciliação final, qualquer proposta derivada de evidência local sobrepõe-se a qualquer sugestão concorrente da IA.

## 3. Evidência Runtime Obtida

A validação em runtime foi executada no cofre real de testes sobre dois domínios distintos:

### Cluster Contactos EE
Testado em múltiplas notas de contactos escolares:
- `tipo = contacto_ee`: Suporte local de 9 em 10 vizinhos (90%).
- Tags locais com suporte >= 2: 0 ocorrências.
- **Plano gerado**:
  - `tipo` → **LOCAL** (adotado localmente sem necessidade de IA).
  - `Tags` → **IA** (fallback seletivo autorizado por suporte local insuficiente).
  - Restantes propriedades → **LOCAL** ou **IA** conforme a evidência observada.
- **Vizinhança semântica observada**: Similaridade cosseno entre 0,91 e 0,98.

### Cluster Fox / Alimentação
Controlo de validação em domínio completamente diferente (nutrição/pet):
- `tipo = snack` → **LOCAL** com suporte de 7 em 10 vizinhos (70%).
- `estado = gosta` → **LOCAL** com suporte de 5 em 10 vizinhos (50%).
- `Tags` → **IA** por suporte local disperso/insuficiente.
- **Vizinhança semântica observada**: Vizinhos semanticamente coerentes no domínio Fox/alimentação, com similaridade entre 0,85 e 0,88.

### Conclusão Runtime
- **Convergência dentro do cluster**: Confirmada (alta densidade de propriedades coincidentes entre notas semanticamente afins).
- **Divergência entre clusters**: Confirmada (isolamento de vocabulário e ausência de contaminação cruzada).
- **Decisão arquitetural**: Arquitetura local-first **APTA** nos casos testados.

## 4. Limitações Conhecidas e Decisões Protetoras

1. **Frontmatter nos Embeddings**: O frontmatter da nota ainda participa no texto a partir do qual os chunks de embeddings são gerados; uma dissociação completa entre corpo e cabeçalho na indexação semântica é um refinamento futuro.
2. **Dependência Inicial de IA para Tags**: Cofres recentes ou secções sem vocabulário estabelecido dependerão inicialmente de IA para tags até atingirem o limiar mínimo de suporte (>= 2 notas).
3. **Diagnóstico Experimental**: O contentor visual de diagnóstico experimental runtime permanece disponível na vista lateral nesta fase.
4. **Isolamento de Batch e Inbox**: Os fluxos automáticos de lote e processamento de Inbox mantêm o seu comportamento canónico inalterado.
5. **Falha Pré-existente Conhecida**: A suite completa de testes mantém exclusivamente a discrepância pré-existente documentada em `tests/index/m6DesktopRuntimeValidation.test.ts` (2302 chunks obtidos vs 2303 esperados), externa a este bloco de taxonomia.
