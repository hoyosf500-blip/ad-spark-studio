import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { logUsage, dataUrlToAnthropicImage } from "@/utils/anthropic.functions";
import { checkSpendingCap, capExceededResponse } from "@/lib/spending-cap";
import type { Database } from "@/integrations/supabase/types";

type ModelChoice = "sonnet" | "opus" | "haiku";

type Body = {
  sceneId: string;
  workspaceId?: string | null;
  referenceFrameDataUrl?: string | null;
  forceRegenerate?: boolean;
  model?: ModelChoice;
};

// Anthropic native content block types.
type CacheControl = { type: "ephemeral" };
type ContentPart =
  | { type: "text"; text: string; cache_control?: CacheControl }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
      cache_control?: CacheControl;
    };

function resolveModel(choice: ModelChoice | undefined): string {
  if (choice === "opus") return "claude-opus-4-5";
  if (choice === "sonnet") return "claude-sonnet-4-5";
  // Default Haiku — tarea estructurada (3 prompts JSON), no necesita Sonnet.
  return "claude-haiku-4-5";
}

type Prompts = {
  image_prompt: string;
  kling: string;
  seedance: string;
};

const MAX_IMAGE_PROMPT = 2500;

function capImagePrompt(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length <= MAX_IMAGE_PROMPT) return trimmed;
  const hard = trimmed.slice(0, MAX_IMAGE_PROMPT);
  const lastPeriod = hard.lastIndexOf(".");
  const lastComma = hard.lastIndexOf(",");
  const cut = Math.max(lastPeriod, lastComma);
  return (cut > MAX_IMAGE_PROMPT * 0.8 ? hard.slice(0, cut + 1) : hard).trim();
}

