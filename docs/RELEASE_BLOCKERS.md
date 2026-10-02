# Release blockers requiring client input

The code can be tested locally now. Public deployment and store submission require these client-owned items:

1. Cloudflare account access to create the D1 database and deploy the Worker.
2. A hosted HTTPS privacy-policy URL with the client's legal name and privacy contact.
3. A hosted HTTPS support URL.
4. A clear user-facing purpose explaining why active-domain records are necessary to the extension's primary feature.
5. Written confirmation that authorized administrators may view these records only for that disclosed purpose.
6. Confirmation of the record retention period (the build defaults to 30 days).
7. Store publisher accounts and final extension IDs, so CORS and host permissions can be narrowed.

“For our server records” alone is not a sufficient public-store purpose. Chrome limits browsing-activity collection to a prominently disclosed user-facing feature, and Firefox permits browsing-activity transmission only as part of the add-on's primary function.
