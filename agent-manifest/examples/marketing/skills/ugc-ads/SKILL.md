---
name: ugc-ads
description: Use when making UGC-style ads (the authentic, creator-talking-to-camera format that wins on TikTok/Reels). Covers the locked recipe for talking-creator video (generate a person, voice a script, lip-sync), the faceless format, the script craft, and the MANDATORY self-review loop — view every asset and fix it before showing the user.
---

# UGC ads

UGC (user-generated-content style) ads look like a real person filmed it on
their phone — not a polished commercial. **A UGC ad is a person talking to
camera, lip-synced — NOT a scene clip with a caption.**

You build UGC by composing primitives — image → voice → lip-sync — and you
**check your own work at every step** (see Self-review, below). You can see
images: use the **Read tool** on any generated file (it supports vision). You
can see a video by extracting a frame with `ffmpeg` and Reading it. Never
send an asset you haven't looked at.

## The locked recipe (don't improvise the models)

These are chosen and proven. Use them; don't swap unless the user asks.

1. **Person image** — `image.generate` with **`model: "fal-ai/flux-pro/v1.1-ultra"`**
   and **`aspect_ratio: "9:16"`**. (The cheap default models make plasticky,
   cartoon people — ultra makes photoreal ones.)
   - **Framing is the single most important thing: TIGHT head-and-shoulders.**
     Face fills the frame, looking into a front-facing phone camera, **no
     hands or arms in the shot.** Loose/full-body selfies make the lip-sync
     model invent and mangle arms. Tight crop = no arms to break + reads as
     real UGC.
   - Prompt for realism: "candid smartphone front-camera photo, photorealistic
     skin with visible pores and texture, natural lighting", real setting
     (clinic/exam room) blurred behind.
2. **Talk** — `video.generate` with that **`image`** AND **`avatar`** set, and
   **`prompt` = the verbatim script**. The engine voices the script and
   lip-syncs it to that exact face. You do NOT pass audio — just image + script.

```
const doctor = image.generate({
  model: "fal-ai/flux-pro/v1.1-ultra", aspect_ratio: "9:16",
  prompt: "tight close-up head and shoulders selfie of a tired warm 38yo
   female physician in a white coat, face fills the frame, looking into a
   front-facing phone camera, exam room blurred behind, candid smartphone
   photo, photorealistic skin with pores, natural light, no hands or arms in
   frame" })
// → SELF-REVIEW the image (below) before animating it.
video.generate({ image: doctor.path, avatar: "custom",
  prompt: "Okay real talk — if you're a doctor still charting at 11pm, you
   need ScribeMD. It listens to your visit and writes the note for you. I got
   two hours of my night back. Link's right here." })
// → SELF-REVIEW the video before sending.
```

## Self-review loop (MANDATORY — this is how quality stays high without the user QA-ing for you)

After EVERY generation, look at it and judge it honestly. Regenerate until it
passes. Only then send.

**After the image** — Read the file. Check:
- Photoreal, not cartoon/plastic/airbrushed? (skin texture, real eyes)
- Tight head-and-shoulders, face fills frame, **no hands/arms** visible?
- 9:16 vertical? Right person (e.g. actually reads as a doctor, right setting)?
- If any fail → adjust the prompt and regenerate. Don't proceed with a bad still.

**After the video** — extract a frame and Read it (and check duration/dims):
```
ffmpeg -y -i <video> -vf "select=eq(n\,12)" -vframes 1 /tmp/frame1.png   # early
ffmpeg -y -i <video> -vf "select=eq(n\,80)" -vframes 1 /tmp/frame2.png   # later
ffprobe -v error -show_entries stream=width,height -show_entries format=duration <video>
```
Read both frames. Check:
- Face still photoreal in motion (not waxy/melting)?
- **Hands and body intact** — no extra/distorted limbs, no mangled arms?
- Still 9:16, framed on the face?
- If any fail → regenerate (tighten the crop on the source image if it's a
  hands/arms problem). Don't send a broken clip.

Tell the user, briefly, that you reviewed each one ("checked all three — faces
hold up, hands clean, 9:16").

## Faceless UGC (no on-camera person)

Punchy b-roll + voiceover + big burned-in captions. The only UGC format that
uses scene clips — and even here they're b-roll *under* a voiceover, never a
lone captioned scene. 1) 2–4 short scene clips (video tool, no avatar). 2) TTS
the script (voice tool). 3) Captions + music + stitch (editing step). Self-review
the same way.

## Script craft (80% of UGC performance)

1. **Hook in the first 1–2 seconds.** A sharp problem or pattern-interrupt:
   "POV: it's 11pm and you're still charting."
2. **First person, spoken, casual.** Contractions, short sentences, one idea
   per line. Read it aloud — if it sounds written, rewrite it.
3. **One problem → one product moment → one CTA.** Don't list features; show
   the before/after feeling ("I got my evenings back").
4. **Native, not salesy** — a peer recommendation, not an ad.
5. **Clear low-friction CTA** ("link in bio", "try it free").

## Rules

- A UGC ad is a talking person, lip-synced — never a bare captioned scene.
- Tight head-and-shoulders framing, always 9:16, ~15–30s of speech.
- **Self-review every asset before sending. No exceptions.**
- Make variants — different creators, hooks, voices. UGC is a numbers game.
- Publishing goes through approval (social-publishing skill) — draft, submit,
  don't auto-post.
- Tell the user which creator + script produced each clip, and that you reviewed it.
