# ScAry Project

**A completely separate project from ScAry Net.** Instant, temporary text-only rooms: share a link, join using nicknames, and chat without accounts, phone numbers, contacts, or an app installation. This is the **ScAry Project reference-dashboard edition**, including My Rooms, recovery keys, and the angular teal A logo.


## NEW: reply to a specific message and react with seven emojis

- Every delivered message has **↩ Reply** and **☺ React** controls. On mobile these controls stay visible; on desktop they appear on hover or keyboard focus.
- Replies contain a compact quotation of the original author's name and text. Click the quotation to jump to the original message if it is loaded.
- The reply preview above the composer can be cancelled with **×**. Replies in the local offline queue preserve their target and send after the connection returns.
- React with only **👍🏽 😂 😮 😢 😡 😭 🥀**. One reaction per participant per message; selecting another emoji switches it, and selecting the same emoji again removes it. Reactions are saved in D1 and refresh during room polling.
- A new participant cannot see, quote or react to messages from before they joined. Reactions require a valid room access key. No extra personal account is introduced.

### CRITICAL: Upgrade an existing, already deployed scaryproject.pages.dev database

**Do not run `schema.sql` again on your live database. Never run these commands against `scary-net-db`.**

1. Get the new project code locally (unzip the updated full ZIP into your **ScAry Project** project directory). Keep your deployed site on its existing version while migrating.
2. Open your **ScAry Project** folder in VS Code Terminal and back up your LIVE D1 database to your Mac Desktop:

   ```bash
   npx wrangler d1 export scary-project-db --remote --output="$HOME/Desktop/ScAry-Project-backup.sql"
   ```

   Confirm that the terminal says it was successfully downloaded. Do **not** upload the backup to public GitHub.
3. Add the two new database structures by running the **additive migration once**:

   ```bash
   npx wrangler d1 execute scary-project-db --remote --file=./migration_message_interactions.sql
   ```

   Confirm that the SQL executed successfully. This adds one nullable `reply_to_id` column and a new `message_reactions` table. It does not delete old rooms, users or messages. **Do not repeat this migration** once it succeeds.
4. Push/upload the updated source files to your **ScAry-Project** GitHub repository (do not touch ScAry-Net). The Cloudflare Pages Git integration should trigger deployment. Build output must remain `public`, and the D1 binding must still be called `DB`, pointing to `scary-project-db`.
5. After successful deployment, refresh the website. In a room, use **Reply** under any message or **React** and choose one of the seven emojis. Test with another browser or device to confirm both users see saved replies and reaction counts.

**Sequence matters:** migrate **before** deploying the updated code. New code requires the new column and reaction table, while old code keeps working with the additive schema.

**Preview mode:** `ScAry Project Preview.html` simulates replies and reactions locally. It does not send live messages to other people.

## First: preview the design without deploying

Open **`ScAry Project Preview.html`** (supplied next to the ZIP and inside the ZIP) in Safari or Chrome on your Mac. It is **an interactive design simulation on your own device**. Create multiple sample rooms, switch between them using **My Rooms**, test unread badges, send sample messages, recover a room using its secret access key, try host options and preview the responsive layout. This preview **cannot invite another real person**. Only the deployed website supports live messages between different devices.

## What's included

- Create a temporary room with a custom title, choose **1 hour / 24 hours / 3 days / 7 days / 30 days / 90 days**.
- Share a room invitation URL (`https://YOUR-PAGES-SITE.pages.dev/?room=XXXXXXXXXX`).
- Enter with a **nickname** instead of creating an account; **no phone number, SIM or email required**.
- Optional password, room lock, and approval-required waiting room.
- Host can approve or decline waiting guests, remove or ban an existing guest, read guest reports and close the room.
- Message history stored in **its own Cloudflare D1 database**; only currently authorized guests can read it. New joiners see messages from their join time onward.
- **My Rooms inbox** automatically remembers up to 50 hosted/joined rooms on the current browser, with quick switching, unread-message badges, role/status, and remaining lifetime.
- **Room access recovery:** users can copy a secret access key and use **Join → Restore access** on another device to recover the same nickname and host privileges, without creating a new account. The key is a bearer credential: keep it private.
- Basic low-data, text-only design; **messages drafted with an open page are queued locally when a network send fails**, and retried when connectivity returns.
- Messages have idempotent IDs so a retried message is not duplicated.
- Responsive on mobile and desktop. No external JavaScript libraries, fonts or tracking scripts.
- Separate, simulated `?demo=1` mode for design exploration.
- **65 automated simulated D1/API integration tests** (Node 22+ with SQLite support).

