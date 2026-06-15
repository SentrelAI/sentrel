---
name: creative-generation
description: Use when generating images or video for a post or ad. Covers prompting on-brand, the right aspect ratio per network, generating with the built-in image/video tools (Higgsfield when available), and turning a generated asset into a public URL the posting and ad tools can use.
---

# Creative generation

You generate stills and video with the agent's built-in capability tools —
not a Composio integration. When a Higgsfield key is configured these run
on Higgsfield (FLUX stills, cinematic image-to-video); otherwise they fall
back to whatever generator the workspace has a key for. You don't choose
the vendor — you call the tool and it resolves.

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
   and the format. Keep text-in-image minimal — generators mangle long
   copy; put the words in the caption, not baked into the asset.
2. **Make variants.** Creative is cheap. Generate 2–3 options for a slot so
   the human (or an A/B test) has a choice. Note them in the ledger.
3. **Video from a still.** For motion, generate a strong still first, then
   animate it with the video tool (image-to-video) — more controllable than
   pure text-to-video and keeps the framing on brand.
4. **Respect safety.** If a generation is refused or flagged, don't retry
   the same prompt — adjust it. Never generate anything that breaches the
   brand-and-safety policy.

## Handing off to a post or an ad

```
generate image (9:16, on-brand)  → /workspace/generated/image-….png
share_file(that path)            → { url: "https://…/api/blobs/…" }
→ give that url to the social-publishing or meta-ads skill
```

Always keep the workspace path AND the shared URL in the ledger so you can
reuse an approved asset across networks without regenerating it.
