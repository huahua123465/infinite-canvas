---
name: infinite-canvas-screenwriting
description: Use this skill whenever Infinite Canvas turns a story, biography, concept, short script, or series into traceable story beats, a dramaturgy plan, 10-15 second production clips, asset plans, or downstream image/video prompts. It improves hooks, dramatic action, visual storytelling, rhythm, and continuity without inventing facts or changing the existing three-step review workflow.
---

# Infinite Canvas Screenwriting

## Mission

Turn source material into a reusable production contract that improves the entire chain:

source facts -> dramaturgy plan -> production clips -> assets -> image/video prompts.

The skill is an internal quality layer. It does not replace the Script node's three review steps and does not ask the user to approve an external eight-step writing workflow.

## Success Definition

A strong result:

- preserves every factual claim through exact source beat IDs
- gives the story one clear protagonist, desire, obstacle, change, climax, and ending
- opens with a visible hook supported by early source facts
- turns abstract emotion into actions, posture, gaze, objects, space, and sound
- assigns every production clip a dramatic function and a visible result
- creates contrast between plot rhythm and emotional rhythm
- gives assets and final prompts the same story-level priorities
- remains reusable across biographies, realistic narratives, concept shorts, and series

## Automatic Workflow

1. Extract atomic source facts without dramatizing them.
2. For a single episode, condense the complete `B` facts into the episode's `C` core facts, then build the dramaturgy plan only from those `C` IDs.
3. For a complete series, keep all `B` facts and build the dramaturgy plan from those `B` IDs.
4. Plan 10-15 second clips using the dramaturgy plan and the same fact set together.
5. Carry the relevant dramatic function, rhythm, motif, and character goal into asset and prompt generation.
6. Run the quality gate before saving structured output.

Read `references/automatic-story-planning.md` when generating the dramaturgy JSON or production clips.

## Decision Rules

- Biography or documentary: improve selection, juxtaposition, visual hooks, and causal emphasis; never manufacture conflict or dialogue.
- Narrative short: preserve one core dramatic action and a clear setup, escalation, turn, climax, and resolution.
- Concept short: identify the single rule or form, then keep its visual presentation and escalation coherent.
- Series: preserve episode continuity and vary rhythm, but do not invent season arcs, clues, or subplots absent from the source.
- Inference such as Want or Need is interpretation, not fact. It may guide emphasis but must never enter `sourceText` or become a new event.
- A result-first opening is allowed only when the source and production plan explicitly permit a flash-forward. Otherwise build the hook from the earliest available facts.
- Use one dominant audiovisual method per production clip. Complex montage or split-screen logic belongs at sequence level unless the clip explicitly requires it.

## Boundaries

- Do not alter or reorder source facts without explicit evidence IDs and transition semantics.
- Do not add characters, relationships, locations, props, dialogue, diagnoses, or outcomes absent from the source.
- Do not turn every fact into conflict. Setup, breathing space, and transitions have valid dramatic functions.
- Do not copy the external skill's interactive approval language into runtime prompts.
- Do not output standard screenplay prose when the caller requires JSON.
- Do not let style or a hook override age, location, time, physical state, or continuity facts.

## Quality Gate

Before returning, check:

- Is every cited beat ID present in the supplied facts?
- Does the logline describe the actual story rather than a generic theme?
- Are Want, Need, and core conflict supported or clearly conservative interpretations?
- Does the opening hook use visible evidence instead of explanation?
- Do turning point, climax, and ending IDs appear in causal order?
- Does each clip have a goal, obstacle or pressure, visible result, and changed end state?
- Are three consecutive clips avoiding the same plot and emotional intensity when the facts allow contrast?
- Are dialogue and narration grounded in source wording rather than invented exposition?
- Can downstream image and video models see the actions being requested?

## Attribution

This project-specific workflow transfers methodological patterns from the MIT-licensed "山音超级编剧大师" by @山音. See `THIRD_PARTY_NOTICE.md`. It does not redistribute the original packaged skill as a product feature.