## Using the final My Rooms interface

1. Create a room or join one using its invitation link and a nickname. The browser automatically remembers that room under **My Rooms**.
2. Click **My Rooms** in the left rail to view the inbox without leaving the conversation. On a narrow phone screen, use the room menu to return to My Rooms. Click any other room to continue there. A room's 1-hour / 24-hour / 3-day / 7-day / 30-day / 90-day expiration runs from its creation time, even if everyone closes the website.
3. While other members chat, **unread badges** appear beside those rooms when summaries refresh. Opening the room clears its unread badge on this device. They are not cross-device read receipts and are not guaranteed to update instantly.
4. Inside each room click **Save my private access key** and store it in a private password manager or secure note. **Do not send the access key with the invitation link.** It grants your full room identity, including host permissions if applicable.
5. If you change device or clear site storage: choose **Join a room → Have a saved room access key?**, enter the room code/link and the secret key to restore the original identity. Without the key, you can only attempt to join again under a new nickname (if permitted).
6. If the room expires, it can be dismissed from My Rooms. Its old history is no longer accessible through the messaging API. Actual database deletion is performed lazily later, as described below.

The **My Rooms** list is not a social account. It is deliberately stored only on the current device, to avoid sign-up requirements.

## Deploy as a NEW Cloudflare Pages project

**IMPORTANT: Do not use ScAry Net's repository, Cloudflare Pages project, or `scary-net-db`. This project needs an entirely separate repo and database.**

1. Unzip `ScAry Project.zip`. Open the **ScAry Project** folder in VS Code.
2. Create a **new GitHub repository**, e.g. `ScAry-Project`, and upload all the files inside the **ScAry Project** folder. Keep the `functions` and `public` folders at the repository root.
3. Log in to Cloudflare using your existing account. In your VS Code Terminal, run:

   ```bash
   npx wrangler login
   npx wrangler d1 create scary-project-db
   ```

   Save the **new database ID** given by Wrangler. Do **not** re-use the ScAry Net database ID.

4. Create the project tables in that new database **once**:

   ```bash
   npx wrangler d1 execute scary-project-db --remote --file=./schema.sql
   ```

5. On Cloudflare, create a **NEW Pages project** connected to your new GitHub repository. Choose a new subdomain (for example `scaryproject.pages.dev` if available). Use **no framework**, no build command, and set the **build output directory to `public`**. The `functions/` directory must remain at the repository root.
6. In this **new Pages project**: **Settings → Bindings → Add → D1 database**, bind your **new** database `scary-project-db` with variable name **`DB`**. Set this for Production (and Preview if you test preview builds). **Redeploy** the project after binding.
7. Visit your new site, create a room, copy its invite link, and open it on another phone/browser. Join using a second nickname. Try messaging and the room controls.

Cloudflare Pages and D1 offer free allowances, but **free forever at any scale is not guaranteed**. Usage limits, data charges and service availability depend on Cloudflare's plans.

## Run it locally with a REAL local D1 database (optional)

1. Copy `wrangler.example.jsonc` to a local file called `wrangler.jsonc`. Paste the **new** database ID from step 3 into the `database_id` field (never use your ScAry Net ID).
2. Run:

   ```bash
   npx wrangler d1 execute scary-project-db --local --file=./schema.sql
   npx wrangler pages dev public
   ```

3. Open the local address Wrangler shows (often `http://localhost:8788`). Test with another tab or browser. Local data is separate from production.

The `.gitignore` excludes your local `wrangler.jsonc`, so the Cloudflare Dashboard binding remains the deployed source of truth. `wrangler.example.jsonc` is only a starting template.

## Automated checks (optional)

On a Mac with Node 22 or newer:

```bash
node --disable-warning=ExperimentalWarning tests/check.mjs
```

This uses an in-memory SQLite database and simulates Cloudflare D1 requests. It does not connect to or change your live database. It validates creation, password checks, invitations, approvals, guest-only chat access, sends/retries, reports, moderation, multiple rooms, unread summaries, restoration of existing host identity, and expiry. **It does not replace real browser-to-browser deployment testing.**

## How room privacy works

