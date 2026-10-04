# REEF API endpoints

Generated from the route registry by `npm run endpoints` in `api/`. Do not edit by hand.

33 endpoints, 33 explained.

| Method | Path | Who may call it | What it is for | What it refuses |
|---|---|---|---|---|
| GET | `/health` | Anyone | Reports that the API process is up. The deploy polls it to know when to stop waiting. | - |
| GET | `/api/v1/me` | Any signed-in user | Returns the signed-in user's id, role and plant, so the web app can choose which screens to show. | A missing, expired or foreign token. |
| GET | `/api/v1/history` | owner, manager | Lists changes to records, newest first, each with who made it, why, and the old and new values. Filter by table and record to show one record's history. | Workers, because history can show pay and personal details. A manager is not refused but sees only changes at their own plant. Also refuses a malformed record id or a page size above 200. |
| GET | `/api/v1/mines` | owner, manager, worker | Lists the sites REEF operates, paged and sorted. Every role reads it to pick a site on capture forms. | - |
| GET | `/api/v1/mines/:id` | owner, manager, worker | Returns one site. | - |
| POST | `/api/v1/mines` | owner, manager | Adds a site. Owners and managers only, because a site carries the cost-per-ton target. | - |
| PATCH | `/api/v1/mines/:id` | owner, manager | Changes a site's details or its cost-per-ton target. | - |
| DELETE | `/api/v1/mines/:id` | owner, manager | Deletes a site. Its production logs go with it; equipment and staff are unlinked, not deleted. | - |
| GET | `/api/v1/suppliers` | owner, manager | Lists the vendors REEF buys stock from, paged and sorted. Owners and managers only, because a supplier carries contact and cost information. | - |
| GET | `/api/v1/suppliers/:id` | owner, manager | Returns one supplier. | - |
| POST | `/api/v1/suppliers` | owner, manager | Adds a supplier. Owners and managers only. | - |
| PATCH | `/api/v1/suppliers/:id` | owner, manager | Changes a supplier's details. Refuses a save from an out-of-date copy, so nobody overwrites a change they never saw. | - |
| DELETE | `/api/v1/suppliers/:id` | owner, manager | Deletes a supplier. Refuses if a purchase order still points to it. | - |
| GET | `/api/v1/clients` | owner, manager | Lists the companies that contract REEF to operate at their mines, paged and sorted. Owners and managers only, because a client carries contract and revenue information. | - |
| GET | `/api/v1/clients/:id` | owner, manager | Returns one client. | - |
| POST | `/api/v1/clients` | owner, manager | Adds a client. Owners and managers only. | - |
| PATCH | `/api/v1/clients/:id` | owner, manager | Changes a client's details or contract. Refuses a save from an out-of-date copy, so nobody overwrites a change they never saw. | - |
| DELETE | `/api/v1/clients/:id` | owner, manager | Deletes a client. Refuses if a mine still points to it. | - |
| GET | `/api/v1/stock` | owner, manager, worker | Lists stock items for the caller's plant. An owner sees every plant; everyone else sees only their own. | - |
| GET | `/api/v1/stock/:id` | owner, manager, worker | Returns one stock item, or 404 if it belongs to another plant. | - |
| POST | `/api/v1/stock` | owner, manager | Adds a stock item. The plant is taken from the caller, except for an owner, who may set it. | - |
| PATCH | `/api/v1/stock/:id` | owner, manager | Changes a stock item's details or its levels. Refuses a save from an out-of-date copy. | - |
| DELETE | `/api/v1/stock/:id` | owner, manager | Deletes a stock item. Refuses if the caller cannot see it. | - |
| GET | `/api/v1/stock-levels` | owner, manager, worker | Lists per-plant stock levels. An owner sees every plant; everyone else sees only their own. | - |
| GET | `/api/v1/stock-levels/:id` | owner, manager, worker | Returns one stock level, or 404 if it belongs to another plant. | - |
| POST | `/api/v1/stock-levels` | owner, manager | Adds a stock level. The plant is taken from the caller, except for an owner, who may set it. | - |
| PATCH | `/api/v1/stock-levels/:id` | owner, manager | Changes a stock level. Refuses a save from an out-of-date copy, so nobody overwrites a change they never saw. | - |
| DELETE | `/api/v1/stock-levels/:id` | owner, manager | Deletes a stock level. Refuses if the caller cannot see it. | - |
| GET | `/api/v1/purchase-orders` | owner, manager | Lists purchase orders for the caller's plant. Owners and managers only — a worker cannot place orders. | - |
| GET | `/api/v1/purchase-orders/:id` | owner, manager | Returns one purchase order, or 404 if it belongs to another plant. | - |
| POST | `/api/v1/purchase-orders` | owner, manager | Adds a purchase order. Managers and owners only. | - |
| PATCH | `/api/v1/purchase-orders/:id` | owner, manager | Changes a purchase order's status or details. Refuses a save from an out-of-date copy. | - |
| DELETE | `/api/v1/purchase-orders/:id` | owner, manager | Deletes a purchase order. Refuses if the caller cannot see it. | - |
