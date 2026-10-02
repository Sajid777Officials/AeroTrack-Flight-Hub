# AeroTrack Flight Hub Privacy Policy

**Effective date:** [DATE]  
**Developer/legal entity:** [CLIENT LEGAL NAME]  
**Contact:** [PRIVACY EMAIL]  
**Website:** [PRODUCT WEBSITE]

This policy describes how AeroTrack Flight Hub handles information. Replace every bracketed field and have the client review the final policy before publication.

## Purpose

AeroTrack provides flight lookup and [CLIENT MUST DESCRIBE THE USER-FACING PURPOSE THAT REQUIRES ACTIVE-DOMAIN RECORDS]. Active-domain collection must not be used for advertising, user profiling, resale, or any undisclosed purpose.

## Information transmitted after consent

Active-domain sharing is off until the user affirmatively enables it. When enabled, AeroTrack transmits:

- a random identifier generated for that extension installation;
- the hostname/domain of the active HTTP or HTTPS website, such as `example.com`; and
- the time the AeroTrack server receives the record.

Authorized service administrators may access these records only to operate the disclosed active-domain feature.

## Information not transmitted by this feature

AeroTrack does not transmit full URLs, URL paths or query strings, page titles, page content, cookies, search terms, previous browser history, incognito activity, IP addresses as a stored database field, User-Agent strings, or hardware serial/device identifiers.

Flight lookup fields are transmitted only when the user starts a flight search. The Aviationstack credential remains on the backend and is not included in the extension.

## Storage and retention

Active-domain records are stored in a Cloudflare D1 database for 30 days by default and then deleted automatically. [CONFIRM OR REPLACE RETENTION PERIOD.] Local extension storage holds the user's consent choice, random installation ID, the latest observed domain for duplicate prevention, and at most one latest unsent domain for retry.

## Sharing

Data is processed by Cloudflare as the backend infrastructure provider and by Aviationstack only for user-initiated flight requests. Data is not sold, used for personalized advertising, or shared for unrelated purposes.

## Security

Data is transmitted over HTTPS. Raw activity export endpoints require a private administrator token. API credentials are stored as Cloudflare secrets and are not embedded in the browser extension.

## User choices

Users can decline active-domain sharing during onboarding or turn it off later in AeroTrack Settings. Turning it off clears any pending unsent domain from local extension storage. Users may request deletion or ask privacy questions at [PRIVACY EMAIL].

## Chrome Web Store Limited Use disclosure

The use of information received from Chrome APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Changes

If data practices change, AeroTrack will provide a new prominent disclosure and obtain consent before the new collection begins.
