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
- Contextual commands recheck the final context immediately before contacting the AI provider. If the note matches an excluded folder or path term, the selected text, preserved selection or current note matches excluded content terms, or the exclusion policy cannot be validated, nothing is sent.
- Commands must not modify notes without an explicit confirmation flow.
- Applying an `/ask` response is blocked if the active note is no longer the note that provided the context, if the saved selection no longer matches the current content, or if the current note content matches configured exclusions.
- Applying `/tags` or `/yaml` suggestions is blocked if the active note is no longer the note that provided the context, or if the current note content matches configured exclusions.

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
- The Privacy Gate runs before the request is sent: if the note matches an excluded folder or path term, or the chosen context matches an excluded content term, or the exclusion policy cannot be validated, the request is blocked and nothing is sent to the provider.
- The panel shows safe context metadata: source, note name, size, exclusion recheck state, and whether truncation applies. It does not show the selected or note content as a context preview.

Output:

- The answer is shown in the Lina side panel.
- A copy button is available.
- If the context has a valid captured selection, actions are available to insert the answer below that selection or replace that selection.
- An action is available to insert the answer at the end of the note, including when there is no valid selection.
- Every note modification requires an explicit confirmation modal before writing.
- `/ask` does not rename, move, create, delete, or add notes to history.

### `/tags`

Suggests tags for the current context.

Suggestions use the same local-first taxonomy engine as the sidebar note analysis: the vocabulary already used by semantically related notes of the active note is the primary source, and the AI is asked only to fill what that evidence does not cover. Related-note evidence is gathered for the active note, even when you selected only part of it. When no related-note evidence is available, the AI decides alone.

Context selection:

- If the active Markdown editor has selected text, Lina sends only that selected text.
- If focusing the Lina input clears the editor selection, Lina tries to use the last valid selection captured from the same active note.
- If there is no selection, Lina sends the current note content.
- The context is capped by Lina's existing AI content limit.
- The Privacy Gate runs before the request is sent: if the note matches an excluded folder or path term, or the chosen context matches an excluded content term, or the exclusion policy cannot be validated, the request is blocked and nothing is sent to the provider.
- The panel shows safe context metadata and does not show the selected or note content as a context preview.

Output:

- Only tags are requested from the provider.
- Suggested tags are shown with checkboxes.
- Tags that already exist in the note are not applied again.
- Only selected tags can be applied.
- Every note modification requires an explicit confirmation modal before writing.
- `/tags` does not generate YAML, links, tasks, folders, titles, general analysis, URLs, or chat history.

### `/yaml`

Suggests YAML/frontmatter fields for the current context.

Suggestions use the same local-first taxonomy engine as the sidebar note analysis (see `/tags`). `/tags` and `/yaml` are suggestion commands for the active note, not search modes.

Context selection:

- If the active Markdown editor has selected text, Lina sends only that selected text.
- If focusing the Lina input clears the editor selection, Lina tries to use the last valid selection captured from the same active note.
- If there is no selection, Lina sends the current note content.
- The context is capped by Lina's existing AI content limit.
- The Privacy Gate runs before the request is sent: if the note matches an excluded folder or path term, or the chosen context matches an excluded content term, or the exclusion policy cannot be validated, the request is blocked and nothing is sent to the provider.
- The panel shows safe context metadata and does not show the selected or note content as a context preview.

Output:

- Only YAML/frontmatter fields are requested from the provider.
- Suggested fields are shown with checkboxes using the same YAML preview flow as note analysis.
- Existing fields are not duplicated or overwritten by the command.
- Only selected new fields can be applied.
- Every note modification requires an explicit confirmation modal before writing.
- `/yaml` does not generate tags, links, tasks, folders, titles, general analysis, URLs, or chat history.

## Reserved commands

The following commands are reserved for future phases and currently show "not available":

- `/search`
- `/summarize`
- `/improve`
- `/rewrite`
- `/continue`
- `/links`
- `/analyze`
- `/inbox`
- `/folder`
