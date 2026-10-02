# AeroTrack Cloudflare backend

This Worker keeps the Aviationstack key on the server and stores only the data approved for active-domain records:

- random extension installation ID
- active hostname/domain
- server-generated receive time
- consent schema version

It does not store the visitor IP address, User-Agent, full URL, URL path/query, page title/content, cookies, search terms, or previous browser history.

## One-time Cloudflare setup

1. Install dependencies and sign in:

   ```bash
   npm install
   npx wrangler login
   ```

2. Create the free D1 database:

   ```bash
   npx wrangler d1 create aerotrack-production
   ```

3. Replace the placeholder `database_id` in `wrangler.jsonc` with the ID printed by Cloudflare.

4. Apply the database migration:

   ```bash
   npm run db:remote
   ```

5. Add secrets. Paste each value only into Wrangler's secure prompt:

   ```bash
   npx wrangler secret put AVIATIONSTACK_API_KEY
   npx wrangler secret put ADMIN_TOKEN
   ```

   Use a new random password of at least 32 characters for `ADMIN_TOKEN`.

6. Deploy:

   ```bash
   npm run deploy
   ```

7. Copy the resulting HTTPS Worker URL into the extension's `js/shared-config.js`. Replace the temporary `https://*.workers.dev/*` host permission in each manifest with the exact deployed Worker origin before store submission.

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Backend and provider configuration check |
| `GET` | `/admin` | Client-friendly password-protected records page |
| `POST` | `/api/activity` | Consent-gated active-domain record |
| `GET` | `/api/admin/activity?limit=100` | Recent records as JSON; Bearer admin token required |
| `GET` | `/api/admin/activity.csv?limit=5000` | Recent records as CSV; Bearer admin token required |
| `GET` | `/api/getAirports` | Airport autocomplete proxy |
| `GET` | `/api/getAirlines` | Airline autocomplete proxy |
| `GET` | `/api/getFlights` | Flight lookup proxy |
| `GET` | `/api/getCityByIataCode` | City lookup proxy |

Example admin request:

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  "https://YOUR-WORKER.workers.dev/api/admin/activity?limit=100"
```

The scheduled cleanup keeps 30 days of records by default. Change `RETENTION_DAYS` in `wrangler.jsonc` only after the client confirms a different retention period.
