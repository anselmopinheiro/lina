# Taxonomia local-first — arquitetura, contratos e estado final

Documento canónico da recomendação de Tags e propriedades YAML do Lina segundo o princípio
**local-first**. Descreve o que está implementado e publicado, os contratos que não podem
regredir e o que fica explicitamente por fazer. Não é um diário de fases.

**Estado: `CONSOLIDADA`.** A integração está publicada em `master` e validada em runtime real.

| Camada | Commit | Conteúdo |
|---|---|---|
| Motores autónomos | `fbb2e8e` | `semanticNeighborhood`, `semanticTaxonomyExperiment`, `taxonomyPlan`, `taxonomyReconciliation`, contratos de Tags/YAML, diagnóstico |
| Checkpoint UI | `8c6ec8b` | Painel de pesquisa e análise (base estrutural da integração) |
| Integração runtime | `c89c3e3` | `taxonomyRuntime`, wiring em `linaSearchView`, hierarquia de tags, correção `internalLinks` |

## 1. Princípio

> **Local suportado > IA.** A taxonomia já usada no vault, observada em notas semanticamente
> próximas, é a fonte primária. A IA preenche apenas as lacunas em que a evidência local não
> tem suporte suficiente. O Lina nunca grava sem seleção e confirmação explícitas.

## 2. Arquitetura implementada

```text
nota atual (análise individual)
  → RuntimeEmbeddingIndex já residente           (getRuntimeEmbeddingIndex, vetores por chunk)
  → vizinhança semântica                         (findSemanticNeighborhood, top-K = 10)
  → metadataCache                                (tags e frontmatter das notas vizinhas)
  → taxonomia observada nos vizinhos             (runSemanticTaxonomyExperiment)
  → TaxonomyPlan                                 (buildTaxonomyPlan: local | IA, por tags e por propriedade)
  → TaxonomyAiRequest                            (só as lacunas)
  → única chamada IA já existente                (generateTextWithActiveAiProfile)
  → reconciliação local-first                    (reconcileTaxonomyRuntime)
  → preview → seleção → confirmação → escrita    (fluxo existente, inalterado)
```

| Responsabilidade | Módulo |
|---|---|
| Vizinhança por nota (média normalizada dos vetores dos chunks) | `src/search/semanticNeighborhood.ts` |
| Taxonomia observada (suporte, evidência por propriedade/valor) | `src/search/semanticTaxonomyExperiment.ts` |
| Plano e política de suficiência | `src/search/taxonomyPlan.ts` |
| Pedido de IA e reconciliação | `src/search/taxonomyReconciliation.ts` |
| Fronteira pura vista ↔ decisão (`prepare`/`reconcile`/`fallback`) | `src/search/taxonomyRuntime.ts` |
| Identidade de Tags, candidatos contextuais, entidades | `src/search/tagRecommendation.ts` |
| Contrato YAML tipado, propostas | `src/search/yamlRecommendation.ts` |
| Contexto Obsidian, chamada ao provider, UI, escrita | `src/search/linaSearchView.ts` |

`LinaSearchView` mantém o contexto Obsidian, a chamada ao provider, a UI, a seleção, a
confirmação e a escrita. **As regras de decisão local-first não vivem na vista**; vivem em
`taxonomyPlan`/`taxonomyReconciliation`, acedidas por `taxonomyRuntime`.

## 3. Invariantes de custo

| Por análise | Valor |
|---|---|
| Embeddings adicionais | **0** |
| Chamadas LLM adicionais | **0** (a chamada é a mesma; só muda o prompt) |
| Pedidos de rede adicionais | **0** |
| Persistência adicional | **0** |
| Novo índice | **0** |

Reutilização exclusiva de `RuntimeEmbeddingIndex` e `metadataCache`. Protegido por testes
estáticos em `tests/search/taxonomyRuntime.test.ts` (módulos de decisão sem I/O; a análise normal
faz uma única chamada ao provider).

## 4. Contratos

### 4.1 Plano e suficiência

- `TAXONOMY_MINIMUM_SUPPORT = 2`: uma tag ou valor YAML só adquire autoridade local com suporte
  em **pelo menos 2** notas vizinhas. **Mantido; não reduzir para 1.**
- `TAXONOMY_MINIMUM_QUALIFYING_TAGS = 1`: basta uma tag com suporte ≥ 2 para as tags locais serem
  suficientes (`LOCAL_SUFFICIENT`).
