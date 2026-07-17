# Getting an API key from each platform

All of this is optional. Any platform you skip just shows clearly-labeled
demo data on the dashboard instead of breaking anything. Do as many or as
few of these as you want, whenever you want — paste the value into
[`/admin`](../README.md#admin--security) and it takes effect on the next
sync, no restart needed.

Each section below ends with the exact field name(s) from the admin page /
`.env` — they match `.env.example` exactly.

---

## X (Twitter)

**Fields:** `TWITTER_BEARER_TOKEN`, `TWITTER_USERNAME`

1. Go to [developer.x.com](https://developer.x.com) and sign in with the X
   account you want to track. Apply for a developer account if you don't
   have one yet (usually instant approval for read-only use).
2. Once approved, go to the **Developer Portal** → **Projects & Apps** →
   create a new **Project**, then create an **App** inside it.
3. The free **Basic** access tier is enough — this app only reads public
   metrics (follower count, recent tweet engagement), it never posts.
4. Open your App → **Keys and tokens** tab.
5. Under **Authentication Tokens**, find **Bearer Token** and click
   **Generate** (or **Regenerate** if one already exists). Copy it
   immediately — X only shows it once.
6. `TWITTER_USERNAME` is just your handle without the `@` (e.g. `signal`).

→ Paste into **`TWITTER_BEARER_TOKEN`** and **`TWITTER_USERNAME`**.

---

## YouTube

**Fields:** `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   create a new project (or reuse an existing one) from the project
   dropdown at the top.
2. In the left sidebar, go to **APIs & Services** → **Library**, search for
   **YouTube Data API v3**, and click **Enable**.
3. Go to **APIs & Services** → **Credentials** → **Create Credentials** →
   **API key**. It's generated instantly.
4. Click **Edit** on the new key and, under **API restrictions**, restrict
   it to **YouTube Data API v3** only — good practice for a key that's going
   to live in an env var.
5. For your channel ID: go to [YouTube Studio](https://studio.youtube.com) →
   **Settings** → **Channel** → **Advanced settings**. Your channel ID is
   listed there (starts with `UC`).

→ Paste into **`YOUTUBE_API_KEY`** and **`YOUTUBE_CHANNEL_ID`**.

---

## Instagram

**Fields:** `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`

Requires an Instagram **Business** or **Creator** account linked to a
Facebook Page (Instagram's own developer settings won't let you skip this —
it's a Meta Graph API requirement, not a Signal one).

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My
   Apps** → **Create App** → choose type **Business**.
2. In your new app's dashboard, add the **Instagram Graph API** product
   (under **Add Products**).
3. Go to **Tools** → **Graph API Explorer** (top-level Meta developer tool,
   not inside the app dashboard).
4. In the Explorer: pick your app from the dropdown, click **Generate Access
   Token**, and grant `instagram_basic` and `instagram_manage_insights`
   permissions when prompted. Log in with the Facebook account that manages
   the Page linked to your Instagram account.
5. This short-lived token expires in about an hour — exchange it for a
   long-lived one (60 days) by going to **Tools** → **Access Token
   Debugger**, pasting the token, and clicking **Extend Access Token**.
   Copy the extended token.
6. For your Instagram user ID: in Graph API Explorer, query
   `me/accounts` to list your Pages, copy that Page's `id`, then query
   `<PAGE_ID>?fields=instagram_business_account` — the number returned is
   your Instagram user ID.

→ Paste into **`INSTAGRAM_ACCESS_TOKEN`** and **`INSTAGRAM_USER_ID`**.

*Note: long-lived tokens still expire after 60 days — you'll need to repeat
step 5 periodically. Meta doesn't offer a truly permanent token for this API.*

---

## Facebook Page

**Fields:** `FACEBOOK_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`

Uses the same Meta App as Instagram above — if you already did that section,
skip to step 3.

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My
   Apps** → **Create App** → type **Business** (or reuse the one from the
   Instagram section).
2. Go to **Tools** → **Graph API Explorer**.
3. Pick your app, click **Generate Access Token**, and grant
   `pages_read_engagement` and `pages_show_list` permissions. Log in with
   the account that manages your Page.
4. In the Explorer, query `me/accounts` — this lists every Page you manage
   along with a **Page Access Token** for each one. Copy the token next to
   the Page you want to track (Page tokens from this endpoint are long-lived
   by default, unlike the user token above).
5. The same `me/accounts` response includes each Page's `id` — that's your
   Page ID. You can also find it on the Page itself, under **About**.

→ Paste into **`FACEBOOK_ACCESS_TOKEN`** and **`FACEBOOK_PAGE_ID`**.

---

## TikTok

**Field:** `TIKTOK_ACCESS_TOKEN`

⚠️ **Heads up before you start:** TikTok's API requires an app review before
it works outside a sandbox with test users only. Approval can take days to
weeks and isn't guaranteed for small/personal use cases — budget time for
this one, or skip it and let the dashboard show demo data in the meantime.

1. Go to [developers.tiktok.com](https://developers.tiktok.com) → sign up
   as a developer → **Manage apps** → **Create an app**.
2. Add the **Login Kit** product, then the **Display API** product, to the
   app.
3. Under **Login Kit** settings, add a redirect URI (any URL you control —
   it just needs to receive the OAuth callback; a placeholder works if
   you're testing locally).
4. Submit the app for review, listing the scopes you need (basic profile +
   video list for follower/engagement reads). Once approved, complete the
   OAuth2 authorization-code flow documented on that same app page (visit
   the authorize URL, log in, get redirected with a `code`, exchange it for
   an access token via TikTok's token endpoint) to obtain a user access
   token.

→ Paste into **`TIKTOK_ACCESS_TOKEN`**.

---

## LinkedIn

**Fields:** `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_ORG_ID`

⚠️ **Heads up before you start:** the API this dashboard needs (Community
Management API, for organization follower/post analytics) is **not
self-serve** — it requires applying to LinkedIn's **Partner Program** and
being manually approved, which can take weeks and isn't guaranteed. If
that's not realistic right now, skip this one — the dashboard will show
demo data for LinkedIn until you're approved.

1. Go to [developer.linkedin.com](https://developer.linkedin.com) → **My
   Apps** → **Create App**. You'll need an associated LinkedIn Company Page.
2. Under **Products**, request access to **Community Management API**.
   This is the gated step — LinkedIn reviews the request against the
   Partner Program criteria before granting it.
3. Once approved, go to the app's **Auth** tab and complete the OAuth2
   3-legged flow (authorize URL → user login/consent → redirect with a
   `code` → exchange for an access token at LinkedIn's token endpoint),
   requesting the `r_organization_social` and `rw_organization_admin`
   scopes.
4. Your organization ID is the numeric ID in your Company Page's admin URL
   (`linkedin.com/company/<numeric-id>/admin/`), or available via the
   `organizationAcls` endpoint once authenticated.

→ Paste into **`LINKEDIN_ACCESS_TOKEN`** and **`LINKEDIN_ORG_ID`**.

---

## After you have a key

Log in at `/admin`, paste the value(s) into their fields, and click **Save**.
No restart required — it's picked up on the next sync. The dashboard marks
that platform `LIVE` once it successfully pulls real data; if a call ever
fails (expired token, rate limit, revoked access), it falls back to demo
data automatically rather than breaking the page.
