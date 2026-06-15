---
name: social-publishing
description: Use when publishing a post to TikTok, Instagram, Facebook, YouTube, or LinkedIn, or when reading a post's reach/engagement. Covers the per-network tools, the async upload→publish→status flow, passing media as a public URL, and which networks need what.
---

# Social publishing

You publish natively to each connected network. The tools for a network
load automatically once its account is connected in the workspace — you
don't install them. Media is always passed as a **public URL** (from
`share_file` in the creative-generation skill), never a local path.

Tool names below are the Composio tools for each network. If a tool errors
with "not found", the account probably isn't connected — say so and ask the
user to connect it on the agent's integrations page; don't guess at
alternate names.

## TikTok

Async: upload the video, then publish, then poll status.

1. `TIKTOK_UPLOAD_VIDEO` — upload the 9:16 video by its public URL.
2. `TIKTOK_PUBLISH_VIDEO` — publish it with caption + hashtags.
3. `TIKTOK_FETCH_PUBLISH_STATUS` — poll until it reports published (TikTok
   processing is not instant). Photos use `TIKTOK_POST_PHOTO`.

## Instagram

Two-step container model (this is the Instagram Graph API pattern):

1. `INSTAGRAM_CREATE_MEDIA_CONTAINER` — create a container from the media
   URL + caption. For multi-image carousels use
   `INSTAGRAM_CREATE_CAROUSEL_CONTAINER`.
2. `INSTAGRAM_CREATE_POST` — publish the container.
3. `INSTAGRAM_GET_POST_STATUS` — confirm it went live.
   Reach/engagement: `INSTAGRAM_GET_POST_INSIGHTS`,
   `INSTAGRAM_GET_USER_INSIGHTS`.

## Facebook

Mostly single-step against the Page:

- Text/link: `FACEBOOK_CREATE_POST`
- Photo: `FACEBOOK_UPLOAD_PHOTO` then `FACEBOOK_CREATE_PHOTO_POST`
- Video: `FACEBOOK_UPLOAD_VIDEO` then `FACEBOOK_CREATE_VIDEO_POST`
- Insights: `FACEBOOK_GET_PAGE_INSIGHTS`, `FACEBOOK_GET_POST_INSIGHTS`

## YouTube

- `YOUTUBE_UPLOAD_VIDEO` — upload the 16:9 video with title + description +
  tags. Shorts are just a 9:16 video under 60s with #Shorts in the title.
- `YOUTUBE_UPDATE_THUMBNAIL` — set the custom thumbnail (generate a bold
  16:9 thumbnail in the creative step).
- Stats: `YOUTUBE_GET_CHANNEL_STATISTICS`, `YOUTUBE_VIDEO_DETAILS`.

## LinkedIn

Simple: `LINKEDIN_CREATE_LINKED_IN_POST` with the text and (optional) media
URL. Keep it more professional and less emoji-heavy than TikTok/IG.

## Rules

1. **Approval first.** `publish_post` is gated — draft the caption + attach
   the creative and submit for approval. Only publish after a yes. Never
   auto-publish from a schedule.
2. **Right asset, right network.** Use the destination's native aspect
   ratio (creative-generation skill). If you only have a 9:16 and need a
   16:9, regenerate — don't post the wrong shape.
3. **Caption in brand voice.** Pull tone from the brand handles + policy.
   Put hashtags where the network expects them (heavy on TikTok/IG, light
   on LinkedIn).
4. **Confirm, then log.** After publishing, confirm via the status/insights
   tool, then record the live post (network, id, time) in the ledger so the
   weekly report and any boost decision can find it.
5. **Async means poll.** TikTok and Instagram don't publish instantly —
   poll the status tool before reporting "published". A container or upload
   id is not a live post.