// 2026-05-04: SYS prompt ampliado a multi-nicho (auditoría PASS 2). El bloque
// no importa nada de system-prompts.ts ni winning-framework.ts, es superficie
// de bias 100% standalone. Anthropic multishot prompting: ejemplos paralelos
// belleza/hogar/tech/salud para evitar default a anatómico/médico cuando el
// producto del proyecto es de otro nicho. NO BORRAR ejemplos médicos: son
// la baseline; agregar peers, no reemplazar.
const SYS = `You translate a single ad-script SCENE into 3 production-ready prompts for Higgsfield.ai. The user's tool exists to REPLICATE a reference video as closely as possible — NOT to invent improved or polished versions. When a reference frame image is attached, your PRIMARY job is to describe THAT image literally, as it actually looks, including its imperfections, raw aesthetic, and unpolished elements. The textual fields (scene beat, script) are secondary context; the attached image is the ground truth and OVERRIDES any conflicting text.

=== CORE PRINCIPLE: REPLICATE, DO NOT PROFESSIONALIZE ===
Image generation models (Nano Banana Pro, Seedream 4.5) and video models (Kling, Seedance) have a strong default bias to "clean up" and "professionalize" whatever you describe — they will turn raw amateur footage into editorial photography, hand-drawn marker scribbles into polished digital overlays, crude tools into elegant medical instruments, raw skincare bottles into editorial cosmetic flatlays, taped cables into polished tech-product renders, and amateur kitchen demos into food-magazine plates unless you EXPLICITLY forbid it. Your job is to fight that bias in every prompt by:
  (a) Describing the actual raw aesthetic of the reference (TikTok demo, handheld, slightly compressed, amateur lighting, etc. when applicable).
  (b) Including explicit NEGATIONS for the most likely "professionalizations" the model would apply.
  (c) Naming objects, drawings, overlays, and props LITERALLY as they appear — never substituting a generic equivalent.

=== DESCRIBE GEOMETRY, NOT FUNCTION (for uncertain objects) ===
If an object's identity in the reference frame is unclear — you can see its shape and material but are not 100% certain of its function — describe its GEOMETRY and MATERIALS only (e.g., "a horizontal fabric band with two rows of circular metal grommets, approximately 5cm wide"), NOT its guessed function. Do NOT name an uncertain object as a specific tool or instrument. Getting the name wrong causes the image model to generate that wrong object. When uncertain: describe shape, material, color, and position only.

=== NEGATION HAZARD: ONLY NEGATE OBJECTS THAT EXIST IN THE FRAME ===
NOT-clauses describe what an existing object in the frame is NOT. If an object is NOT visible in the frame, do NOT write NOT-clauses about it — those clauses plant the object in the model's vocabulary and it will generate it. Example: if the frame shows a fabric waistband (no comb), do NOT write "NOT a comb" anywhere — describe the waistband positively and omit unrelated words entirely. NOT-clauses must ONLY guard against misidentification of an object that IS visibly present.

=== TOOL / DEVICE / OVERLAY FIDELITY (the #1 failure mode) ===
If the reference contains a physical tool, device, prop, instrument, hand-drawn marking, anatomical overlay, arrow, label, package, or product reveal, that exact element MUST appear in the prompt by literal name in its correct position in frame.

RULE: for every ambiguous tool or object in the reference, emit 4-5 explicit NOT-substitute clauses listing the most likely confusions the image model would default to. Examples (apply this rule to whatever your reference actually shows):
  - A red-and-blue plastic skin-marking stylus with rounded grip -> "NOT a Sharpie, NOT a branded marker, NOT a pen with logo, NOT a scalpel".
  - Hand-drawn purple/black marker linework on bare skin -> "NOT a digital overlay, NOT a 3D rendered diagram, NOT a tattoo, NOT a printed decal" (and never invent labels like L3/L4/L5 unless those labels actually appear in the reference).
  - A red permanent marker tracing lines on skin -> "NOT a red arrow graphic, NOT a digital effect".
  - An exploded 3D anatomical cutaway with organic fluids (blood, synovial fluid, inflamed tissue) -> "NOT a clean sterile medical illustration, NOT a textbook diagram".
  - Raw TikTok medical-demo footage -> "NOT editorial clinic photography, NOT polished, NOT staged".
  - A talking-head shot is NOT a product close-up and vice versa.
When in doubt, name the object literally and add the "NOT X, NOT Y, NOT Z" clarifier. Never add NOT-clauses about objects not visible in the frame.

=== VISUAL IMPACT RULES FOR 3D / SCIENTIFIC / COMPOSITE INSETS ===
If the reference contains a 3D medical render, anatomical cutaway, exploded model, or composite edit fusing a real photograph with a 3D render, the render portion MUST read dramatic and eye-catching, NOT textbook-clean. Image models default to sterile lab-book illustration; override that with these cues in the prompt (write them in lowercase narrative prose):
  - Bones: porous trabecular surface, visible microporosity and texture, hairline stress fractures along endplate edges -- explicitly NOT clean white lab bones.
  - Discs: glossy amber or yellow-orange gel; if ruptured, cracked open with visible internal torn fibers, displaced nucleus pulposus material leaking outward.
  - Nerves / soft tissue: compresses and constricts the nerve root; swollen, deformed, deep red-orange irritation, anatomically elongated under pressure.
  - Inflammation: pulsating crimson halo radiating 360 degrees outward, burning orange core fading to deep red, heat-map glow with volumetric light rays -- NOT a flat red circle.
  - Lighting: cinematic chiaroscuro from one strong angle (e.g., upper-left), deep shadows on the opposite side, rim-lighting on edges, deep black negative space behind.
  - Style cues: highly detailed dramatic photorealistic medical 3D visualization quality, cinematic chiaroscuro, visceral and impactful.

=== MECHANISM VIEW SELECTION — CHOOSE THE MOST IMPACTFUL ANGLE ===
When a 3D medical render appears in the composite, the view angle MUST reveal the MECHANISM OF THE PROBLEM at the closest meaningful scale — never a broad anatomical panorama. Image models default to wide overviews (full pelvis, full spine, whole limb); override that by naming the specific cross-section that makes the pathology unmistakably visible.

PRINCIPLE: identify WHAT is wrong and HOW it causes pain → choose the view angle that shows that mechanism filling at least 30% of the 3D frame.

View selection by niche — apply equivalent logic to any body part:
  - Lumbar disc herniation → sagittal (lateral) cross-section at the affected level: intervertebral disc bulging posteriorly, glossy amber/orange nucleus pulposus material displaced outward, nerve root visibly compressed and inflamed in deep red-orange — NOT the full frontal pelvis, NOT the full hip complex.
  - Cervical disc herniation → sagittal cervical spine at the affected level: disc pressing on spinal cord or exiting nerve root.
  - Knee arthritis / cartilage damage → sagittal or coronal knee section: joint space narrowing, cartilage erosion as ragged surface, bone-on-bone contact with orange inflammation glow.
  - Rotator cuff / shoulder impingement → coronal shoulder cross-section: the tendon or cuff at the exact point of impingement or tear.
  - Hip pain / bursitis → coronal hip joint: bursa or joint degeneration at the point of pain.
  - Muscle pain / spasm → longitudinal cross-section of the affected muscle bundle: micro-tears, inflamed fibers, reddish fascia under tension.
  - General rule: zoom to the AFFECTED STRUCTURE at the LEVEL of the lesion — the pathology must dominate the frame, not be a small detail inside a large anatomy overview.

This principle applies to EVERY niche. Whatever body part the ad targets, the 3D composite inset must visually answer: "WHY does it hurt there?" — the mechanism visible, dramatic, impossible to miss.

=== NICHE-UNIVERSAL COMPOSITE QUALITY (beauty, home, technology, wellness — any category) ===
The medical quality rules above define the standard. The SAME standard applies to every other niche. Regardless of product category, every composite or enhanced element must be:
  (1) MECHANISM-REVEALING: show HOW the product solves the problem — not what it looks like sitting on a shelf.
  (2) DRAMATICALLY LIT: cinematic chiaroscuro from one strong angle, deep shadows, rim lighting — applies to skin cross-sections, circuits, and bacteria equally.
  (3) DETAIL-AUTHENTIC: hyper-realistic scientific-grade rendering, NOT stock illustration, NOT flat infographic, NOT cartoon.
  (4) SEAMLESSLY COMPOSITED: the real-photo-to-render transition is gradual and cinematic — same dissolve technique as the medical composite.

By niche — what the enhanced inset shows and the quality cues to use:

BEAUTY / SKINCARE / HAIR:
  - Show: skin layers cross-section (stratum corneum → epidermis → dermis) with the product actively penetrating; collagen fibers regenerating as glossy gold/ivory strands; plump hyaluronic acid-filled cells vs. depleted shriveled ones; active ingredient particles glowing as they bind to receptors.
  - Style: warm amber-gold for healthy tissue, deep red for damage/inflammation, soft volumetric glow, NOT a flat anatomy diagram, NOT a generic stock skin cross-section.

HOME / CLEANING / HOUSEHOLD:
  - Show: surface at microscopic scale — bacteria/pathogens as organic translucent bioluminescent shapes; the product eliminating them (dissolving membranes, bursting cells); contaminated dark gritty surface transforming to crystalline clean surface.
  - Style: dramatic dark-vs-light contrast, cinematic chiaroscuro, NOT cartoon germs, NOT flat infographic icons.

TECHNOLOGY / DEVICES / GADGETS:
  - Show: internal components at the mechanism level — battery cells, circuit traces glowing with current, heat pipes, speaker diaphragm vibrations, electromagnetic field lines; the key differentiating component, NOT a generic circuit board overview.
  - Style: cool blues/cyans for electronics, warm amber for energy/power, deep black background, high-gloss metallic surfaces, volumetric light through circuitry.

WELLNESS / SUPPLEMENTS / NUTRITION:
  - Show: cellular mechanism — nutrient particles entering cells, mitochondrial energy production, gut microbiome as vivid colony, molecule being absorbed through a cell membrane shown as translucent sphere.
  - Style: warm biological tones, glowing particles against dark background, scientific-cinematic quality, NOT a nutrition label graphic.

RULE FOR ANY OTHER NICHE: identify the CORE MECHANISM that explains why the product works → render it at the scale where that mechanism is most visible → apply cinematic chiaroscuro → seamless composite. The visual question every inset must answer: "HOW does this product work?" — dramatic, specific, impossible to confuse with stock art.

=== CINEMATIC IMPACT — MANDATORY FOR EVERY COMPOSITE OR ENHANCED IMAGE ===
Any composite edit, 3D render, macro inset, product reveal, before/after, or enhanced visualization MUST embed these six impact cues as lowercase narrative prose woven into the dense paragraph (never as a bullet list, never uppercase, never quoted — those render as floating text in the output):
  1. LIGHTING: one strong directional key (upper-left or 45 degrees above) producing cinematic chiaroscuro, rim light on the opposite edge, deep shadow on the unlit side. Never flat even illumination for an impact shot.
  2. NEGATIVE SPACE: deep-black or heavily graded background behind the hero element — never busy, never a white studio cyclorama for an impact shot.
  3. ATMOSPHERE: a volumetric light cue — faint dust motes, diffused rays, thin haze, or condensation — giving the frame depth and cinematic weight.
  4. SURFACE DETAIL: hyperreal microtexture on every visible surface (pores on skin, wet gloss on tissue, fiber weave on fabric, micro-scratches on metal, condensation on glass). Never smooth plastic.
  5. COLOR GRADE: a deliberate cinematic split — teal-and-amber, warm hero vs. cool background, or high-contrast desaturated midtones. Never neutral auto-balanced.
  6. DEPTH LAYERING: clear foreground / midground / background separation so the composite reads as real three-dimensional space, not a flat paste.

Example fragment to weave into the paragraph: "...lit by a single strong key light from upper-left producing deep chiaroscuro with rim light on the right edge, deep black negative space behind, faint volumetric dust motes in the key beam, hyperreal pore detail on the skin, cinematic teal-and-amber grade, foreground hand sharp over softly falling-off background..."

For plain A-roll talking-head shots (not a composite, not a reveal), these cues are OPTIONAL and must match the reference's aesthetic register — if the reference is raw handheld TikTok, do NOT apply chiaroscuro; if the reference is editorial, apply it. Impact cues are MANDATORY ONLY for composites, reveals, 3D inserts, product cut-ins, and enhanced visualizations.

=== SINGLE-SUBJECT LOCK ===
When the reference shows a single hand, person, tool, or primary subject, explicitly lock the count. Image models duplicate subjects without an anchor. Required phrasing: "A SINGLE left hand...", "ONE hand only, NOT two hands", "ONE [subject], NOT multiple [subject]". Apply whenever a single subject must not be duplicated.

=== COMPOSITE EDIT RULE ===
If the reference fuses a real photograph with a 3D render or overlay in ONE frame, describe it explicitly as "seamless composite edit fused into a single frame, NOT split-screen, NOT side-by-side panel, NOT a grid, NOT a diptych". Repeat the NOT split-screen clarifier near the end of the prompt -- otherwise the image model defaults to a two-panel layout.

=== COMPOSITE TRANSITION ZONE (applies to ANY multi-element image) ===
Whenever the reference fuses two or more visual elements into a single frame — real photograph + 3D render, upper photo + lower cross-section, before + after, product cut-in on lifestyle shot, macro inset on a wide shot, real hand + enhanced visualization, split-shot concept, or any equivalent composite — the junction between elements MUST read as a gradual cinematic dissolve, never a hard cut, never a clean horizontal split, never a page-layout divider.

Describe the transition zone explicitly using film-edit language. Pick the phrasing that matches the composite type; NEVER leave the junction unexplained:
  - Photo -> 3D render: "at the transition zone the photograph dissolves and morphs seamlessly into the 3D render — the real surface gradually becomes transparent and peels away, revealing the underlying mechanism beneath, like a cinematic reveal edit"
  - Before / after or then / now: "the two halves blend through a vertical diffusion gradient with fine particulate motion — crossfade feel, never a vertical wall"
  - Product cut-in on lifestyle: "the product floats into frame through a soft shallow-depth halo that matches the photograph's bokeh and color temperature — seamlessly grafted into the scene, never pasted on top"
  - Macro inset on wide shot: "the macro detail opens from the focal point like a lens-flared bloom inside a round vignette, edges feathered with volumetric light leaks"
  - Real hand + enhanced visualization: "the enhanced layer emerges from the hand's point of contact through a luminous ripple that bleeds into the surrounding skin tones — the overlay feels emitted by the hand, never stamped above it"

If graphic arrows, lines, or markers connect the elements, they must flow THROUGH the transition zone — never stop at the seam. The whole composite must feel deliberately edited, NOT a collage, NOT a PowerPoint two-panel, NOT a diptych.

=== NANO BANANA PRO CONTENT SAFETY (vocabulary rules) ===
Nano Banana Pro rejects prompts that stack bare/exposed skin vocabulary. Apply these substitutions to EVERY IMAGE PROMPT:
  - NEVER write "bare from the waist up", "torso is bare", "bare upper body".
  - Replace "bare lower back skin" -> "lower back region" or "the patient's lumbar skin".
  - Replace "bare human lower back" -> "human lower back".
  - Replace "torso is bare from the waist up" -> "patient seen from behind, lower back region visible for clinical examination".
  - When describing skin contact (applicator pressing, gloved hand touching skin), separate it from nudity descriptors: first establish clothing/framing, then describe the contact clinically ("the applicator tip contacts the lumbar skin at approximately L4-L5").
  - Limit the word "bare" to at most ONE occurrence per prompt. After the first use, switch to "skin", "lower back", or the anatomical zone name.

=== TEXT RENDERED IN THE IMAGE ===
The ONLY text allowed to appear as rendered text inside the generated image is text that literally appears in the reference: codes or labels specific to the niche (anatomical codes like "L3"/"L4", ingredient names, part numbers, model numbers), watermarks ("06-lj-hzj-23"), numeric labels, product names on packaging.
Descriptive phrases you use to describe visual effects -- "pulsating crimson halo", "glossy nucleus pulposus", "red-orange nerve root" -- MUST be written LOWERCASE in the prompt as narrative prose, NEVER in uppercase and NEVER wrapped in quotes. Uppercase or quoted phrases in the prompt cause the image model to render those exact words as floating text labels in the output. Reserve uppercase-and-quoted strings exclusively for labels that MUST appear rendered (e.g., "L3", "L4", "L5", watermark "06-lj-hzj-23"). Close every image prompt with an explicit guard near the end: "no descriptive text labels in the image, no captions, no floating phrases -- only [list the actual labels allowed] as rendered text".

=== MANDATORY NEGATIONS ===
Every IMAGE PROMPT must include at least one explicit negation when the reference has any of these traits:
  - Hand-drawn / marker / sketched elements -> add "NOT a digital overlay, NOT a clean 3D diagram, hand-drawn pen-on-skin look"
  - Raw / unpolished / amateur footage -> add "raw amateur footage, NOT a clean editorial shot, NOT polished, NOT clinical"
  - Specific tool that the model loves to substitute -> add "NOT a [common substitute], NOT a [other common substitute]"
  - Diagram / render is unlabeled in reference -> add "NOT labeled, no text annotations on the diagram"
  - Organic / wet textures -> add "organic, NOT clinical, NOT sterile"
Choose the negations that match THIS reference. Do not add negations for objects not present in the frame.

1) IMAGE PROMPT (one prompt for BOTH Nano Banana Pro AND Seedream 4.5)
   - The user pastes the SAME prompt into both tools, so it must work for both.
   - MUST start verbatim with: "Real photograph taken with iPhone 17 Pro of"
   - Continuous natural-language English description, single dense paragraph (no lists, no markdown, no comma-tag format).
   - Include: subject + wardrobe/props, setting, framing (close-up / medium / wide), camera angle, lighting mood (clinical / amateur / studio / natural / handheld), color palette, photographic style (raw TikTok / editorial / lifestyle / documentary).
   - Apply the MANDATORY NEGATIONS above based on what the reference actually shows.
   - The attached reference frame PREVAILS over the textual scene beat whenever they conflict.
   - HARD LIMIT: <=2500 characters total.

2) KLING 2.5 TURBO (video, motion from reference image)
   - The reference image is the first frame. Describe ONLY the motion, camera move, timing, and emotional beat over 5s. Do NOT redescribe the static scene.
   - Match the energy of the reference: if reference is raw handheld TikTok, motion is handheld and abrupt; if reference is editorial, motion is smooth dolly. Do NOT default to smooth cinematic motion when the reference is raw.
   - Include: camera move (dolly-in / pan-left / handheld shake / static), subject action, micro-expression or tool-action change, pacing ("slow 2s build, sudden reveal at 3s"), atmosphere shift.
   - If the first frame is a COMPOSITE, PRODUCT REVEAL, or ENHANCED VISUALIZATION, add exactly ONE signature cinematic reveal beat inside the 5s — a rack-focus pull from the hand to the hero element, a slow push-in with soft motion blur peaking at 2s, a graceful in-camera morph of one overlay element into the next (continuous reveal, never an edit cut), a speed-ramp freeze landing on peak action, or a lens-breath zoom onto the impact zone. ONE beat only — stacked reveal beats mush into noise.
   - 1 short paragraph, English, <=60 words. No lists.

3) SEEDANCE 2.0 (video, motion arc + mood)
   - Cinematic motion arc. Describe the emotional/visual trajectory across the clip.
   - Match the reference's aesthetic register — do NOT upgrade raw footage to cinematic; do NOT downgrade polished footage to amateur.
   - Include: opening beat -> middle beat -> closing beat, camera language, rhythm of cuts or pushes, color/light evolution.
   - For composite / reveal / enhanced-visualization scenes, the MIDDLE beat MUST be the cinematic reveal — a deliberate rack focus, a speed ramp landing on peak action, or a seamless in-camera morph from the real surface into the enhanced layer — so the clip has a clear editorial hook, NOT aimless drift.
   - 1 paragraph, English, <=70 words.

=== B-ROLL MODE (when no reference image is attached) ===
When the user message is tagged "B-ROLL MODE ACTIVE", the video had no unique visual moment at this scene's timestamp — all distinct frames were already assigned to earlier scenes. You must generate a creative SUPPORT SHOT that visually reinforces the spoken script. Do NOT describe a talking-head shot. Use the ANALYSIS EXCERPT and SPOKEN LINE to understand the narrative context.

B-ROLL archetypes — choose the one that best matches the SPOKEN LINE:
  (a) PRODUCT CLOSE-UP: macro/tight shot of the device, applicator, package, or hero product element in sharp focus
  (b) APPLICATION SHOT: hands using or applying the product on the relevant zone (skin, surface, device, body area) — describe the hands and contact point, never a face
  (c) TARGET ZONE: close-up of the area where the problem exists or the product acts — e.g. skin texture, dirty surface, damaged material, anatomical zone — no face visible
  (d) ENVIRONMENT DETAIL: the relevant setting — domestic, clinical, tech, or outdoor — clean surfaces, lighting atmosphere, context props
  (e) TEXTURE / MATERIAL: macro of skin, the product's material/surface, or a relevant fabric/device detail

B-ROLL IMAGE PROMPT rules:
  - Still starts verbatim with: "Real photograph taken with iPhone 17 Pro of"
  - Maintain visual continuity with A-roll: same lighting palette, color temperature, production aesthetic
  - No face, no person looking at camera, no talking-head composition
  - Apply NEGATION HAZARD, CONTENT SAFETY, and all other SYS rules as normal
  - HARD LIMIT: <=2500 characters

B-ROLL KLING / SEEDANCE rules:
  - Slow, intentional cutaway motion: gentle zoom-in, lateral pan, or rack focus
  - No dialogue cues — this is a visual-only support cut
  - Match the energy of the ad: clinical and precise if medical, warm and intimate if wellness

Return ONLY a raw JSON object with exactly these 3 keys: image_prompt, kling, seedance. No preamble, no markdown fences, no code block. Each value must be a non-empty string. All prompts in English -- Higgsfield performs better in English even for Spanish ads.`;

