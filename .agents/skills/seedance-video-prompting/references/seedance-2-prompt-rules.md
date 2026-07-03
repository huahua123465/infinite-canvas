# Seedance 2.0 Prompt Rules

This reference condenses the Seedance 2.0 prompt guide into project-ready rules for Infinite Canvas. Use it to author or review final prompts, especially script-node step 3.

## 1. Task Type Formula

### New video from references

Use this when extracting a subject, style, action, camera, effect, or sound from reference media to create a new video.

Templates:

- 图片参考：参考 图片N 中的 主体/风格/场景，生成...
- 视频参考：参考 视频N 中的 动作/运镜/风格/音效，生成...
- 音频参考：参考 音频N 中的音色/节奏/环境声，生成...

### Video edit

Use this when changing an existing video. Say what changes and what stays unchanged.

Templates:

- 增加元素：在 视频N 的 指定位置/指定时机 添加 元素特征。
- 修改元素：严格编辑 视频N，将其中的 原特征 修改为 新特征，其他动作和运镜保持不变。
- 删除元素：清除 视频N 中的 指定元素，同时保持 主体/场景/镜头/动作 不变。

Important: for edit and extension tasks, directly write "视频N". Do not write "参考 视频N", because that can be interpreted as a reference-video task.

### Video extension

Use this when continuing an existing clip.

Templates:

- 向后延长 视频N，生成之后的内容：...
- 向前延长 视频N，生成之前的内容：...
- 轨道补齐：视频1，过渡画面描述，接 视频2。

For track completion, Seedance supports up to 3 input videos and total input duration should stay within 15 seconds.

## 2. Advanced Formula

Write prompts as engineered video instructions:

精准主体 + 动作细节 + 场景环境 + 光影色调 + 镜头运镜 + 视觉风格 + 画质 + 约束条件

Practical order:

1. Lock who/what the subject is.
2. State what the subject does.
3. Place the action in a concrete scene.
4. Set light, atmosphere, and color.
5. Specify how the shot is filmed.
6. Add style, quality, and constraints.

## 3. Subject Binding

When a reference image or video contains multiple possible subjects, define the target subject.

Templates:

- 将 图片N 中的 2-3 个稳定静态特征 定义为 主体名。
- 将 图片1 中的 ...、图片2 中的 ... 统一定义为 主体名。
- 将 视频N 中的 A 定义为 角色A，将 视频N 中的 B 定义为 角色B。

Rules:

- Use 2-3 stable visible traits, such as clothing, hairstyle, body type, category, or prop.
- Reuse the same subject label throughout the prompt.
- With app assets, keep exact `@资产名`; do not invent aliases.
- Asset IDs are not enough for the model. The text still needs 图片N/视频N or `@资产名` references.
- Prefer reference images for complex spatial relationships instead of long spatial prose.

## 4. Storyboard Timing

For complex videos, write a temporal storyboard. Each shot should answer:

谁 + 在哪 + 做什么 + 镜头怎么动 + 有什么声音

Shot logic:

1. Camera movement or cut type.
2. Subject action and expression.
3. Position or spatial change.
4. Audio: dialogue, sound effect, ambience, or music.

Avoid forcing exact timing such as 0-3 seconds unless required. The model handles natural rhythm better than rigid timestamps.

## 5. Action Writing

Good action is physical, gradual, and continuous.

Rules:

- Name body parts: hand, arm, shoulder, head, eyes, legs, back, chest.
- Add degree: amplitude, speed, force, rhythm.
- Prefer smooth low-to-medium intensity action: slowly walking, gently raising a hand, slight head turn, naturally sitting down.
- Add transition: "借着转身惯性顺势抬手", "从停顿状态自然过渡到举手".
- Externalize emotion through body details.

Emotion conversions:

| Emotion | Use visible details |
|---|---|
| 悲伤 | 低头、肩膀微微颤抖、眼眶泛红、手指攥紧衣角、泪水打转但不落下 |
| 喜悦 | 嘴角上扬、眉眼舒展、脚步轻快、下意识哼小曲、轻轻转身 |
| 紧张/焦虑 | 频繁看表、手指敲击桌面、呼吸急促、眼神闪躲、无意识啃咬指甲 |
| 愤怒 | 双拳紧握、下颌绷紧、胸口起伏、眼神锐利、从牙缝里挤出话 |
| 释然 | 长舒一口气、肩膀放松、淡淡微笑、抬头望向远方 |

## 6. Camera Language

Seedance understands standard camera terms. Use them directly.

Common terms:

- 景别：远景、全景、中景、近景、特写、过肩镜头、空镜
- 运镜：固定镜头、缓慢推镜、平稳横移、跟拍、手持轻晃、缓慢拉远、镜头切至
- 视角：侧拍、俯拍、低机位、第一视角、无人机俯瞰

Rule: one shot should usually have one main camera movement. Do not ask for push, pull, pan, tilt, and tracking all at once.

## 7. Audio And Text Symbols

Keep information types distinct:

| Type | Symbol | Example |
|---|---|---|
| Music | （） | （背景中播放低沉弦乐） |
| Sound effect | <> | <远处传来犬吠> |
| Dialogue | {} | 女主轻声说道{我回来了} |
| Subtitle/on-screen text | 【】 | 【第一章：启程】 |

Dialogue language should stay unified unless the plot requires code-switching. For non-Chinese/non-English dialogue, name the language.

Avoid generated subtitles, logos, watermarks, or on-screen words unless requested.

## 8. Style, Quality, And Constraints

Quality phrases:

- 高清，细节丰富，电影质感，色彩自然，光影柔和
- 人物面部稳定，身体比例稳定，动作自然流畅
- 无卡顿，无闪烁，无穿模，无畸形

Style phrases:

- 现实主义纪实电影风格
- 复古胶片质感
- 日系清新自然光
- 低饱和冷调悬疑电影感
- 3D 科幻动画风格

Constraint phrases:

- 保持无字幕，避免生成任何文字或字幕
- 不要生成 Logo，不要生成水印
- 人物身份、服装、脸部特征保持稳定
- 未提及的场景和动作保持不变

## 9. Step 3 JSON Patterns

For script-node step 3, generate:

```json
{
  "storyboardPrompt": "用于首帧图/分镜图。写清主体、构图、场景、光影、风格、静态表情和关键道具。",
  "videoMotionPrompt": "用于视频模型。写清起始状态、动作过程、结束状态、镜头运动、情绪节奏、音效对白、稳定性约束。",
  "assetMentions": ["@人物名", "@场景名", "@道具名"]
}
```

Story prompt emphasis:

- still composition
- visible subject identity
- environment and light
- style and texture
- no motion-only wording as the main content

Video motion prompt emphasis:

- start/action/end
- limb-level action
- camera movement
- emotional externalization
- audio and dialogue
- stability constraints

## 10. Prompt Review Checklist

Before using a final prompt:

- Does each subject have a stable label or exact `@资产名`?
- Are all listed `assetMentions` actually used in the prompt?
- Is the action concrete enough to animate?
- Does the prompt say how the action starts, transitions, and ends?
- Is there one main camera movement per shot?
- Are style and quality constraints present but not bloated?
- Are subtitles/text/logos/watermarks forbidden unless required?
- Does the prompt avoid adding new plot facts not present in the storyboard?
