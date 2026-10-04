# REEF API endpoints

Generated from the route registry by `npm run endpoints` in `api/`. Do not edit by hand.

12 endpoints, 12 explained.

| Method | Path | Who may call it | What it is for | What it refuses |
|---|---|---|---|---|
| GET | `/health` | Anyone | Reports that the API process is up. The deploy polls it to know when to stop waiting. | - |
| GET | `/api/v1/me` | Any signed-in user | Returns the signed-in user's id and role, so the web app can choose which screens to show. | A missing, expired or foreign token. |
| GET | `/api/v1/sessions` | Any signed-in user | Lists the signed-in user's active sign-ins, including device, address and last use. | A missing, expired, foreign or revoked token. |
| GET | `/api/v1/users/:userId/sessions` | owner | Lets an owner view another user's active sign-ins, including device, address and last use. | A user id that is not a UUID, or a caller who is not an owner. |
| DELETE | `/api/v1/sessions/:sessionId` | owner | Lets an owner cut off one active sign-in. | A session id that is not a UUID, a session that does not exist or is already revoked, or a caller who is not an owner. |
| DELETE | `/api/v1/users/:userId/sessions` | owner | Lets an owner cut off all active sign-ins belonging to one user. | A user id that is not a UUID, or a caller who is not an owner. |
| GET | `/api/v1/history` | owner, manager | Lists changes to records, newest first, each with who made it, why, and the old and new values. Filter by table and record to show one record's history. | Workers, because history can show pay and personal details. A manager is not refused but sees only changes at their own plant. Also refuses a malformed record id or a page size above 200. |
| GET | `/api/v1/mines` | owner, manager, worker | Lists the sites REEF operates, paged and sorted. Every role reads it to pick a site on capture forms. | An unknown sort column or a page size above 200. |
| GET | `/api/v1/mines/:id` | owner, manager, worker | Returns one site. | An id that is not a UUID, or a record that does not exist. |
| POST | `/api/v1/mines` | owner, manager | Adds a site. Owners and managers only, because a site carries the cost-per-ton target. | Missing or invalid fields, and any field it does not recognise. |
| PATCH | `/api/v1/mines/:id` | owner, manager | Changes a site's details or its cost-per-ton target. | Invalid or unrecognised fields, a missing version, a missing reason, or a version older than the stored one. The last means someone else saved first: it answers 409 with their copy, so nobody overwrites a change they never saw. |
| DELETE | `/api/v1/mines/:id` | owner, manager | Deletes a site. Its production logs go with it; equipment and staff are unlinked, not deleted. | A record that does not exist, or one that other records still point to. |
