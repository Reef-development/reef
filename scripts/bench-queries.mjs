// scripts/bench-queries.mjs
//
// Runs the T21 queries with EXPLAIN (ANALYZE, BUFFERS) and prints the plan and
// the timing. Run before and after adding indexes to get the T21 evidence.
//
// Usage:
//   node scripts/bench-queries.mjs                (uses the .env DATABASE_URL)
//   node scripts/bench-queries.mjs before
//   node scripts/bench-queries.mjs after

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { Client } from "pg";

function loadEnv() {
  try {
    const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const label = process.argv[2] ?? "baseline";

const QUERIES = [
  {
    name: "recent-production",
    comment: "Dashboard: production for the current month, newest first.",
    sql: `
      select *
      from public.production_logs
      where date >= date_trunc('month', current_date)
      order by date desc
      limit 100
    `,
  },
  {
    name: "per-mine-recent",
    comment: "Analytics: recent production for one mine.",
    sql: `
      select *
      from public.production_logs
      where mine_id = (select id from public.mines order by name limit 1)
        and date >= current_date - interval '30 days'
      order by date desc
      limit 100
    `,
  },
  {
    name: "site-comparison",
    comment: "Site comparison: tonnage and cost per mine, last twelve months.",
    sql: `
      select
        mine_id,
        sum(tons_produced)::numeric as tons,
        sum(magnetite_cost)::numeric as magnetite_cost,
        sum(overtime_cost)::numeric as overtime_cost,
        count(*)::int as rows_counted
      from public.production_logs
      where date >= current_date - interval '12 months'
      group by mine_id
      order by tons desc
    `,
  },
];

async function main() {
  const client = new Client({ connectionString: url });
  await client.connect();

  const results = [];

  for (const q of QUERIES) {
    // Warm the cache with one non-analysed run.
    await client.query(q.sql);

    // Then the measured run.
    const plan = await client.query(`explain (analyze, buffers, format text) ${q.sql}`);
    const planText = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");

    const timingMatch = planText.match(/Execution Time: ([\d.]+) ms/);
    const planningMatch = planText.match(/Planning Time: ([\d.]+) ms/);
    const timing = timingMatch ? Number(timingMatch[1]) : null;
    const planning = planningMatch ? Number(planningMatch[1]) : null;

    results.push({ name: q.name, comment: q.comment, timing, planning, planText });

    console.log(`\n=== ${q.name} ===`);
    console.log(q.comment);
    console.log(`Planning: ${planning} ms   Execution: ${timing} ms`);
    console.log(planText);
  }

  // Save the raw plans so we have the before/after evidence.
  if (!existsSync("docs")) mkdirSync("docs");
  writeFileSync(
    `docs/t21-bench-${label}.txt`,
    results
      .map(
        (r) =>
          `=== ${r.name} ===\n${r.comment}\nPlanning: ${r.planning} ms   Execution: ${r.timing} ms\n\n${r.planText}\n`,
      )
      .join("\n\n"),
  );
  console.log(`\nSaved docs/t21-bench-${label}.txt`);

  // A one-line summary so the numbers are easy to compare.
  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`${r.name.padEnd(20)} ${r.timing} ms`);
  }

  await client.end();
}

main().catch((err) => {
  console.error("\nBenchmark failed:", err.message);
  process.exit(1);
});