- Por propriedade YAML, o plano distingue: `local-supported`, `no-candidate`,
  `insufficient-support`, `ambiguous` (valores concorrentes com suporte igual), `not-writable`
  (evidência tipada que o contrato de escrita não aceita) e `neighborhood-unavailable`.
- Vizinhança indisponível (nota não indexada ou índice incompatível) ⇒ tudo `needsAi`.

### 4.2 Tags hierárquicas

`a/b ≠ ab`. A identidade da tag preserva `/` da recomendação até à escrita (`preserveTagIdentity`,
`preserveTagIdentities`: mantém a grafia da primeira ocorrência). A normalização
(`normalizeTagComparisonKey`) serve **apenas comparação e deduplicação**: é insensível a
maiúsculas e acentos, mas retém `/`, pelo que uma tag hierárquica nunca colide com a sua versão
achatada.

### 4.3 YAML tipado

- Leitura contextual aceita `string`, `number`, `boolean` e arrays homogéneos de escalares
  (`readYamlMetadataScalars`).
- A comparação mantém o tipo (`yamlComparisonKey`: `true ≠ "true"`, `1 ≠ "1"`).
- A escrita aceita apenas o contrato gravável (`toYamlSuggestionValue`: string ou lista de
  strings). Valores `number`/`boolean` são evidência, **não** são coercidos para string; ficam
  `not-writable`.
- As propriedades respeitam `yamlAllowedProperties`; `tags` nunca entra no bloco YAML.

### 4.4 Precedência e reconciliação

- Valor local suportado vence sempre o da IA.
- A IA só pode preencher campos **explicitamente pedidos**. São ignorados: propriedades fora da
  allow-list, valores para propriedades já resolvidas localmente, valores não graváveis e
  duplicados.
- O resultado é determinístico para a mesma entrada.

### 4.5 Fallback

Sem índice, plano ou evidência suficiente: prompt e reconciliação **históricos**. Se a IA falhar
e existirem candidatos locais válidos, `fallbackTaxonomyRuntime` preserva-os para revisão com um
aviso. Nunca há segunda chamada LLM; a análise não é bloqueada por ausência de plano.

### 4.6 Prompt

Com pedido taxonómico, o prompt omite tags e/ou propriedades já resolvidas localmente; quando a
IA ainda tem de sugerir tags, **as regras históricas de tags mantêm-se**. Sem plano o prompt é
idêntico, byte a byte, ao histórico. O JSON de exemplo contém `"internalLinks"` exatamente uma
vez (ver §8).

## 5. Validação em runtime real

Observações do responsável do projeto no vault real. Não são reproduzíveis a partir do
repositório; os valores abaixo são o registo da validação.

| Cenário | Vizinhança | Resultado do plano |
|---|---|---|
| Contactos EE | Notas distintas do mesmo domínio | `tipo = contacto_ee`, suporte **9/10** → local |
| Alimentação / Fox | Domínio alimentação/Fox | `tipo = snack`, suporte **5/10**; `estado = gosta`, suporte **5/10** → local |
| Nota de aluno | Vizinhança escolar/alunos correta | Evidência taxonómica insuficiente → **IA necessária**, sem consenso local inventado |

- **YAML local-first: `VALIDADO EM RUNTIME`.**
- **Separação semântica: `VALIDADA`.** Quatro notas em três domínios: convergência forte nos
  Contactos EE, cluster distinto de alimentação/Fox, cluster escolar/alunos coerente, sem
  contaminação taxonómica entre domínios.
- **Fallback IA: `VALIDADO`.** Quando a evidência local não basta, a IA é usada e nenhum consenso
  local é fabricado.

> Nota de reconciliação: a versão anterior deste documento registava `tipo = snack` com 7/10 no
> cluster Fox. Prevalece o valor consolidado na validação final (5/10).

## 6. Tags: baixa densidade e bootstrap

O vault tem atualmente poucas tags; é normal observar `Tags locais com suporte ≥ 2: 0`. **Isto
não é um defeito**: o motor exige suporte ≥ 2 antes de uma tag ganhar autoridade local. Num vault
de baixa densidade, o fallback para IA é o comportamento esperado.

```text
poucas tags
  → IA propõe
  → o utilizador seleciona e confirma
  → a tag passa a existir
  → o uso em notas semanticamente próximas aumenta o suporte
  → suporte ≥ 2 permite recomendação local futura
```

Não existe aprendizagem oculta nem escrita automática: a taxonomia cresce apenas pelas decisões
explícitas do utilizador.

