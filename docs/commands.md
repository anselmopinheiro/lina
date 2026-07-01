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
- Commands must not modify notes unless a future phase adds an explicit confirmation flow.

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

Output:

- The answer is shown in the Lina side panel.
- A copy button is available.
- No note is edited, inserted into, replaced, renamed, moved, or added to history.

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
