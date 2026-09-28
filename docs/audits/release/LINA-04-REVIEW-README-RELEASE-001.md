# LINA-04 — Revisão do README para release 0.3.0

## 1. Estado inicial

O README já indicava a versão 0.3.0 e refletia as capacidades principais, mas incluía detalhes internos de schemas, migrations, ficheiros operacionais e lifecycle que não são adequados ao resumo público de uma release. Também mantinha referências de navegação que já não correspondiam à organização final das Settings.

## 2. Referências analisadas

- Badge e cabeçalho de versão: `0.3.0`.
- Descrição de pesquisa semântica e embeddings.
- Papéis Producer e Companion.
- Limites de sincronização e `.lina/producer/`.
- `data.json` e configuração local do dispositivo.
- Estrutura pública de Settings e referências à organização anterior.

## 3. Alterações realizadas

- Simplificada a explicação de pesquisa semântica entre dispositivos para uma perspetiva de utilizador: Producer prepara e publica dados; Companion consome os dados publicados sem assumir a configuração de origem.
- Mantida a degradação segura para pesquisa textual e a confirmação para atualizações cloud.
- Corrigida a descrição de `.lina/producer/`: área operacional do Producer, não destinada a sincronização, sem promessa de isolamento privado absoluto.
- Declarado explicitamente que `data.json` é **Local Device Configuration**, não configuração partilhada nem autoridade multi-dispositivo.
- Atualizada a navegação para Geral, Pesquisa, IA, Produtor, Companion, Sincronização, Diagnóstico e Avançado.
- Removidos detalhes internos de schemas, migrations, precedência, nomes de contratos e ficheiros de implementação do README público.
- Corrigida a referência de mudança de papel para **Settings > Geral / General**.

## 4. Inconsistências encontradas

- Referências antigas à organização de Settings e a “Current Device”.
- Explicação demasiado interna sobre schema, migrations, contratos e estado operacional.
- Linguagem de sincronização que precisava de explicitar a limitação prática da área `.lina/producer/` dentro do vault.

Todas foram resolvidas apenas no README.

## 5. Alinhamento com 0.3.0

O README confirma a versão 0.3.0 e apresenta pesquisa semântica, embeddings, arquitetura Producer/Companion e a organização atual das Settings sem referências à estrutura anterior. A descrição pública preserva os limites corretos de sincronização e de configuração local.

## 6. Ausência de alterações de código

Esta tarefa alterou apenas `README.md` e este relatório. Não foram modificados código, testes, schemas, storage, contratos ou arquitetura.
