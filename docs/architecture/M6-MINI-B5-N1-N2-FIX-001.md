# M6 Mini-B5 — correção N1/N2

## Âmbito

Esta correção fecha os findings N1, N2 e N3 da auditoria Mini-B5. Não inicia M6, cutover, seleção de source ou cache de consumer.

## N1 — diagnóstico M3 manual

`diagnose-m3-canonical` já não força `producer`, flags SQLite ou equivalência. Antes de abrir SQLite, lê o role efetivo e as flags reais, exige ambiente desktop, role `producer`, `producerSqliteCanonicalEnabled` e uma fence de ownership obtida sem auto-claim. O relatório retorna `BLOCKED` com uma razão concreta quando uma precondição falha.

A fence é revalidada antes da escrita SQLite, antes da projeção legada e antes da publicação imutável/reprojeção. Uma escrita canónica bloqueada não desencadeia reprojeção. O diagnóstico permanece manual; o arranque não o agenda.

## N2 — gate de provenance do consumer

O gate puramente local aceita agora `structuralStatus` e `semanticStatus` do chamador. Só produz `eligible: true` com estrutura `VALID`, semântica `COMPATIBLE`, source provenance completa e ownership provenance completa, ambas compatíveis. Inputs ausentes ou parciais dão `UNKNOWN` e bloqueiam a elegibilidade; não existem defaults implícitos para estados estruturais ou semânticos.

O export anterior é mantido como alias compatível, e `evaluatePublishedGenerationForConsumer` identifica explicitamente a política canónica.

## N3 — cobertura

- O leitor rejeita uma geração v5 sem `embeddingInputHash` em cada record (`RECORDS_INVALID`).
- O teste de startup confirma que o callback de diagnóstico de `onload()` está vazio e não agenda os diagnósticos M3 nem SQLite runtime.
- O writer canónico é testado com uma fence inválida e não escreve SQLite nem projeção legada.

## Higiene local

`.lina-local/` foi acrescentado a `.gitignore` por representar estado local de runtime.
