// scripts/seed-perf.mjs
//
// Fills the dev database with realistic REEF data so the T21 report queries
// can be benchmarked against a table the size REEF actually has after three
// years of operation.
//
// production_logs is logged per pit per shift per day. REEF runs five areas
// per mine (two pits, a wash plant, a DMS plant and a magnetite plant) across
// three shifts, 365 days a year. Three mines over three years gives ~49,000
// rows, which is the scale the reports have to stay fast at.
//
// Reads DATABASE_URL from .env. Refuses to run unless the URL points at the
// dev project reference below. This is not optional: the script fills the
// database with fake test data, and it must never touch production.
//
// Usage:
//   node scripts/seed-perf.mjs
//   node scripts/seed-perf.mjs --clean      (truncate the six tables first)

import { readFileSync } from "node:fs";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// ---------- args ----------

const args = process.argv.slice(2);
const flagClean = args.includes("--clean");

// ---------- env ----------

function loadEnv() {
  try {
    const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // .env is optional if the vars are already exported
  }
}

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env or export it.");
  process.exit(1);
}

const DEV_PROJECT_REF = "zhvbzrnexyajqggkjajv";
if (!url.includes(DEV_PROJECT_REF)) {
  console.error(
    `Refusing to run: DATABASE_URL does not point at the dev project (${DEV_PROJECT_REF}).`,
  );
  console.error("This script seeds test data. It must not touch production.");
  process.exit(1);
}

// ---------- data model ----------

const MINES = [
  { name: "Kangala Colliery", location: "Mpumalanga" },
  { name: "Rietfontein Mine", location: "Mpumalanga" },
  { name: "Klipspruit Colliery", location: "Mpumalanga" },
];

// The five production areas a REEF mine runs. Each logs its own tonnage per
// shift. Two pits, a wash plant, a dense-medium separation plant, and a
// magnetite plant.
const PITS = ["North pit", "South pit", "Wash plant", "DMS plant", "Magnetite plant"];

const EQUIPMENT_TYPES = [
  "Haul truck",
  "Loader",
  "Conveyor",
  "Pump",
  "Drill rig",
  "Crusher",
];

const MAINTENANCE_DESCRIPTIONS = [
  "Scheduled 250-hour service",
  "Hydraulic hose replacement",
  "Bearing inspection and repack",
  "Engine oil and filter change",
  "Conveyor belt splice repair",
  "Pump seal replacement",
  "Tyre rotation and pressure check",
  "Electrical fault diagnosis",
  "Gearbox oil top-up",
  "Brake system overhaul",
  "Coolant flush",
  "Wear plate replacement",
];

const STATIC_CATEGORIES = ["Rent", "Insurance", "Salaries", "Utilities"];

const SHIFTS = ["morning", "midday", "night"];

const FIRST_NAMES = ["Sipho", "Thabo", "Andile", "Bongani", "Lerato", "Naledi", "Pieter", "Johan", "Riaan", "Elsabe"];
const LAST_NAMES = ["Mokoena", "Ndlovu", "Botha", "Van der Merwe", "Khumalo", "Dlamini", "Pretorius", "Nel"];

