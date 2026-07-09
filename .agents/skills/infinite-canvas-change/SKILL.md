---
name: infinite-canvas-change
description: Safe workflow for modifying the Infinite Canvas project. Use when changing canvas features, node behavior, generation flows, storyboard workflows, video/audio task handling, provider routing, local agent integration, or related docs in D:/work/codexplugins/infinite-canvas.
---

# Infinite Canvas Change

## Overview

Use this skill as a guardrail before modifying the canvas. The goal is to keep changes small, easy to review, and friendly to future upstream merges.

## Workflow

1. Read the root `AGENTS.md` first. Its project rules override this skill.
2. Classify the request into one or two workstreams from the list below.
3. Read only the required entry files for those workstreams before editing.
4. Make the smallest behavior-preserving change that satisfies the request.
5. Prefer adding a focused helper or page-private hook over reshaping large existing files.
6. Before finishing, check whether `docs/content/docs/progress/todo.mdx` or `docs/content/docs/progress/pending-test.mdx` needs an update. If not, say no docs update was needed.

## Workstreams

- **canvas-interaction**: pan, zoom, drag, select, shortcuts, context menu, paste, upload drop.
  Read `web/src/pages/canvas/project.tsx`, `web/src/components/canvas/infinite-canvas.tsx`, `web/src/components/canvas/canvas-context-menu.tsx`, and `web/src/stores/canvas/use-canvas-ui-store.ts`.

- **node-rendering**: node body, hover toolbar, prompt panel, dialogs, resize, visual states.
  Read `web/src/components/canvas/canvas-node.tsx`, related `canvas-node-*` components, `web/src/types/canvas.ts`, and `web/src/constant/canvas.ts`.

- **generation-pipeline**: image, text, audio, video generation, retry, cancel, references, task progress.
  Read `web/src/pages/canvas/project.tsx`, `web/src/components/canvas/canvas-node-generation.ts`, `web/src/services/api/`, `web/src/types/canvas.ts`, and relevant storage services.

- **storyboard-workflow**: Script node, storyboard rows, assets, Seedance prompts, scene locks, role voices, tail-frame continuity.
  Read `web/src/pages/canvas/project.tsx`, `web/src/components/canvas/canvas-script-node-dialog.tsx`, `web/src/types/canvas.ts`, and the relevant files in `web/src/lib/canvas/`.

- **provider-routing**: OpenAI, Gemini, Ark, Cangyuan, Seedance, Volcengine/OpenSpeech routing and model settings.
  Read `web/src/stores/use-config-store.ts`, `web/src/services/api/`, model picker code, and any matching pending-test entries.

- **local-agent**: local Canvas Agent, skill context loading, tool queues, agent operations.
  Read `canvas-agent/`, `web/src/components/canvas/canvas-local-agent-panel.tsx`, `web/src/stores/canvas/use-canvas-agent-store.ts`, and `web/src/lib/canvas/canvas-agent-ops.ts`.

- **docs-progress**: progress notes, todo, pending-test, feature docs, changelog wording.
  Read root `AGENTS.md`, `docs/content/docs/progress/todo.mdx`, `docs/content/docs/progress/pending-test.mdx`, and the directly relevant docs page.

## Boundaries

- Do not do broad refactors, whole-file formatting, route reshuffles, or large component moves unless the user explicitly asks.
- Avoid splitting `web/src/pages/canvas/project.tsx` just for cleanliness. Extract only stable pure helpers or narrow hooks needed by the current change.
- Do not change `CanvasNodeMetadata` casually. New metadata fields must have one clear owner workflow and a visible read/write path.
- Do not add compatibility layers for old local data unless the user asks; this project is not online yet.
- Do not replace existing Ant Design, Tailwind, Zustand, or storage patterns with a new framework.
- Keep canvas UI aligned with `canvasThemes`, `useThemeStore`, Ant Design tokens, and existing canvas panel/modal styles.
- Preserve Chinese UI copy.

## Change Shape

Prefer this order:

1. Reuse existing helper, store action, component, or API wrapper.
2. Add a small helper in `web/src/lib/canvas/` when logic is pure and reusable.
3. Add a page-private hook beside the page only when stateful logic becomes hard to read.
4. Edit large components in place only for the smallest required wiring.

## Done Check

Before final response, report:

- workstream used;
- files changed;
- whether runtime code changed;
- whether `todo.mdx` or `pending-test.mdx` needed updates.
