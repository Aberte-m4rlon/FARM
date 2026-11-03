# motion SKILL

## Purpose
Provide a reusable, workspace-scoped skill that codifies the workflow used during this session: translating and localizing the in-app AI assistant to Tagalog (Filipino), validating all user-facing strings, and ensuring the rule-based assistant's responses remain correct.

This skill is focused on the specific pattern we followed in the conversation: inspect the assistant component, find English strings, systematically translate or adapt them, adjust small helpers (e.g. `bilingual()`), and validate the changes.

## Scope
- Workspace-scoped: place under `.vscode/skills/motion/SKILL.md` in the project repository.
- Intended audience: maintainers or contributors who need to localize the frontend AI assistant.

## When to use
Run this skill when you need to:
- Localize the frontend, rule-based AI assistant to Tagalog.
- Ensure no residual English UI strings remain in the assistant component.
- Produce consistent Tagalog phrasing across quick prompts, status bars, and response templates.

## Step-by-step workflow
1. Explore the codebase to find the assistant component(s).
   - Primary target: `src/components/AIAssistantPanel.tsx`.
   - Also search for other assistant-related helpers (e.g., `mlHooks`, `ml.ts`, `useFarmData`).

2. Identify all user-facing strings.
   - Use grep/search for likely English tokens ("Ask", "Health AI", "growth models", "Market-ready", "Loading your farm data", etc.).
   - List matches and categorize by UI area (header, status bar, quick prompts, response builders).

3. Decide localization approach.
   - If bilingual behavior is required, keep `bilingual(en, tl)` and return a combined or chosen string.
   - If Tagalog-only is preferred, make `bilingual()` return the Tagalog string.
   - Preserve formatting/templating and avoid breaking string interpolation.

4. Patch files.
   - Edit `AIAssistantPanel.tsx` (or other files) replacing English labels and messages with Tagalog equivalents.
   - Update helper functions (e.g., `bilingual`) only after confirming the desired UX.
   - Keep emoji and icons intact; change only human readable text.

5. Run quick static checks.
   - Grep for remaining English tokens used earlier; confirm translated coverage.
   - Rebuild or run the dev server to spot runtime/TypeScript issues.

6. Verify in-app behavior.
   - Open the UI, interact with the assistant, and test quick prompts and sample queries.
   - Confirm that response paths (unknown, summary, briefing, animal lookup, growth, milk, inventory, cluster, vaccination) show Tagalog text and that string interpolation works.

7. Iterate.
   - If phrasing or tone needs adjustment, update only the affected strings.
   - Keep changes minimal and isolated to the assistant logic unless broader localization is planned.

## Decision points and branching logic
- Where to keep bilingual output:
  - If the product must show both languages simultaneously, use the original `bilingual(en, tl)` to concatenate or format both lines.
  - If the product must be Tagalog-first, change `bilingual()` to return Tagalog only and translate callers.
- When not to translate:
  - Do not change developer-only strings (console logs, internal keys) unless they surface to users.
- Model/AI labels:
  - Replace labels like "Health AI" with context-appropriate Tagalog (e.g., "AI sa Kalusugan") but keep accuracy numbers and percent formatting intact.

## Quality criteria / completion checks
- No remaining English user-facing strings in `src/components/AIAssistantPanel.tsx`.
- The app compiles (TypeScript) without new errors caused by the edits.
- The UI shows Tagalog text for header, status bar, quick prompts, and at least one full assistant response for each major intent path.
- Grep or search report of formerly-flagged tokens returns zero matches (or only non-user-facing occurrences).

## Example prompts to run this skill
- "Localize the AI assistant UI to Tagalog and ensure no English strings remain." 
- "Make assistant bilingual but show Tagalog first; keep English as secondary." 
- "Run a grep for remaining English strings in AIAssistantPanel and report findings."

## Ambiguities & Questions to ask the user
- Should `bilingual()` show both English and Tagalog, or should it return Tagalog only?
- Should we translate developer-facing labels that appear in logs or telemetry?
- Do you want a style guide / glossary for consistent Tagalog terms (e.g., AI sa Kalusugan vs. Health AI)?

## Suggested follow-ups / related customizations
- Create a `glossary.md` listing consistent translations for domain terms (`vaccination` → `bakuna`, `weight` → `timbang`, etc.).
- Add a simple unit test or lint rule that flags English words in `src/components/AIAssistantPanel.tsx`.
- Extract string resources into a `locales/` directory for easier future localization.

## Outputs
- A short checklist (the workflow above) and the produced `SKILL.md` file saved at `.vscode/skills/motion/SKILL.md`.
- Use the todo list to track draft → save → verify steps.

---

Created by following the `agent-customization` guidance: keep instructions executable, include decision points, and provide example prompts. Use this SKILL.md as a reusable starting point to repeat the Tagalog-localization workflow across similar projects.
