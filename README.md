# AeroTrack Flight Hub v0.4.0

This bundle contains:

- Manifest V3 packages for Chrome, Edge, and Firefox;
- the existing flight dashboard and three-permission visual verifier;
- explicit consent and settings controls for active-domain sharing;
- a Cloudflare Worker and D1 schema for domain records;
- a server-side Aviationstack proxy so the API key is never shipped in the extension;
- password-protected JSON and CSV activity exports;
- a client-friendly admin records page at `/admin`;
- automated backend, privacy, and manifest tests.

## Data contract

After explicit user consent, a record contains only:

```json
{
  "installationId": "random-extension-uuid",
  "domain": "example.com",
  "receivedAt": "server-generated ISO timestamp"
}
```

No full URL, page title/content, previous history, incognito activity, cookies, User-Agent, stored IP address, or hardware identifier is collected.

## Test

```bash
npm test
```

## Deploy and configure

Follow `backend/README.md` to create the free D1 database, add Cloudflare secrets, and deploy. Then configure all three extensions at once:

```bash
npm run configure -- \
  https://YOUR-WORKER.workers.dev \
  https://YOUR-SITE.example/privacy \
  https://YOUR-SITE.example/support
```

Do not submit to browser stores while any placeholder remains. Review `docs/RELEASE_BLOCKERS.md` and complete `docs/PRIVACY_POLICY_TEMPLATE.md` first.
