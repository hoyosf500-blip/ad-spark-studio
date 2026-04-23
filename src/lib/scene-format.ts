// Scene format template injected into the user message of /api/anthropic-generate.
// Reinforces the structural contract from the HTML standalone so the parser can
// find every section consistently. SYS_GENERATE stays untouched (verbatim).

export const SCENE_FORMAT = `Use EXACTLY this output format with "═══" separators. Every section header must be on its own line.

SCENE COUNT RULE — CRITICAL (read this before anything else):
- Generate ONE scene per distinct NARRATIVE BEAT of the reference ad. A 15–20s COD ad typically has 15–25 beats. A 30s ad can have 25–35. Do NOT compress them — each hook fragment, each product mention, each visual punch, each transition, each CTA micro-moment is its own scene.
- A "beat" is a new moment defined by ANY of: a script line change, a new piece of information spoken, a screen-text overlay change, an emotional shift, a camera cut, a zoom/pan, a graphic reveal, a product cut-in, or a pacing change. Visual similarity alone is NOT grounds for merging — different beats can share the same background.
- DO NOT merge consecutive beats that happen against the same shot. If two script lines are spoken over the same camera angle, STILL emit them as TWO separate scenes. Downstream post-processing assigns distinct reference frames per scene and, where the source video has no new visual at a given timestamp, automatically switches that scene to B-ROLL MODE (product close-up, target-zone macro, application shot, environment detail). You never need to collapse to avoid duplication — the system handles it.
- The B-ROLL fallback is a FEATURE, not a failure. Generate every beat; assume support shots will fill the visual gaps.

TIME RANGE RULES — CRITICAL:
- Every scene MUST have a unique, non-overlapping time range. No two scenes may share any second.
- Ranges must be strictly sequential: if Scene N ends at Xs, Scene N+1 starts at Xs or later.
- Scene duration may be as short as 0.3s — rapid-cut beats (<1s) are VALID and MUST be preserved as separate scenes. They encode pacing the editor will rebuild in CapCut.
- Do NOT merge consecutive beats to hit a minimum duration. Short is fine.

For each scene:

═══ ESCENA [N] — [NAME] ([start]s–[end]s) ═══
📝 SCRIPT: "[text in Spanish, word-for-word, natural spoken tone]"

🖼️ IMAGE PROMPT (copy to Nano Banana Pro):
[200–300 words in ENGLISH. MUST start verbatim with: "Real photograph taken with iPhone 17 Pro of" — then one dense paragraph. 3-layer structure: (1) subject — who/what, exact posture, emotion, clothing, skin, hair, hands; (2) context — location, props, light direction, color temperature, time of day; (3) camera — lens focal length, angle, framing, depth of field. Reference /image1 if the product must appear. Hyperrealistic skin texture, ZERO bokeh, sharp focus across the entire frame.]

🎬 ANIMATION PROMPT (copy to Kling 2.5 Turbo / Seedance 2.0):
[60+ words in ENGLISH. Cinematic director-level precision: subject motion, camera movement, timing beats, dialogue cues, lighting changes, emotional arc. Match the SCRIPT beats exactly — no lip-sync drift.]

🔧 TOOL: [Nano Banana Pro → Image, then Kling 2.5 Turbo / Seedance 2.0 → Video]
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