## 7. Âmbito

### 7.1 Batch e Inbox

O comportamento histórico é preservado. A integração local-first aplica-se à **análise
individual** de uma nota. Os fluxos de lote (Inbox e pasta) não usam plano, runtime nem
diagnóstico taxonómico, e o seu prompt não recebe pedido taxonómico (testado). Nota: reanalisar
individualmente um cartão da Inbox usa o fluxo da análise individual, logo beneficia do plano.

### 7.2 Diagnóstico experimental

`Diagnóstico experimental — taxonomia local` mantém-se **temporariamente** como observabilidade:
só leitura, sem escrita, sem IA nem embeddings adicionais, apenas na análise individual; mostra
vizinhos, similaridade, suporte e plano. A decisão de o remover é futura (§10).

## 8. `internalLinks`

`RESOLVIDO — COBERTO POR REGRESSÃO.` Os prompt builders duplicavam `"internalLinks"` no JSON de
exemplo quando os campos taxonómicos eram inseridos. Os campos taxonómicos entram agora num único
ponto e o `"internalLinks"` permanece no template, uma só vez. Os testes cobrem pedido ativo,
parcial, tudo local e sem plano, nas duas variantes do prompt, verificam que o JSON de exemplo é
parseável e que, sem plano, o prompt é equivalente byte a byte ao histórico.

## 9. Baseline de testes (Commit B)

| Verificação | Resultado |
|---|---|
| runtime / plan / reconciliation / hierarchy | PASS |
| `tests/search` | 29 ficheiros / 322 testes PASS |
| Suíte completa | 2567 / 2568 |
| `typecheck`, `lint` (incl. strict), `build`, `release-check`, `git diff --check` | PASS |

Única falha conhecida: `tests/index/m6DesktopRuntimeValidation.test.ts` (esperado 2303, obtido
2302). É preexistente, não pertence à taxonomia e não foi corrigida.

## 10. Limitações e evolução futura

### 10.1 Limitações conhecidas

1. **Frontmatter nos embeddings.** O frontmatter ainda faz parte do texto de que derivam os
   chunks; uma dissociação completa entre corpo e cabeçalho na indexação é um refinamento futuro
   e exigiria reindexação (fora desta fase).
2. **Penalização de entidades.** Aplica-se no caminho histórico (candidatos contextuais). No
   caminho local-first as tags da IA só são pedidas quando não há candidatos locais, pelo que a
   penalização não intervém.
3. **Tags dependentes de IA em vaults recentes** até haver vocabulário com suporte ≥ 2 (§6).

### 10.2 Ideia futura — não implementada

```text
suporte ≥ 2   → autoridade local (recomendação local)
suporte = 1   → possível vocabulário/contexto preferencial para a IA, sem recomendação automática
tag inexistente → a IA pode criá-la se necessário
```

Objetivo: favorecer a convergência lexical **sem baixar o threshold de segurança**.
Estado: `IDEIA FUTURA — NÃO IMPLEMENTADA — NÃO BLOQUEIA A CONSOLIDAÇÃO`.

### 10.3 Pendências futuras (apenas registadas)

1. Vocabulário preferencial para a IA com tags de suporte 1.
2. Observar o crescimento e a convergência da taxonomia após uso real.
3. Decidir quando remover o diagnóstico experimental.

## 11. Critérios de encerramento

```text
Taxonomia local-first:    CONSOLIDADA
YAML local-first:         VALIDADO EM RUNTIME
Separação semântica:      VALIDADA
Fallback IA:              VALIDADO
Tags:                     bootstrap esperado (baixa densidade atual)
Threshold ≥ 2:            MANTIDO
Hierarquia de tags:       PRESERVADA
YAML tipado:              PRESERVADO
Custos adicionais:        ZERO
Batch/Inbox:              INALTERADOS
internalLinks:            RESOLVIDO
Diagnóstico experimental: MANTIDO TEMPORARIAMENTE
```

## 12. Testes de referência

`tests/search/taxonomyRuntime.test.ts`, `taxonomyPlan.test.ts`, `taxonomyReconciliation.test.ts`,
`tagHierarchyIdentity.test.ts`, `semanticNeighborhood.test.ts`,
`semanticTaxonomyExperiment.test.ts`, `semanticTaxonomyDiagnostic.test.ts`,
`tagRecommendation.test.ts`, `yamlRecommendation.test.ts`.
