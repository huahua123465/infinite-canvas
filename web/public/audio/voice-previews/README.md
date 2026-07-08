# Voice preview cache

Put curated TTS preview audio files in this directory and register them in `manifest.json`.

The app checks this shared manifest before calling the TTS API. Local one-off previews are still cached in IndexedDB and should not be committed unless the sample is worth sharing with the team.

Manifest item shape:

```json
{
  "key": "audio-preview:<sha256>",
  "url": "zh_female_cancan_uranus_bigtts.mp3",
  "mimeType": "audio/mpeg",
  "durationMs": 4200
}
```