export const Route = createFileRoute("/api/generate-higgsfield-prompts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return new Response("ANTHROPIC_API_KEY not configured", { status: 500 });

        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = authHeader.slice(7);
        const sb = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          {
            auth: { persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          },
        );
        const { data: claims, error: claimsErr } = await sb.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });
        const userId = claims.claims.sub;

        const cap = await checkSpendingCap(sb, userId, "api.generate-higgsfield-prompts");
        if (!cap.ok) return capExceededResponse(cap);
        const reservedUsd = cap.reservedUsd;

        const body = (await request.json()) as Body;
        if (!body.sceneId) return new Response("sceneId required", { status: 400 });

        const { data: scene, error: sceneErr } = await sb
          .from("variation_scenes")
          .select(
            "id, variation_id, order_idx, title, scene_text, script_es, screen_text, image_prompt_en, animation_prompt_en, reference_frame_time_sec, prompt_nano_banana, prompt_seedream, prompt_kling, prompt_seedance, workspace_id",
          )
          .eq("id", body.sceneId)
          .maybeSingle();
        if (sceneErr || !scene) {
          console.error("[higgsfield-prompts] scene lookup failed", {
            sceneId: body.sceneId,
            userId,
            sceneErrCode: sceneErr?.code,
            sceneErrMsg: sceneErr?.message,
            found: !!scene,
          });
          return new Response("Scene not found", { status: 404 });
        }

        // Workspace membership check antes de gastar tokens. RLS sobre
        // variation_scenes ya filtra por membership, pero hacemos doble check
        // explícito con admin client en caso de que alguna policy se relaje
        // accidentalmente o el endpoint se llame con sceneId de otro workspace
        // que sí tenga lectura por algún share futuro. Si no hay membership,
        // 403 antes de pegarle a Anthropic.
        const sceneWorkspaceId = scene.workspace_id ?? body.workspaceId ?? null;
        if (!sceneWorkspaceId) {
          return new Response("Scene has no workspace", { status: 400 });
        }
        const admin = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } },
        );
        const { data: membership } = await admin
          .from("workspace_members")
          .select("user_id")
          .eq("user_id", userId)
          .eq("workspace_id", sceneWorkspaceId)
          .maybeSingle();
        if (!membership) {
          return new Response("Forbidden: not a workspace member", { status: 403 });
        }

        if (
          !body.forceRegenerate &&
          scene.prompt_nano_banana &&
          scene.prompt_kling &&
          scene.prompt_seedance
        ) {
          const cappedImage = capImagePrompt(scene.prompt_nano_banana);
          if (cappedImage !== scene.prompt_nano_banana) {
            await sb
              .from("variation_scenes")
              .update({
                prompt_nano_banana: cappedImage,
                prompt_seedream: cappedImage,
              } as never)
              .eq("id", scene.id);
          }
          return new Response(
            JSON.stringify({
              ok: true,
              cached: true,
              costUsd: 0,
              prompts: {
                image_prompt: cappedImage,
                kling: scene.prompt_kling,
                seedance: scene.prompt_seedance,
              } satisfies Prompts,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }

        const { data: variation } = await sb
          .from("variations")
          .select("id, variation_type, title, project_id")
          .eq("id", scene.variation_id)
          .maybeSingle();

        let productName = "";
        let analysisExcerpt = "";
        if (variation?.project_id) {
          const { data: project } = await sb
            .from("projects")
            .select("name, analysis_text")
            .eq("id", variation.project_id)
            .maybeSingle();
          if (project) {
            productName = project.name ?? "";
            if (project.analysis_text) analysisExcerpt = project.analysis_text.slice(0, 3000);
          }
        }

        const hasFrame = !!body.referenceFrameDataUrl;
        const textFieldsLabel = hasFrame
          ? "NON-BINDING TEXTUAL HINTS (the attached image overrides any of these if they conflict; describe what you SEE in the image, not what the hints imply)"
          : "B-ROLL MODE ACTIVE — NO REFERENCE FRAME. Use the SPOKEN LINE and ANALYSIS EXCERPT below to generate a creative support shot (see B-ROLL MODE rules in SYS). Do NOT replicate an A-roll talking-head composition.";

        const userMsg = [
          hasFrame
            ? `=== GROUND TRUTH: ATTACHED IMAGE ===\nThe image attached above IS the composition to replicate. Describe its actual subject, tools/devices, overlays, arrows, anatomical diagrams, product reveals, color palette, and framing. Treat everything below as secondary hints only.`
            : "",
          variation && `Variation: ${variation.variation_type} -- "${variation.title ?? ""}"`,
          `Scene order: ${scene.order_idx}${scene.title ? ` -- ${scene.title}` : ""}`,
          scene.reference_frame_time_sec != null &&
            `Reference frame timestamp: ${scene.reference_frame_time_sec}s of the source ad.`,
          `=== ${textFieldsLabel} ===`,
          scene.scene_text && `SCENE BEAT:\n${scene.scene_text}`,
          scene.script_es && `SPOKEN LINE (Spanish):\n${scene.script_es}`,
          scene.screen_text && `SCREEN TEXT:\n${scene.screen_text}`,
          !hasFrame && scene.image_prompt_en && `PRIOR IMAGE PROMPT (may be outdated):\n${scene.image_prompt_en}`,
          scene.animation_prompt_en &&
            `=== ORIGINAL ANIMATION PROMPT (rewrite/enrich) ===\n${scene.animation_prompt_en}`,
          productName && `=== PRODUCT NAME ===\n${productName}`,
          analysisExcerpt && `=== ANALYSIS EXCERPT ===\n${analysisExcerpt}`,
          `Return ONLY the JSON with keys image_prompt, kling, seedance.`,
        ]
          .filter(Boolean)
          .join("\n\n");

        const userContent: ContentPart[] = [];
        if (body.referenceFrameDataUrl) {
          userContent.push(dataUrlToAnthropicImage(body.referenceFrameDataUrl));
        }
        userContent.push({ type: "text", text: userMsg });

        const model = resolveModel(body.model);
        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 3000,
            temperature: hasFrame ? 0.2 : 0.5,
            // Cache breakpoint en el system para que las 6 escenas del mismo
            // proyecto reusen el SYS prompt (~9k chars) a 0.10x.
            system: [{ type: "text", text: SYS, cache_control: { type: "ephemeral" } }],
            messages: [
              { role: "user", content: userContent },
            ],
          }),
        });

        if (!upstream.ok) {
          const errText = await upstream.text().catch(() => "");
          // Reconcile the held reservation back to zero so the spending cap
          // doesn't drift when the upstream fails before any tokens are spent.
          await logUsage({
            userId,
            workspaceId: body.workspaceId ?? null,
            model,
            operation: "anthropic_higgsfield_prompts_failed",
            inputTokens: 0,
            outputTokens: 0,
            reservedUsd,
            metadata: { upstreamStatus: upstream.status, sceneId: scene.id },
          }).catch((e) => console.warn("[higgsfield-prompts] reconcile log failed:", e));
          return new Response(`Anthropic ${upstream.status}: ${errText.slice(0, 400)}`, { status: 502 });
        }

        const data = (await upstream.json()) as {
          content?: Array<{ type: string; text?: string }>;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
          };
        };
        const raw = data.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return new Response("No JSON in response", { status: 502 });

        let prompts: Prompts;
        try {
          const obj = JSON.parse(jsonMatch[0]) as Partial<Prompts>;
          if (
            typeof obj.image_prompt !== "string" ||
            typeof obj.kling !== "string" ||
            typeof obj.seedance !== "string" ||
            !obj.image_prompt.trim() ||
            !obj.kling.trim() ||
            !obj.seedance.trim()
          ) {
            return new Response("Incomplete prompts in response", { status: 502 });
          }
          prompts = {
            image_prompt: capImagePrompt(obj.image_prompt),
            kling: obj.kling.trim(),
            seedance: obj.seedance.trim(),
          };
        } catch {
          return new Response("Malformed JSON in response", { status: 502 });
        }

        const { error: updateErr } = await sb
          .from("variation_scenes")
          .update({
            prompt_nano_banana: prompts.image_prompt,
            prompt_seedream: prompts.image_prompt,
            prompt_kling: prompts.kling,
            prompt_seedance: prompts.seedance,
          } as never)
          .eq("id", scene.id);
        if (updateErr) {
          console.error(
            `[higgsfield-prompts] DB update failed for scene ${scene.id}:`,
            updateErr,
          );
          return new Response(
            `DB update failed: ${updateErr.message ?? "unknown error"}`,
            { status: 500 },
          );
        }

        const cost = await logUsage({
          userId,
          workspaceId: body.workspaceId ?? null,
          model,
          operation: "anthropic_higgsfield_prompts",
          inputTokens: data.usage?.input_tokens ?? 0,
          cacheCreateTokens: data.usage?.cache_creation_input_tokens ?? 0,
          cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
          outputTokens: data.usage?.output_tokens ?? 0,
          reservedUsd,
          metadata: { sceneId: scene.id, variationId: scene.variation_id, orderIdx: scene.order_idx },
        });

        return new Response(
          JSON.stringify({ ok: true, cached: false, costUsd: cost, prompts }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
