---
name: social-publishing
description: Use when publishing a post to LinkedIn, Instagram, Facebook, YouTube, or TikTok, or when reading a post's reach/engagement. Covers calling each network's REST API through the mcp__apps__request proxy, the async upload→publish→status flow, passing media as a public URL, and which networks need what.
---

# Social publishing

You publish natively to each connected network by calling its REST API
through the **`request`** tool (server `apps`):

```
request({ provider, method, path, query?, body? })
```

- `provider` is the network's app slug (`linkedin`, `instagram`,
  `facebook`, `youtube`, `tiktok`). Each must be connected at /integrations
  first.
- **Auth is injected for you.** NEVER ask for, include, or echo a token.
- Media is always passed as a **public URL** (from `share_file` in the
  creative-generation skill), never a local path. The network fetches it
  over the network.
- The tool result is `{ status, body }`. Read `body` for the JSON payload.

If a call returns 401/403 on a network, the account probably isn't
connected (or the scope is missing) — say so and ask the user to connect it
at /integrations. Don't guess at alternate endpoints.

## LinkedIn

Single call against the UGC Posts API. **Base is `https://api.linkedin.com`.**

1. The `author` is your member/org URN. Resolve it once:
   `GET /v2/userinfo` → `body.sub` is the member id, so author is
   `urn:li:person:<sub>` (use `urn:li:organization:<id>` to post as a Page).
2. Publish the post:

```
request({ provider:"linkedin", method:"POST", path:"/v2/ugcPosts",
  body:{
    author:"urn:li:person:<sub>",
    lifecycleState:"PUBLISHED",
    specificContent:{
      "com.linkedin.ugc.ShareContent":{
        shareCommentary:{ text:"<caption in brand voice>" },
        shareMediaCategory:"NONE"   // "IMAGE" or "VIDEO" with a media URN
      }
    },
    visibility:{ "com.linkedin.ugc.MemberNetworkVisibility":"PUBLIC" }
  } })
// → body.id is the post URN (urn:li:share:...)
```

For an image post, first register + upload the asset
(`POST /v2/assets?action=registerUpload`), then set
`shareMediaCategory:"IMAGE"` and reference the returned asset URN in
`media[].media`. Keep LinkedIn copy professional and light on emoji.

## Instagram

Two-step container model (Instagram Graph API).
**Base is `https://graph.facebook.com`.** You need the IG business account
id (`<ig-user-id>`).

1. Create a media container from the public media URL + caption:
   `POST /v18.0/<ig-user-id>/media` ·
   `body:{ image_url:"<public url>", caption:"<text>" }` (use `video_url` +
   `media_type:"REELS"` for Reels). For carousels create one child container
   per image with `is_carousel_item:true`, then a parent with
   `media_type:"CAROUSEL"` and `children:[<ids>]`. Returns a creation `id`.
2. Publish it: `POST /v18.0/<ig-user-id>/media_publish` ·
   `body:{ creation_id:"<id>" }`.
3. Insights: `GET /v18.0/<media-id>/insights` ·
   `query:{ metric:"reach,likes,comments,saved" }`.

Video/Reels containers process asynchronously — poll
`GET /v18.0/<creation-id>?fields=status_code` until `FINISHED` before
publishing.

## Facebook

Mostly single-step against the Page (`<page-id>`).
**Base is `https://graph.facebook.com`.**

- Text/link: `POST /v18.0/<page-id>/feed` ·
  `body:{ message:"<text>", link?:"<url>" }`
- Photo: `POST /v18.0/<page-id>/photos` ·
  `body:{ url:"<public image url>", caption:"<text>" }`
- Video: `POST /v18.0/<page-id>/videos` ·
  `body:{ file_url:"<public video url>", description:"<text>" }`
- Insights: `GET /v18.0/<page-id>/insights` ·
  `query:{ metric:"page_impressions,page_engaged_users" }`;
  per-post: `GET /v18.0/<post-id>/insights`.

## YouTube

**Base is `https://www.googleapis.com`** (Data API v3).

- Upload metadata + media:
  `POST /upload/youtube/v3/videos` ·
  `query:{ part:"snippet,status" }` ·
  `body:{ snippet:{ title, description, tags:[...] },
          status:{ privacyStatus:"public" } }` with the video file.
  Shorts are just a 9:16 video under 60s with `#Shorts` in the title.
- Set the custom thumbnail:
  `POST /upload/youtube/v3/thumbnails/set` · `query:{ videoId:"<id>" }`
  (generate a bold 16:9 thumbnail in the creative step).
- Stats: `GET /youtube/v3/videos` ·
  `query:{ part:"statistics", id:"<videoId>" }`;
  channel: `GET /youtube/v3/channels` ·
  `query:{ part:"statistics", mine:true }`.

## TikTok

Async via the Content Posting API.
**Base is `https://open.tiktokapis.com`.**

1. Initialize the upload from the public video URL:
   `POST /v2/post/publish/video/init/` ·
   `body:{ post_info:{ title:"<caption + #hashtags>", privacy_level:"PUBLIC_TO_EVERYONE" },
           source_info:{ source:"PULL_FROM_URL", video_url:"<public url>" } }`.
   Returns a `publish_id`.
2. Poll status:
   `POST /v2/post/publish/status/fetch/` · `body:{ publish_id:"<id>" }`
   until `status` is `PUBLISH_COMPLETE` (TikTok processing is not instant).

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
   endpoint, then record the live post (network, id, time) in the ledger so
   the weekly report and any boost decision can find it.
5. **Async means poll.** TikTok and Instagram video don't publish instantly
   — poll the status endpoint before reporting "published". A container or
   `publish_id` is not a live post.
