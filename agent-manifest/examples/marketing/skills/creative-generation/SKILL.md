---
name: creative-generation
description: Use when generating images or video for a post or ad. Covers prompting on-brand, the right aspect ratio per network, generating with the built-in image/video tools (Higgsfield when available), and turning a generated asset into a public URL the posting and ad tools can use.
---

# Creative generation

You generate stills and video with the agent's built-in capability tools —
not a Composio integration. The tool resolves a vendor by default, but for
ad creative you should choose the model:

- **Ad creative / posters → `model: "fal-ai/nano-banana-pro"`.** It renders
  crisp, legible text *on* the image (headlines, sub-headers, CTA buttons,
  logos) and clean SaaS-ad layouts — FLUX and the older models mangle text,
  which is why earlier ads looked off. Use this for any ad or poster.
- **Photoreal people/scenes (no baked text) → `model: "fal-ai/flux-pro/v1.1-ultra"`.**
- Otherwise just call the tool and let it resolve the default.

## Tools

| Need | Tool | Returns |
|------|------|---------|
| Generate an image | the image-generation tool (`generate`) | a file path in the workspace |
| Generate / animate video | the video-generation tool (`generate`) | a file path in the workspace |
| Make an asset postable | `share_file` | a public `https://…/api/blobs/…` URL |

The generation tools save assets to the workspace and hand back a local
file path. Posting APIs and ad APIs need a **public URL**, so every asset
you intend to publish must be passed through `share_file` first — that
returns the signed URL you give to the platform tools.

## Format per destination (always)

| Destination | Aspect ratio | Notes |
|-------------|--------------|-------|
| TikTok, IG Reels, YouTube Shorts | **9:16** | vertical, full-bleed, hook in first 1s |
| Instagram feed | **1:1** or **4:5** | 4:5 takes more screen height |
| Facebook feed | **1:1** or **4:5** | same as IG feed |
| YouTube (landscape) + thumbnails | **16:9** | thumbnail needs a bold focal point |
| LinkedIn | **1:1** or **16:9** | cleaner, more corporate framing |

Generate in the destination's native ratio. Never stretch or letterbox a
9:16 into a 16:9 slot — regenerate at the right ratio instead.

## Generating well

1. **Prompt on brand.** Pull the voice/style from the brand-and-safety
   policy and the brand handles. Name the subject, the mood, the lighting,
   and the format. For ad creative with **Nano Banana Pro** you CAN bake the
   headline + sub-header + CTA into the image (spell the exact text in the
   prompt, e.g. `headline reading "STOP CHARTING AFTER MIDNIGHT"`) — it
   renders text cleanly. For non-nano models keep text minimal and put the
   words in the caption instead.
2. **Make variants.** Creative is cheap. Generate 2–3 options for a slot so
   the human (or an A/B test) has a choice. Note them in the ledger.
3. **Respect safety.** If a generation is refused or flagged, don't retry
   the same prompt — adjust it. Never generate anything that breaches the
   brand-and-safety policy.

## Poster vs. video frame — two DIFFERENT source images

This matters a lot and is easy to get wrong:

- A **static-post poster** is composed with deliberate empty negative
  space (top/bottom) so you can overlay hook text on it later.
- A **video source frame** must be **FULL-BLEED**: the scene fills the
  entire frame edge-to-edge, with NO empty bands and NO reserved text
  space. Bands in the source make the video look like a small image that
  then zooms in — exactly what you don't want.

So when the ask is "animate this / make a video", do NOT animate the
text-poster. **Generate a fresh full-bleed frame** (prompt it as
"full-bleed, scene fills the entire 9:16 frame, no empty space"), then
animate THAT. Put any on-screen text on top of the finished video, never
baked into the source frame.

## Animating a still into video (image-to-video)

1. **Use a full-bleed source** (above) — not a poster with bands.
2. **Share it first.** `share_file(<path>)` → a public `https://…/api/blobs/…`
   URL. The video tool's `image` argument MUST be that URL, never a local
   `/data/...` path (the provider fetches it over the network). A
   `422 image_url required` means you skipped this step.
3. **Call video** with that URL as `image`, the motion prompt, and
   `aspect_ratio: "9:16"`. Clips render ~5s natively; for longer, render a
   few and stitch them.

## Handing off to a post or an ad

```
generate image (9:16, on-brand)  → /workspace/generated/image-….png
share_file(that path)            → { url: "https://…/api/blobs/…" }
→ give that url to the social-publishing or meta-ads skill
```

Always keep the workspace path AND the shared URL in the ledger so you can
reuse an approved asset across networks without regenerating it.
