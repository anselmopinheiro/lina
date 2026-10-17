# Freeze do desenvolvimento do Lina — o que se passa e porquê

> **Estado: o desenvolvimento está congelado.** O Lina continua a funcionar e a poder ser usado. Parámos para o observar em utilização real antes de decidir o que construir a seguir.

Versão em validação: **0.3.3**. A 0.3.4 **não começou**. Para as regras que os agentes seguem durante o freeze, ver [FREEZE-AGENTS.md](FREEZE-AGENTS.md).

---

## Em que estado está o Lina?

A 0.3.3 é o estado funcional que queremos testar no dia a dia. O objetivo imediato deixou de ser acrescentar funcionalidades: é perceber se o Lina, tal como está, é útil, estável e funcional.

O freeze **não significa abandono**. Significa que não se iniciam novas funcionalidades, refatorações preventivas, nem a 0.3.4, e que não se fazem alterações arquiteturais só porque se identificou uma oportunidade de melhoria. Continua a ser possível registar falhas reais e casos de regressão.

## O Lina deixou de funcionar?

Não. A pesquisa funciona. O que ficou pendente é um **limite de escalabilidade na forma como os embeddings são guardados**, que aparece quando o conjunto de embeddings cresce além de um certo tamanho (hoje, por volta de 2,8 mil trechos de notas).

## Porque parámos? (por ordem cronológica)

1. **Uma nota não aparecia nas pesquisas.** A nota `03_Pessoal/Administração/contactos/Perito seguros.md` não era encontrada em nenhum modo de pesquisa (textual, semântica ou híbrida). A causa era correta e inesperada: a pasta `03_Pessoal/` estava, por acidente, na lista de exclusões. A nota estava corretamente fora do corpus, e a pesquisa respeitou a exclusão.
2. **Ao remover a exclusão, a atualização dos embeddings falhou** com o erro `canonical-resource-limit-exceeded`.
3. **Investigámos.** O problema não é o provider (Mistral) nem as 1024 dimensões dos embeddings. É a arquitetura de persistência.

## Qual foi o problema e o que sabemos sobre a causa?

- O ficheiro de embeddings principal (`embeddings.jsonl`) guarda cada vetor de 1024 números como **texto**. É cerca de 5 vezes maior do que a representação binária equivalente.
- Cada atualização lê e analisa esse ficheiro várias vezes, inteiro, em memória.
- O Lina tem um limite de segurança de memória para estas leituras. Com cerca de **2887 trechos / 2624 embeddings**, o ficheiro novo passou esse limite.
- A atualização foi recusada e o estado anterior foi **preservado** (não houve corrupção nem perda de dados).
- A versão binária, usada para a pesquisa, continua bem abaixo do seu limite.

Em resumo: **é um teto de escalabilidade da persistência atual, não uma falha fundamental da pesquisa semântica.**

## Porque não corrigimos já?

Porque queremos primeiro perceber, em utilização real, se o Lina é útil como está, e recolher falhas reais que ajudem a desenhar a correção certa. Corrigir já arriscaria tratar o sintoma e fixar um desenho que ainda tem uma questão aberta (ver abaixo).

## O que aconteceu ao M-series?

Já existia no código um subsistema alternativo (chamado M-series, ou M0–M6) para guardar embeddings de outra forma. Analisámo-lo e decidimos **não o ativar na 0.3.4**. Resumidamente: o ficheiro de texto continuaria necessário na escrita; acrescentaria uma base de dados local que não é sincronizada entre dispositivos; não limpa as versões antigas (com implicações de privacidade, porque notas excluídas podiam permanecer nelas); e não resolve o limite de memória do telemóvel.

Estado: **dormente**. O código fica onde está, sem ser removido nem ativado.

## O que está previsto para a 0.3.4?

Uma **solução leve** sobre a arquitetura atual. Direção provável (ainda **não autorizada**):

- validar o tamanho antes de alterar o que está publicado;
- produzir a versão binária sem reler o ficheiro de texto inteiro;
- corrigir um comportamento de escrita que cresce de forma quadrática;
- usar de facto o binário válido na pesquisa em desktop;
- mostrar melhor o estado (por exemplo, quantos trechos já têm embedding);
- medir no Android antes de otimizar o telemóvel.

Mantém-se fixo: 1024 dimensões, sem reduzir dimensões, sem quantização, sem simplesmente aumentar limites, sem sharding.

## O que continua por decidir?

Há **uma questão arquitetural em aberto**, que **não** está decidida:

- Queremos que um candidato acima do limite falhe **antes** de alterar o que está publicado.
- Queremos também que o ficheiro de texto crescer **não impeça** a atualização do binário, enquanto este estiver dentro dos seus limites.

Estes dois objetivos chocam se o limite continuar a aplicar-se ao ficheiro de texto como hoje. Há uma hipótese considerada mais coerente (publicar o ficheiro de texto íntegro mesmo quando um dispositivo já não consegue carregá-lo inteiro), mas **não é uma decisão aprovada**. Será analisada quando o desenvolvimento for descongelado.

## O que devemos observar durante o freeze?

Usar o Lina normalmente e anotar falhas reais, no formato **query, modo de pesquisa (textual/semântica/híbrida), resultado esperado e resultado obtido**. Em particular:

- notas que deviam aparecer e não aparecem;
- comportamentos estranhos ao atualizar embeddings;
- diferenças entre desktop e telemóvel.

Estas anotações viram testes de regressão da 0.3.4. Dois casos já estão registados: o da nota `Perito seguros` (exclusão acidental) e o `canonical-resource-limit-exceeded`.

Registar uma falha **não** autoriza corrigi-la durante o freeze.

## Quando faz sentido retomar?

Quando houver confiança suficiente sobre a utilidade do Lina como está e casos reais suficientes para orientar a 0.3.4. A retoma exige uma **instrução humana inequívoca** para descongelar. Pedidos de análise ou de documentação não descongelam o desenvolvimento.

---

## Detalhe técnico

- Decisão e roadmap da 0.3.4: [architecture/LINA-0.3.4-DECISAO-ROADMAP-EMBEDDINGS-001.md](architecture/LINA-0.3.4-DECISAO-ROADMAP-EMBEDDINGS-001.md)
- Regras para agentes: [FREEZE-AGENTS.md](FREEZE-AGENTS.md)
- Índice documental: [INDEX.md](INDEX.md)
