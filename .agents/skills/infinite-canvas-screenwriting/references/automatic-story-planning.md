# Automatic Story Planning Contract

## Dramaturgy Plan

Return one JSON object. Every structural choice must cite supplied source beat IDs.

```json
{
  "format": "biography|narrative|concept|series",
  "logline": "one concrete sentence",
  "protagonist": "name or stable subject label",
  "want": "visible external pursuit",
  "need": "conservative internal change inferred from evidence",
  "coreConflict": "goal versus obstacle",
  "openingHook": {
    "description": "visible opening action or image",
    "sourceBeatIds": ["B001"]
  },
  "incitingBeatIds": ["B002"],
  "turningBeatIds": ["B004"],
  "climaxBeatIds": ["B008"],
  "endingBeatIds": ["B010"],
  "arcSummary": "start state -> pressure and choice -> changed end state",
  "rhythmPlan": [
    {
      "phase": "setup|inciting|escalation|turn|climax|resolution",
      "sourceBeatIds": ["B001", "B002"],
      "plotRhythm": "loose|medium|tight",
      "emotionRhythm": "light|medium|heavy",
      "purpose": "what this phase changes"
    }
  ],
  "visualMotifs": ["recurring visible object, space, action, light, or sound"],
  "dialoguePrinciples": ["source-grounded dialogue rule"],
  "warnings": ["unsupported inference or production risk"]
}
```

## Format Routing

- `biography`: chronological life material, testimony, documentary narration, or real-person history. Preserve chronology and factual causality.
- `narrative`: a fictional or dramatized story with a primary event and character choice.
- `concept`: a short driven mainly by one rule, formal device, or what-if premise.
- `series`: source material explicitly structured as multiple episodes or too broad for one production episode.

## Evidence Rules

- Filter every returned ID against the supplied facts.
- Keep structural IDs in causal order.
- Use the earliest suitable facts for the opening hook unless a flash-forward is explicitly authorized.
- If Want or Need cannot be supported, use a conservative description such as "维持家庭生活" or "从被动承受到主动选择" and add a warning.
- A motif must already exist in the facts, locations, actions, or recurring material culture. Do not invent a symbolic prop.

## Production Clip Contract

Each 10-15 second clip should additionally define:

```json
{
  "dramaticFunction": "setup|inciting|escalation|turn|climax|resolution",
  "goal": "what the visible subject is trying to do now",
  "obstacle": "visible resistance, pressure, delay, or constraint",
  "result": "visible outcome at the end of the clip",
  "plotRhythm": "loose|medium|tight",
  "emotionRhythm": "light|medium|heavy",
  "valueShift": "start value -> end value"
}
```

The fields form one causal scene sentence: because the subject wants `goal`, the `obstacle` forces a concrete tactic; that action produces `result`, changes `valueShift`, and creates pressure for the following clip. A list of unrelated actions is not a valid substitute. Dialogue, when present, must perform a playable strategy instead of restating the narration.

The fields guide action, pacing, assets, and final prompts. They never authorize a new event.

For a 15-second production clip, the `visual` handoff must contain an executable four-line timeline:

```text
0-3秒：establish the single scene and blocking while executing the first physical beat
3-9秒：continue from the first physical result and execute the second beat
9-12秒：show the obstacle reaction, turning beat, and visible result
12-15秒：hold only the result, end state, and stable landing
```

Each of the first three lines names the actor or object, body part or prop, motion or operation, target, and resulting physical change. Short labels such as “木杖落地”, “人物前行”, or “动作继续” are not production-ready. Planning uses semantic asset names; exact `@资产名` references are reserved for the downstream prompt after assets exist.

## Visual Writing Rules

- Replace psychological labels with observable behavior.
- Prefer one concrete action chain over several descriptive events.
- Dialogue should be short, conversational, and grounded in supplied wording.
- Narration can carry time, context, or an unfilmable fact, while the image performs a related visible action.
- End a clip on a changed posture, object state, spatial relationship, decision, discovery, loss, arrival, or stable emotional landing.
- Give the opening, turning point, climax, and ending the clearest visual actions and strongest asset support.

## Rhythm Rules

- Plot rhythm measures event density and external pressure.
- Emotion rhythm measures the weight of the character's felt change.
- Use contrast when supported: loose plot + heavy emotion or tight plot + light emotion.
- Avoid making every clip tight and heavy; that erases the climax.
- Reserve the strongest combined intensity for a source-supported climax.

## Downstream Handoff

- Asset planning uses protagonist, period, recurring locations, motifs, and climax requirements to prioritize reusable references.
- Image prompts use the clip's dramatic function, visible goal, and starting value.
- Video prompts use goal -> pressure -> action -> result -> value shift, while preserving the one-camera-move rule.
- Audio uses dialogue principles and rhythm; it does not add explanatory speeches.