// ---------- helpers ----------

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max, decimals = 2) {
  const v = Math.random() * (max - min) + min;
  return Number(v.toFixed(decimals));
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Insert in batches. The client is a raw pg connection so the caller is the
// postgres user; RLS is bypassed, which is what we want for a seed script.
async function insertBatch(client, table, columns, rows, batchSize = 500) {
  const total = rows.length;
  let done = 0;
  for (let i = 0; i < total; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const values = [];
    const placeholders = slice.map((row, r) => {
      const rowPlaceholders = columns.map((_, c) => `$${r * columns.length + c + 1}`);
      values.push(...columns.map((col) => row[col]));
      return `(${rowPlaceholders.join(", ")})`;
    });
    const sql = `insert into public.${table} (${columns.join(", ")}) values ${placeholders.join(", ")}`;
    await client.query(sql, values);
    done += slice.length;
    process.stdout.write(`\r${table}: ${done} / ${total}`);
  }
  process.stdout.write("\n");
}

// ---------- main ----------

async function main() {
  const client = new Client({ connectionString: url });
  await client.connect();
  console.log("Connected to the database.\n");

  if (flagClean) {
    console.log("Truncating the six tables first.");
    await client.query("truncate public.maintenance_logs, public.production_logs, public.static_costs, public.equipment, public.employees, public.mines cascade");
  }

  const now = new Date();

  // ---- mines ----
  console.log("Seeding mines.");
  const mineRows = MINES.map((m) => ({
    id: randomUUID(),
    name: m.name,
    location: m.location,
    team_name: null,
    target_cost_per_ton: randFloat(140, 200),
    active: true,
  }));
  await insertBatch(client, "mines", ["id", "name", "location", "team_name", "target_cost_per_ton", "active"], mineRows);

  // ---- equipment ----
  console.log("Seeding equipment.");
  const equipmentPerMine = 7;
  const equipmentRows = [];
  for (const mine of mineRows) {
    for (let i = 0; i < equipmentPerMine; i++) {
      const type = pick(EQUIPMENT_TYPES);
      equipmentRows.push({
        id: randomUUID(),
        mine_id: mine.id,
        name: `${type} ${String(i + 1).padStart(2, "0")}`,
        type,
        install_date: isoDate(daysAgo(randInt(30, 1000))),
        expected_life_tons: randInt(50_000, 500_000),
        expected_life_hours: randInt(5_000, 30_000),
        tons_since_install: randInt(0, 40_000),
        hours_since_install: randInt(0, 4_000),
        service_interval_tons: randInt(500, 2_000),
        service_interval_days: randInt(30, 120),
        replacement_cost: randFloat(500_000, 15_000_000, 0),
        status: "operational",
      });
    }
  }
  await insertBatch(
    client,
    "equipment",
    [
      "id", "mine_id", "name", "type", "install_date",
      "expected_life_tons", "expected_life_hours",
      "tons_since_install", "hours_since_install",
      "service_interval_tons", "service_interval_days",
      "replacement_cost", "status",
    ],
    equipmentRows,
  );

  // ---- employees ----
  console.log("Seeding employees.");
  const employeesPerMine = 20;
  const employeeRows = [];
  let employeeNo = 1000;
  for (const mine of mineRows) {
    for (let i = 0; i < employeesPerMine; i++) {
      employeeNo += 1;
      employeeRows.push({
        id: randomUUID(),
        full_name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
        employee_no: `E${employeeNo}`,
        position: pick(["Operator", "Driver", "Fitter", "Electrician", "Supervisor", "General worker"]),
        phone: `+27${randInt(60, 84)}${randInt(1000000, 9999999)}`,
        id_number: null,
        hire_date: isoDate(daysAgo(randInt(30, 2000))),
        mine_id: mine.id,
        shift: pick(SHIFTS),
        team_name: `Team ${String.fromCharCode(65 + (i % 6))}`,
        hourly_rate: randFloat(120, 450, 2),
        active: true,
      });
    }
  }
  await insertBatch(
    client,
    "employees",
    [
      "id", "full_name", "employee_no", "position", "phone", "id_number",
      "hire_date", "mine_id", "shift", "team_name", "hourly_rate", "active",
    ],
    employeeRows,
  );

  // ---- production_logs ----
  // One row per mine per pit per shift per day, for three years. That is
  // 3 mines x 5 pits x 3 shifts x 1095 days = ~49,275 rows. The pit name is
  // written into notes so a report can break down by area if it wants to.
  console.log("Seeding production_logs (this one takes a moment).");
  const productionRows = [];
  const daysBack = 1095;
  for (const mine of mineRows) {
    for (let d = 0; d < daysBack; d++) {
      const date = isoDate(daysAgo(d));
      for (const pit of PITS) {
        for (const _shift of SHIFTS) {
          // A single shift at a single pit moves a much smaller tonnage than
          // the whole mine does. Roughly 30 to 200 tonnes per pit per shift.
          const tons = randFloat(30, 200);
          const magUsed = randFloat(0.3, 2.5);
          const magCost = Number((magUsed * randFloat(1800, 2600)).toFixed(2));
          const otHours = randFloat(0, 1.5);
          const otCost = Number((otHours * randFloat(300, 600)).toFixed(2));
          productionRows.push({
            id: randomUUID(),
            mine_id: mine.id,
            date,
            tons_produced: tons,
            magnetite_used: magUsed,
            magnetite_cost: magCost,
            overtime_hours: otHours,
            overtime_cost: otCost,
            notes: pit,
          });
        }
      }
    }
  }
  await insertBatch(
    client,
    "production_logs",
    [
      "id", "mine_id", "date", "tons_produced", "magnetite_used",
      "magnetite_cost", "overtime_hours", "overtime_cost", "notes",
    ],
    productionRows,
  );

  // ---- maintenance_logs ----
  console.log("Seeding maintenance_logs.");
  const maintenanceRows = [];
  for (const eq of equipmentRows) {
    for (let m = 0; m < 36; m++) {
      const days = m * 30 + randInt(0, 25);
      const labourHours = randFloat(1, 12);
      const labourCost = Number((labourHours * randFloat(250, 500)).toFixed(2));
      const partsCost = randFloat(500, 40_000);
      const downtimeHours = randFloat(0.5, 20);
      maintenanceRows.push({
        id: randomUUID(),
        equipment_id: eq.id,
        date: isoDate(daysAgo(days)),
        description: pick(MAINTENANCE_DESCRIPTIONS),
        labour_hours: labourHours,
        labour_cost: labourCost,
        parts_cost: partsCost,
        total_cost: Number((labourCost + partsCost).toFixed(2)),
        downtime_hours: downtimeHours,
        next_due_date: isoDate(daysAgo(days - 30)),
        next_due_tons: null,
        performed_by: pick(["In-house", "Vendor A", "Vendor B"]),
        photo_urls: [],
      });
    }
  }
  await insertBatch(
    client,
    "maintenance_logs",
    [
      "id", "equipment_id", "date", "description", "labour_hours",
      "labour_cost", "parts_cost", "total_cost", "downtime_hours",
      "next_due_date", "next_due_tons", "performed_by", "photo_urls",
    ],
    maintenanceRows,
  );

  // ---- static_costs ----
  console.log("Seeding static_costs.");
  const staticRows = [];
  for (const mine of mineRows) {
    for (let m = 0; m < 36; m++) {
      const month = new Date(now.getUTCFullYear(), now.getUTCMonth() - m, 1);
      for (const category of STATIC_CATEGORIES) {
        staticRows.push({
          id: randomUUID(),
          mine_id: mine.id,
          month: isoDate(month),
          category,
          amount: randFloat(20_000, 400_000),
          notes: null,
        });
      }
    }
  }
  await insertBatch(
    client,
    "static_costs",
    ["id", "mine_id", "month", "category", "amount", "notes"],
    staticRows,
  );

  // ---- summary ----
  console.log("\nDone. Row counts:");
  const summary = await client.query(`
    select 'mines' as t, count(*)::int as n from public.mines
    union all select 'equipment', count(*)::int from public.equipment
    union all select 'employees', count(*)::int from public.employees
    union all select 'production_logs', count(*)::int from public.production_logs
    union all select 'maintenance_logs', count(*)::int from public.maintenance_logs
    union all select 'static_costs', count(*)::int from public.static_costs
    order by t
  `);
  for (const row of summary.rows) console.log(`  ${row.t.padEnd(20)} ${row.n}`);

  await client.end();
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message);
  process.exit(1);
});