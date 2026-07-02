# Lina commands

The Lina input supports slash commands in English.

## Current behaviour

Text without a slash runs the normal search flow.

Example:

```text
meeting notes
```

## Rules

- Plain text without a leading slash runs the existing search flow.
- Text starting with `/` is treated as a command and must not trigger accidental search.
- Reserved commands that are not implemented show a short "not available" message.
- Unknown commands show a short "not recognized" message.
- Contextual AI commands must respect configured content exclusions.
- `/ask` rechecks the final context immediately before contacting the AI provider. If the selected text, preserved selection, or current note matches excluded content terms, nothing is sent.
- Commands must not modify notes without an explicit confirmation flow.
- Applying an `/ask` response is blocked if the active note is no longer the note that provided the context, if the saved selection no longer matches the current content, or if the current note content matches configured exclusions.

## Implemented commands

### `/ask <prompt>`

Asks the configured text AI provider about the current context.

Examples:

```text
/ask continue this paragraph
/ask make this clearer
/ask explain this excerpt
```

Context selection:

- If the active Markdown editor has selected text, Lina sends only that selected text.
- If focusing the Lina input clears the editor selection, Lina tries to use the last valid selection captured from the same active note.
- If there is no selection, Lina sends the current note content.
- The context is capped by Lina's existing AI content limit.
- If the chosen context matches excluded content terms, the request is blocked before the AI prompt is built.

Output:

- The answer is shown in the Lina side panel.
- A copy button is available.
- If the context has a valid captured selection, actions are available to insert the answer below that selection or replace that selection.
- An action is available to insert the answer at the end of the note, including when there is no valid selection.
- Every note modification requires an explicit confirmation modal before writing.
- `/ask` does not rename, move, create, delete, or add notes to history.

## Reserved commands

The following commands are reserved for future phases and currently show "not available":

- `/search`
- `/summarize`
- `/improve`
- `/rewrite`
- `/continue`
- `/tags`
- `/links`
- `/analyze`
- `/inbox`
- `/folder`
