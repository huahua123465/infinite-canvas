---
name: seedance-video-prompting
description: Use this skill whenever writing, rewriting, reviewing, or generating final video prompts for Doubao Seedance 2.0 / Ark video models, especially Infinite Canvas script-node step 3 "合成提示词", "最终提示词", "视频运动提示词", storyboard-to-video prompts, reference image/video/audio prompts, video edit prompts, video extension prompts, or batch video-generation prompts. This skill turns storyboards, assets, dialogue, camera language, and reference media into precise Chinese video-model instructions that Seedance can follow.
---

# Seedance Video Prompting

This skill helps produce prompts that Seedance 2.0 can understand as a video director, not as generic copywriting. Use it when the task is to create or improve prompts for video generation, video editing, reference-media generation, video extension, or Infinite Canvas script-node step 3.

For detailed rules, templates, and review checks, read `references/seedance-2-prompt-rules.md` when the prompt requires more than a tiny one-line edit.

## Mission

Write compact, executable Chinese video prompts that clearly tell the model:

- who or what the subject is
- which reference asset binds to that subject
- where the action happens
- what changes over time
- how the camera moves
- what audio, dialogue, or ambience should happen
- what style and quality constraints must hold

Good prompts separate spatial information from temporal motion. They do not merely say "cinematic" or "emotional"; they show the model the subject, action chain, camera, light, sound, and constraints.

## Output Modes

When the caller needs Infinite Canvas step 3 output, return the exact requested JSON shape. Preserve existing field names such as `storyboardPrompt`, `videoMotionPrompt`, and `assetMentions`.

When the caller asks for a single final prompt, output only the prompt body unless they ask for explanation.

When reviewing a prompt, lead with the concrete fixes: missing subject binding, weak action, unclear camera, conflicting references, overlong wording, or missing constraints.

## Core Workflow

1. Identify the task type:
   - New video from references: use "参考 图片N/视频N/音频N 的某个维度，生成..."
   - Video edit: use "严格编辑 视频N..." and say what changes; do not call it "参考视频N".
   - Video extension: use "向前/向后延长 视频N..." or describe the bridge between videos.
   - Storyboard step 3: produce both a still/image prompt and a video-motion prompt.

2. Bind subjects and assets:
   - Use the exact asset names supplied by the app, including `@资产名`.
   - If the prompt refers to uploaded media, use stable labels like 图片1, 视频1, 音频1.
   - For multiple subjects, assign and reuse stable labels. Avoid "他/她/它" when a named asset or subject label is available.

3. Build the prompt with the Seedance formula:
   精准主体 + 动作细节 + 场景环境 + 光影色调 + 镜头运镜 + 视觉风格 + 画质 + 约束条件.

4. Convert plot into motion:
   - Start state: subject posture, position, emotional state.
   - Action process: limb-level movements, transitions, speed, force, and continuity.
   - End state: where the subject or camera lands.
   - Camera: one primary camera movement per shot.
   - Audio: dialogue in braces, sound effects in angle brackets, music in parentheses when useful.

5. Tighten constraints:
   - Keep faces, body proportions, clothing, identity, and style stable.
   - Avoid subtitles, text, logos, and watermarks unless the user explicitly wants them.
   - Prefer smooth, continuous, low-to-medium intensity movements unless the shot explicitly needs large action.

## Step 3 Defaults

For Infinite Canvas script-node step 3:

- `storyboardPrompt` is for first-frame/storyboard image generation. It should emphasize composition, subject appearance, environment, light, style, and a still moment.
- `videoMotionPrompt` is for video generation. It should emphasize start/action/end, camera movement, motion continuity, emotion externalized through body details, audio, and constraints.
- `assetMentions` must contain only exact `@资产名` values that appear in the supplied asset list.
- If a character has an official actor/base face, describe it as the face identity anchor. Do not output asset IDs.

## Quality Bar

A strong Seedance prompt:

- is specific enough to be filmed
- has no ambiguous subject references
- contains action transitions, not just static adjectives
- uses one clear camera movement per shot
- keeps dialogue, sound effects, and music symbolically distinct
- includes only relevant assets and references
- avoids contradictory styles, duplicate camera directions, and excessive reference overload

## Anti-Patterns

Avoid:

- vague prompts like "很有电影感、很紧张、画面高级"
- multiple camera moves crammed into one shot, such as "推拉摇移同时进行"
- exact second-by-second timing unless the user explicitly needs it
- unbound pronouns when multiple subjects exist
- overusing all available assets when only one or two matter
- writing a new plot that conflicts with the storyboard
- mixing dialogue languages unless the story requires it
- requesting generated text/subtitles when the goal is clean video

## Review Loop

Before finalizing, silently check:

- Are all referenced `@资产名` present in `assetMentions`?
- Does the video prompt describe motion rather than only a beautiful frame?
- Does the prompt include subject, scene, action, camera, style, and constraints?
- Is there only one main camera movement per shot?
- Are dialogue, sound effects, music, subtitles, and on-screen text intentionally marked?
- Is the prompt concise enough that the model can prioritize the important parts?
