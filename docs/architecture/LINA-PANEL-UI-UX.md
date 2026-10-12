# Lina panel UI/UX

The Lina panel uses one responsive structure for desktop and mobile. Search results are compact rows: relevance is a small informational badge, the note title is primary, and the complete note path remains available in an independent DOM element for future interaction. Snippets are limited to two lines and present Markdown, links and image references in readable form. Technical state is collapsed by default.

AI analysis never changes a note before explicit selection and confirmation. All suggested changes start unselected. H1 updates and file renames are separate selections: their action and proposed value are separate elements. A folder move is offered only when it can be executed. YAML and tags retain their real status/reason data and show compact informational badges exactly once; badges are informational, never interactive. Analysis is readable text with a separate explicit action to save it under `## Análise Lina`. When that heading already exists, the preview shows the existing-status badge and explains that a new entry will be appended; it never blocks independent selected actions.

In the folder preview, the path is primary content, the badge communicates the current state, and the checkbox is only the move action. The status is never repeated beside that checkbox.

The search input submits through the same path from Enter and its integrated search button. Enter uses the Android search keyboard hint and is ignored during IME composition. A clear control appears only while text is present; it clears and restores focus without running a search. Search-mode and quick-action selectors retain their existing behavior.

The search composer is one visual container: a dominant short-placeholder input, secondary integrated controls, a subtle clear action, and `↵` as the search CTA. Search type remains persistent state and actions remain an immediate launcher; the layout wraps without changing search or analysis engines.

Composer iconography is monochromatic: the input has no coloured emoji, `×` remains secondary, and `↵` is a ghost CTA with accent only on the symbol. Search is identified by its selected value and actions by the neutral `IA...` launcher; no functionality changes.

Search type is persistent state and actions are an immediate launcher that returns to its neutral placeholder after execution. They are visually distinct secondary controls: side by side when width permits, wrapped into separate rows on narrow panels. The search input remains the visual priority; this presentation does not alter search or analysis engines.

`## Análise Lina` is the canonical append-only container. Each newly authorised analysis is written as an Obsidian `[!info]-` callout timestamped at write time in `DD/MM/AAAA · HH:mm` format. New callouts are collapsed by default and can be opened manually. Existing legacy plaintext and earlier callouts are preserved unchanged; they are not migrated or timestamped retroactively.

Visual language uses small theme-variable badges, primary content before state and auxiliary information, and no fixed colour semantics. Known presentation debt: partial Markdown table fragments can still need refinement.

The preview distinguishes section, content/action and metadata levels. Its section labels are concise; confidence and limitations are secondary metadata while the summary stays readable. The final apply button fills its container for mobile use. These UI choices do not alter search, generation, parsing or note-writing contracts.

The analysis panel presents only the final reconciled suggestions. Technical taxonomy observability (support counts, semantic neighbours, plan, local/AI origin) is not rendered, and a related-notes row appears only when related notes exist.

Sidebar status keeps search availability, artifact integrity, artifact freshness and Producer activity separate. Text-index freshness and its relative age derive from the same artifact timestamp. A stale Producer heartbeat reports missing Producer activity, never stale artifacts; it is not a primary warning on the active Producer, while a Companion can still see it after integrity, compatibility and real semantic-availability alerts.
