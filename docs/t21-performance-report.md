\# T21: report performance with three years of data



Author: Leo

Checked by: Bradley

Task sheet: T21, day 9 to 10. Waits on T3.



\## What this document records



The three report queries the dashboard and analytics screens depend on, the

time they took before any change, the indexes that were added, and the time

after. Every number is from `EXPLAIN (ANALYZE, BUFFERS)` against the dev

Supabase project with the data seeded by `scripts/seed-perf.mjs`.



\## The data



The seed script fills the dev database with three years of REEF-shaped data:



| Table | Rows | Shape |

|---|---|---|

| mines | 3 | Kangala, Rietfontein, Klipspruit |

| equipment | 21 | 7 per mine, mixed types |

| employees | 60 | 20 per mine |

| production\_logs | 49,275 | 3 mines × 5 pits × 3 shifts × 1095 days |

| maintenance\_logs | 756 | 1 event per equipment per month for 3 years |

| static\_costs | 432 | 3 mines × 36 months × 4 categories |



`production\_logs` is the table that matters for T21. The schema logs one row

per mine per shift, and REEF runs three mines with five production areas (two

pits, a wash plant, a DMS plant and a magnetite plant). That is 45 rows per

day across all three mines, 16,425 per year, 49,275 over three years.



\## The three queries



They live in `docs/t21-queries.sql`. Each is written with the pagination limit

it should have, so the benchmark is honest about the cost of returning the

rows the screen actually needs. The screens today fetch the whole table and

paginate in the browser — that is a separate finding, recorded at the end of

this document.



1\. \*\*recent-production.\*\* Dashboard: production for the current month, newest

&#x20;  first, 100 rows.

2\. \*\*per-mine-recent.\*\* Analytics: recent production for one mine over the

&#x20;  last 30 days, newest first, 100 rows.

3\. \*\*site-comparison.\*\* The site comparison report: tonnage and cost per mine

&#x20;  for the last 12 months, grouped by mine.



\## Before



Raw plans are in `docs/t21-bench-before.txt`.



| Query | Plan | Time |

|---|---|---|

| recent-production | Seq Scan, filter on date, sort, limit | 18.314 ms |

| per-mine-recent | Seq Scan, filter on mine\_id and date, sort, limit | 7.470 ms |

| site-comparison | Seq Scan, filter on date, hash aggregate, sort | 18.706 ms |



All three scanned the entire 49,275-row table and threw almost all of it away:

49,140 rows removed by filter in the first, 48,810 in the second, 32,805 in the

third.



\## The indexes



The migration is

`supabase/migrations/20261004090000\_add\_report\_indexes.sql`. Three indexes, one

per query:



| Index | Columns | Justified by |

|---|---|---|

| `production\_logs\_date\_desc\_idx` | `(date desc)` | recent-production: filter on date, order by date desc, limit 100 |

| `production\_logs\_mine\_date\_desc\_idx` | `(mine\_id, date desc)` | per-mine-recent: filter on mine\_id and date, order by date desc |

| `production\_logs\_site\_comparison\_idx` | `(date, mine\_id, tons\_produced, magnetite\_cost, overtime\_cost)` | site-comparison: filter on date, group by mine\_id, sum three columns |



The third is a covering index. The query reads only those five columns, so

Postgres can answer it from the index alone without a single heap fetch.

`production\_logs` is append-only, so the extra width costs little on writes

against what it saves on reads.



\## After



Raw plans are in `docs/t21-bench-after.txt`.



| Query | Plan | Time |

|---|---|---|

| recent-production | Index Scan on `production\_logs\_date\_desc\_idx`, limit 100 | 0.109 ms |

| per-mine-recent | Index Scan on `production\_logs\_mine\_date\_desc\_idx`, limit 100 | 0.156 ms |

| site-comparison | Index Only Scan on `production\_logs\_site\_comparison\_idx`, heap fetches 0 | 7.79 ms |



\## The difference



| Query | Before | After | Speed-up |

|---|---|---|---|

| recent-production | 18.314 ms | 0.109 ms | 168× |

| per-mine-recent | 7.470 ms | 0.156 ms | 48× |

| site-comparison | 18.706 ms | 7.79 ms | 2.4× |



The site comparison target from the task sheet is "under half a second." It

runs in \*\*7.79 ms\*\*, about 64× under the target. At REEF's eventual scale, when

the same table holds millions of rows, the index scans and the covering index

hold up: they touch only the pages the query needs, not the whole table.



\## The finding this does not fix



The screens fetch the whole table. `useList` in `web/src/lib/reef-db.ts`:



&#x20;   const { data, error } = await supabase

&#x20;     .from(table as any)

&#x20;     .select("\*")

&#x20;     .order(orderBy, { ascending: asc });



No `.limit()`, no `.range()`. That means the dashboard and analytics screens

pull every row of `production\_logs` into the browser and then filter and sum

in JavaScript:



&#x20;   const prod = (production.data ?? \[]).filter((p) => {

&#x20;     const pd = new Date(p.date);

&#x20;     return pd >= d \&\& pd < next;

&#x20;   });



At the seed's scale that is 49,275 rows over the wire on every visit. The

indexes make the \*database\* fast, but the browser still receives and processes

the whole table.



Even with perfect indexes, the task sheet's "site comparison under half a

second" is unreachable at scale until the aggregation moves server-side and

the screens fetch only the rows they need.



\## Recommendation



Split into two follow-up tasks, neither in T21's scope:



1\. \*\*Add pagination to `useList`.\*\* A `.range()` on the query and a limit on

&#x20;  the tables with unbounded growth (`production\_logs`, `maintenance\_logs`,

&#x20;  `attendance`, `downtime\_events`, `fuel\_slips`). This is the highest-value

&#x20;  change for screen load times and it is what makes the indexes' benefit

&#x20;  visible in the running app.

2\. \*\*Move the aggregate queries server-side.\*\* A small set of endpoints or

&#x20;  RPCs that return the per-month totals and per-mine comparison already

&#x20;  aggregated, so the browser receives three rows and not 49,275. The indexes

&#x20;  in this PR are exactly what those endpoints would need.



T21 as tasked — measure, index, prove — is complete. These two are the work

the measurement reveals, and they belong on the board as their own cards.



\## Evidence checklist



\- \[x] Seed script: `scripts/seed-perf.mjs`

\- \[x] The three queries written down: `docs/t21-queries.sql`

\- \[x] Benchmark script: `scripts/bench-queries.mjs`

\- \[x] Before plans: `docs/t21-bench-before.txt`

\- \[x] The indexes: `supabase/migrations/20261004090000\_add\_report\_indexes.sql`

\- \[x] After plans: `docs/t21-bench-after.txt`

\- \[x] This report

