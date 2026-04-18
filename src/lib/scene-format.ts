// Scene format template injected into the user message of /api/anthropic-generate.
// Reinforces the structural contract from the HTML standalone so the parser can
// find every section consistently. SYS_GENERATE stays untouched (verbatim).

export const SCENE_FORMAT = `Use EXACTLY this output format with "═══" separators. Every section header must be on its own line.

For each scene:

═══ ESCENA [N] — [NAME] ([start]s–[end]s) ═══
📝 SCRIPT: "[text in Spanish, word-for-word, natural spoken tone]"

🖼️ IMAGE PROMPT (copy to Nano Banana Pro):
[200–300 words in ENGLISH. One dense paragraph. 3-layer structure: (1) subject — who/what, exact posture, emotion, clothing, skin, hair, hands; (2) context — location, props, light direction, color temperature, time of day; (3) camera — lens focal length, angle, framing, depth of field. Reference /image1 if the product must appear. iPhone 15 Pro photograph look, hyperrealistic skin texture, ZERO bokeh, sharp focus across the entire frame, 9:16 vertical.]

🎬 ANIMATION PROMPT (copy to Veo 3.1 / Kling 3.0 / Seedance 2.0):
[60+ words in ENGLISH. Cinematic director-level precision: subject motion, camera movement, timing beats, dialogue cues, lighting changes, emotional arc. Match the SCRIPT beats exactly — no lip-sync drift.]

🔧 TOOL: [Nano Banana Pro → Image, then Veo 3.1 / Kling 3.0 / Seedance 2.0 → Video]
📎 ATTACH: [which image references to attach — e.g. /image1 product photo, previous scene still]
→ SCREEN TEXT: [overlay text in Spanish, ALL CAPS, max 4 words]

Repeat the ESCENA block for every scene in the ad.

After the last scene, append these sections (each separated by its own "═══" header):

═══ AVATAR — OPCIÓN 1 ═══
[Description of the main avatar: age range, body type, skin tone, hair, wardrobe, energy. Reusable across scenes so the same person appears in every image prompt.]

═══ HOOKS EXTRA ═══
1. [alternative opening line 1]
2. [alternative opening line 2]
3. [alternative opening line 3]

═══ EFFECTS DENSITY MAP ═══
Scene 1: [low/medium/high] — [what effects and where]
Scene 2: ...
(one line per scene)

═══ ENERGY ARC ═══
[How energy builds across the piece, where the emotional peak lands, where the CTA resolves.]

═══ TIMELINE CAPCUT ═══
00:00 — Scene 1 start
00:0X — cut to Scene 2
...
00:XX — end

═══ RECOMMENDATION ═══
[One short paragraph: which hook to test first, what to watch in the metrics, any warning about the script or risk.]

Do not add preamble, do not summarize, do not translate the SCRIPT — output the format directly.`;
