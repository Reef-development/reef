# REEF API endpoints

Generated from the route registry by `npm run endpoints` in `api/`. Do not edit by hand.

12 endpoints, 12 explained.

| Method | Path | Who may call it | What it is for | What it refuses |
|---|---|---|---|---|
| GET | `/health` | Anyone | Reports that the API process is up. The deploy polls it to know when to stop waiting. | - |
| GET | `/api/v1/me` | Any signed-in user | Returns the signed-in user's id, role and plant, so the web app can choose which screens to show. | A missing, expired or foreign token. |
| GET | `/api/v1/mines` | owner, manager, worker | Lists the sites REEF operates, paged and sorted. Every role reads it to pick a site on capture forms. | An unknown sort column or a page size above 200. |
| GET | `/api/v1/mines/:id` | owner, manager, worker | Returns one site. | An id that is not a UUID, or a record that does not exist. |
| POST | `/api/v1/mines` | owner, manager | Adds a site. Owners and managers only, because a site carries the cost-per-ton target. | Missing or invalid fields, and any field it does not recognise. |
| PATCH | `/api/v1/mines/:id` | owner, manager | Changes a site's details or its cost-per-ton target. | Invalid or unrecognised fields, a missing version, or a version older than the stored one. The last means someone else saved first: it answers 409 with their copy, so nobody overwrites a change they never saw. |
| DELETE | `/api/v1/mines/:id` | owner, manager | Deletes a site. Its production logs go with it; equipment and staff are unlinked, not deleted. | A record that does not exist, or one that other records still point to. |
| GET | `/api/v1/stock` | owner, manager, worker | Lists stock items for the caller's plant. An owner sees every plant; everyone else sees only their own. | An unknown sort column or a page size above 200. |
| GET | `/api/v1/stock/:id` | owner, manager, worker | Returns one stock item, or 404 if it belongs to another plant. | An id that is not a UUID, or a record that does not exist. |
| POST | `/api/v1/stock` | owner, manager | Adds a stock item. The plant is taken from the caller, except for an owner, who may set it. | Missing or invalid fields, and any field it does not recognise. |
| PATCH | `/api/v1/stock/:id` | owner, manager | Changes a stock item's details or its levels. Refuses a save from an out-of-date copy. | Invalid or unrecognised fields, a missing version, or a version older than the stored one. The last means someone else saved first: it answers 409 with their copy, so nobody overwrites a change they never saw. |
| DELETE | `/api/v1/stock/:id` | owner, manager | Deletes a stock item. Refuses if the caller cannot see it. | A record that does not exist, or one that other records still point to. |
