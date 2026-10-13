# Lina — Glossary

Short explanations of the concepts used in Lina **0.3.2 (Alpha)**. For practical steps see the [Help](help.md).

## Producer
The device that prepares the search data for the vault: it builds and maintains the text index and, when enabled, generates embeddings and publishes them. Only the active Producer publishes. A vault can have more than one Producer device, but one is active at a time.

## Companion
A device (desktop or mobile) that uses the search data published by the Producer and synchronised to it. A Companion does not build the index or generate embeddings, and it does not replace the Producer.

## Text index
A local index of your Markdown notes (titles, paths, content split into chunks) used for keyword search. It needs no AI provider or network.

## Embeddings
Numeric representations of note chunks that capture meaning. They are produced by an embeddings provider and used by semantic and hybrid search.

## Vector artefacts (vector index)
The files Lina keeps with the embeddings so search can use them, plus an optional faster binary copy built from them. They live inside `.lina/` and are synchronised like the rest of the folder.

## Text search
Keyword search over titles, paths and content. Works without embeddings.

## Semantic search
Search by meaning: it finds related notes even when they use different words. Requires embeddings.

## Hybrid search
Combines text and semantic ranking in one list. If semantic data is unavailable it falls back to text search.

## Local provider
An AI or embeddings provider that runs on your own computer (for example Ollama with a Base URL pointing to this computer). Your note text stays on the machine and there is no API cost.

## Remote provider / API
A provider reached over the internet (for example Mistral or OpenRouter). It needs an API key, may charge costs billed by the provider, and processes the text Lina sends to it.

## AI analysis
Actions where an AI provider reads a note or selection and returns suggestions: note analysis, folder and Inbox analysis, `/ask`, `/tags` and `/yaml`. They run only when you start them, and nothing is written to a note without your confirmation.

## Exclusions
Rules that keep notes out of the index and out of what is sent to AI: excluded folders, excluded path terms and excluded content terms. They are edited on the Producer (Settings > Privacy & Exclusions) and shown read-only on Companions. If the exclusion policy cannot be validated, AI requests are blocked.

## `.lina`
The folder in your vault where Lina keeps its shared data: the search index, embeddings, ownership and state files, and exclusion policy. The whole `.lina` folder and everything inside it must be synchronised between the Producer and Companions. It is separate from the Obsidian configuration folder and from the plugin folder.

## Role
What a device is for in Lina: Producer or Companion. The role is chosen by you and saved only after confirmation.

## Active Producer
The Producer that currently holds the authority to publish shared data. You can transfer it to another Producer with a confirmation.
