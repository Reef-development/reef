# REEF API endpoints

Generated from the route registry by `npm run endpoints` in `api/`. Do not edit by hand.

28 endpoints, 28 explained.

| Method | Path | Who may call it | What it is for | What it refuses |
|---|---|---|---|---|
| GET | `/health` | Anyone | Reports that the API process is up. The deploy polls it to know when to stop waiting. | - |
| GET | `/api/v1/me` | Any signed-in user | Returns the signed-in user's id and role, so the web app can choose which screens to show. | A missing, expired or foreign token. |
| GET | `/api/v1/mines` | owner, manager, worker | Lists the sites REEF operates, paged and sorted. Every role reads it to pick a site on capture forms. | An unknown sort column or a page size above 200. |
| GET | `/api/v1/mines/:id` | owner, manager, worker | Returns one site. | An id that is not a UUID, or a record that does not exist. |
| POST | `/api/v1/mines` | owner, manager | Adds a site. Owners and managers only, because a site carries the cost-per-ton target. | Missing or invalid fields, and any field it does not recognise. |
| PATCH | `/api/v1/mines/:id` | owner, manager | Changes a site's details or its cost-per-ton target. | Invalid or unrecognised fields, a missing version, or a version older than the stored one. The last means someone else saved first: it answers 409 with their copy, so nobody overwrites a change they never saw. |
| DELETE | `/api/v1/mines/:id` | owner, manager | Deletes a site. Its production logs go with it; equipment and staff are unlinked, not deleted. | A record that does not exist, or one that other records still point to. |
| GET | `/api/v1/production-logs` | owner, manager, worker | Lists tonnage captured per site and shift, newest first by default. Feeds the cost-per-ton figures. | An unknown sort column or a page size above 200. |
| GET | `/api/v1/production-logs/:id` | owner, manager, worker | Returns one production entry. | An id that is not a UUID, or a record that does not exist. |
| POST | `/api/v1/production-logs` | owner, manager, worker | Captures tons produced for a site. Every role may capture, because workers record output on the plant. | Missing or invalid fields, and any field it does not recognise. A negative tonnage or a site id that is not a UUID. |
| PATCH | `/api/v1/production-logs/:id` | owner, manager | Corrects a production entry. Managers and owners only, because it changes cost per ton after the fact. | Invalid or unrecognised fields, a missing version, or a version older than the stored one. The last means someone else saved first: it answers 409 with their copy, so nobody overwrites a change they never saw. |
| DELETE | `/api/v1/production-logs/:id` | owner, manager | Deletes a production entry captured in error. Managers and owners only. | A record that does not exist, or one that other records still point to. |
| GET | `/api/v1/fuel-slips` | owner, manager, worker | Lists fuel slips, newest first by default. | An unknown sort column or a page size above 200. |
| GET | `/api/v1/fuel-slips/:id` | owner, manager, worker | Returns one fuel slip. | An id that is not a UUID, or a record that does not exist. |
| POST | `/api/v1/fuel-slips` | owner, manager, worker | Captures a fuel slip. The database works out the total from litres and price, so a total sent by the client is refused rather than trusted. | Missing or invalid fields, and any field it does not recognise. Zero litres, a total_cost field, a photo path this system did not issue, or neither a vehicle nor a label. |
| PATCH | `/api/v1/fuel-slips/:id` | owner, manager | Corrects a fuel slip; the total is recalculated. Managers and owners only. | Invalid or unrecognised fields, a missing version, or a version older than the stored one. The last means someone else saved first: it answers 409 with their copy, so nobody overwrites a change they never saw. |
| DELETE | `/api/v1/fuel-slips/:id` | owner | Deletes a fuel slip. Owners only, because slips are evidence for fuel spend. | A record that does not exist, or one that other records still point to. |
| GET | `/api/v1/maintenance-logs` | owner, manager, worker | Lists repairs, newest first by default, with labour, parts and total cost. | An unknown sort column or a page size above 200. |
| GET | `/api/v1/maintenance-logs/:id` | owner, manager, worker | Returns one repair. | An id that is not a UUID, or a record that does not exist. |
| POST | `/api/v1/maintenance-logs` | owner, manager, worker | Logs a repair and the parts it used in one step: either all of it is saved or none. Stock comes off, a reorder is drafted if an item runs low, and the caller is recorded as the person who logged it. | Missing or invalid fields, and any field it does not recognise. A missing description or equipment, a cost field (costs are worked out from labour and parts), or more than 50 parts. |
| PATCH | `/api/v1/maintenance-logs/:id` | owner, manager | Corrects a repair's details. Parts change through their own endpoints. Managers and owners only. | Invalid or unrecognised fields, a missing version, or a version older than the stored one. The last means someone else saved first: it answers 409 with their copy, so nobody overwrites a change they never saw. |
| DELETE | `/api/v1/maintenance-logs/:id` | owner, manager | Deletes a repair logged in error. Managers and owners only. | A record that does not exist, or one that other records still point to. |
| GET | `/api/v1/maintenance-logs/:id/parts` | owner, manager, worker | Lists the parts a repair used, with each stock item's name and unit. | An id that is not a UUID. |
| POST | `/api/v1/maintenance-logs/:id/parts` | owner, manager | Adds a part to a repair already logged. Stock comes off and the repair's cost goes up. | A zero quantity, or a repair or stock item that does not exist. Managers and owners only. |
| DELETE | `/api/v1/maintenance-parts/:id` | owner, manager | Removes a part logged against a repair in error. It goes back on the shelf and off the repair's cost. | A part that does not exist. Managers and owners only. |
| POST | `/api/v1/stock-usage` | owner, manager, worker | Records stock used on the plant. The quantity comes off in one database step, so two people recording at once both count, and a reorder is drafted if the item falls to its reorder point. | A zero or negative quantity, or a stock item that does not exist. |
| POST | `/api/v1/photos/upload-url` | owner, manager, worker | Issues a one-time link for uploading a repair, fuel or downtime photo. The API chooses the file name, under the caller's own folder, so nobody can overwrite another person's photo. | Anything other than a JPEG, PNG or WebP image, or an unknown folder. |
| GET | `/api/v1/photos/view` | owner, manager, worker | Returns a link to view a stored photo for one hour. | A path this system did not issue, or a photo the caller may not see: workers see their own, managers and owners see all. |