- Every room uses a private **guest/host access token** stored in that browser's local storage. It is **not part of an invitation link**. From within a room, choose **Save my private access key** and store it securely to restore that identity from another browser or phone. **Anyone who receives that key can impersonate that guest or host.** There is no email-based recovery or administrative reset if the key is lost.
- Guest tokens are stored as SHA-256 hashes in D1. Passwords are salted and PBKDF2-hashed (tuned to Cloudflare Workers free-tier CPU limits). HTTPS is required in production.
- **No end-to-end encryption:** the service/database operator can technically see stored messages. Don't use this beta for highly sensitive conversations.
- Bans are scoped to a room identity; a determined person might rejoin under a different nickname. For hostile/public rooms you'd need stronger anti-abuse tools and independent moderation.
- **Room expiration blocks access immediately**, but D1 records are **not guaranteed to be erased at the exact expiry time**. Expired room records are lazily cleared on future room creation after an additional 24 hours. To guarantee timely deletion, add scheduled cleanup.
- Reports are visible **only to that room's host**; there is no central moderation team or automated review.
- Messages queued on the user's device use local storage in readable form. Clear site data to remove local drafts, but this will also remove your guest/host token.
- For true offline-to-offline communication, this website alone is insufficient. New messages cannot be delivered without an internet connection to the Cloudflare server.

## Current technical limitations

- **My Rooms is device-local**, not a synchronized account: switching computers will not automatically show your room list. Recover each room using its private access key. Unread badges are approximate per-browser counters, updated when you open/refresh the site and roughly every minute while it is visible. There are **no push notifications**.
- Room maximum is **50 participants**. It uses short HTTP polling (~4.5 seconds while the room tab is visible), not WebSockets.
- The invitation code is hard to guess, but **anyone who receives it can attempt to join** unless the room has a password, approval mode or a lock.
- Guests are pseudonymous, **not verified identities**.
- A username/nickname cannot be re-used within a room (including after its owner leaves).
- Room messages are limited to **1,200 characters** each. There are no photos, files, audio, video or voice calls.
- Offline queueing is best-effort while the website is open; this is **not a fully offline-capable standalone app**. The network must return before other people receive the queued messages.
- This release passed **65 simulated API integration checks** and desktop/mobile preview interaction checks, but it has **not been tested against a real deployed Cloudflare project** or independently security-audited. Run real multi-device, moderation and load tests before advertising a large public launch.

## Reference docs

- Cloudflare Pages Functions: https://developers.cloudflare.com/pages/functions/get-started/
- Cloudflare Pages D1 bindings: https://developers.cloudflare.com/pages/functions/bindings/
- Cloudflare Pages configuration: https://developers.cloudflare.com/pages/functions/wrangler-configuration/
- Cloudflare Workers Free plan limits: https://developers.cloudflare.com/workers/platform/limits/

## Dashboard layout & expanded room durations

This edition uses a charcoal/teal dashboard with a dedicated navigation rail, searchable and filterable My Rooms inbox, main conversation panel and room-info panel. Only the **A** in ScAry is teal; all other brand letters are white. The room duration choices are now **1 hour, 24 hours, 3 days, 7 days, 30 days and 90 days** in both preview and live Cloudflare backend. All durations begin immediately at creation. 30/90-day rooms can use more database storage; periodically review D1 usage and free-tier limits. No user accounts, phone numbers, or additional dependencies are required.

## Exact reference-inspired dashboard edition

This version matches the approved dark charcoal / bright teal UI direction, including:

- Angular teal **A-shaped icon** in the header and favicon; within **ScAry**, only the capital **A** is teal.
- Left navigation: Create Room, My Rooms, Joined Rooms, Starred Rooms, Room Recovery and quick actions.
- Searchable room inbox with Created/Joined filters, unread badges, member count and expiry.
- Central chat with author avatars, message bubbles, dates, input tools and send button.
- Right room-information and member panels with invitation and host controls.
- Collapsible room settings, guest moderation, access-key recovery, role badges, and a mobile drawer.

**Important honesty about the preview:** The sample **project_dataset.xlsx** attachment rendered in the demonstration is a visual sample from the reference screenshot. The real Cloudflare application is **text-only** and does **not** upload, store, or download file attachments. Clicking the preview file explains this. The add (+) button likewise explains the text-only restriction. All existing messaging, room controls and durations remain functional.

The bundled preview automatically opens a **simulated University Project room** with sample members and conversations so you can compare the look without deploying anything. Click **Create Room**, **My Rooms**, or **Home** to try other screens. None of the demo users or messages exist on your deployed server.
