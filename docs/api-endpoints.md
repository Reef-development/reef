# REEF API endpoints

Generated from the route registry by `npm run endpoints` in `api/`. Do not edit by hand.

12 endpoints, 12 explained.

| Method | Path | Who may call it | What it is for | What it refuses |
|---|---|---|---|---|
| GET | `/health` | Anyone | Reports that the API process is up. The deploy polls it to know when to stop waiting. | - |
| GET | `/api/v1/me` | Any signed-in user | Returns the signed-in user's id and role, so the web app can choose which screens to show. | A missing, expired or foreign token. |
| GET | `/api/v1/analytics/cost-per-ton` | owner, manager | Cost per ton for one site over a period, with fixed and variable costs kept apart so a rise can be attributed rather than only noticed. | A period without both dates, or one that runs backwards. A site the caller may not see answers 404 rather than 403, because 403 would confirm it exists. A period with no production returns null rather than 0: a site that produced nothing is not the cheapest site. |
| GET | `/api/v1/analytics/comparison` | owner | Every site the caller may see, ranked by cost per ton, cheapest first. The owner's view of which plant is running expensively. | A manager, who sees their own sites' figures but not the ranking: that would tell them how another manager's site is doing. Sites with no production sort last, not first, because they have no cost per ton at all. |
| GET | `/api/v1/analytics/production-trend` | owner, manager | Tons produced per day for one site, which is the series behind the production chart. | The same period and site rules as cost per ton. A day with no shift recorded is absent from the series rather than present as a zero, because zero means nothing was produced and absent means nobody captured anything. |
| GET | `/api/v1/reports/monthly` | owner, manager | The month-end report for one site: cost per ton with its parts, production day by day, downtime by cause, and a short narrative written from those figures. | A month that is not YYYY-MM, and a site the caller may not see. The narrative is built from the figures in the same response and contains no number that is not in them, so the two can never disagree. |
| POST | `/api/v1/assistant/ask` | owner, manager | Answers a plain-language question about cost per ton, production, downtime or how sites compare, from the records only. | A manager asking to compare sites, for the same reason the comparison endpoint refuses them. Every number in the written answer is checked against the figures it was built from: one that is not there means the sentence is discarded and the figures are listed plainly, with the reader told that happened. |
| GET | `/api/v1/mines` | owner, manager, worker | Lists the sites REEF operates, paged and sorted. Every role reads it to pick a site on capture forms. | An unknown sort column or a page size above 200. |
| GET | `/api/v1/mines/:id` | owner, manager, worker | Returns one site. | An id that is not a UUID, or a record that does not exist. |
| POST | `/api/v1/mines` | owner, manager | Adds a site. Owners and managers only, because a site carries the cost-per-ton target. | Missing or invalid fields, and any field it does not recognise. |
| PATCH | `/api/v1/mines/:id` | owner, manager | Changes a site's details or its cost-per-ton target. | Invalid or unrecognised fields, a missing version, or a version older than the stored one. The last means someone else saved first: it answers 409 with their copy, so nobody overwrites a change they never saw. |
| DELETE | `/api/v1/mines/:id` | owner, manager | Deletes a site. Its production logs go with it; equipment and staff are unlinked, not deleted. | A record that does not exist, or one that other records still point to. |
