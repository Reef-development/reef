import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterEach, describe, expect, it } from "vitest";
import { SmtpMailer } from "../src/services/email.js";
import { runSweepFor } from "../src/services/scheduler.js";
import type { Machine } from "../src/services/service-due.js";
import { sweep } from "../src/services/sweep.js";
import { MemoryJobs, MemorySweep } from "./fakes.js";

// T17: the reminder emails, sent to a pretend mail server that runs inside the test. The real
// SmtpMailer talks real SMTP to it over the loopback address, so nothing leaves the machine
// and nothing in the sending code is replaced with a stand-in.

type Received = { from: string; to: string[]; data: string };

let server: SMTPServer | null = null;

/** Starts a mail server on a free local port. `refuse` makes it reject every message. */
async function mailServer(opts: { refuse?: string } = {}) {
  const received: Received[] = [];
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["AUTH", "STARTTLS"],
    logger: false,
    onRcptTo(address, _session, callback) {
      if (opts.refuse) {
        const err = new Error(opts.refuse) as Error & { responseCode: number };
        err.responseCode = 550;
        return callback(err);
      }
      callback();
    },
    onData(stream, session, callback) {
      let data = "";
      stream.on("data", (chunk: Buffer) => (data += chunk.toString()));
      stream.on("end", () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((r) => r.address),
          data,
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.server.address() as AddressInfo;
  const mailer = new SmtpMailer(`smtp://127.0.0.1:${port}`, "REEF <no-reply@reef.test>");
  return { received, mail: { mailer, link: "https://reef.test/maintenance" } };
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

const OWNER = "owner-id";
const MANAGER = "manager-id";

/** One machine that is overdue, at a site with an owner and that site's manager. */
function overdueSite() {
  const repo = new MemorySweep();
  const mine = randomUUID();
  const machine: Machine = {
    id: randomUUID(),
    name: "Wash plant pump",
    mine_id: mine,
    status: "active",
    install_date: "2026-01-01",
    tons_since_install: 0,
    service_interval_days: 90,
    service_interval_tons: null,
    next_due_date: "2026-09-30",
    next_due_tons: null,
    last_serviced_on: null,
  };
  repo.rows = [machine];
  repo.owners = [OWNER];
  repo.plantOfMine = { [mine]: "Kriel" };
  repo.managers = { Kriel: [MANAGER] };
  repo.emails = { [OWNER]: "dave@reef.test", [MANAGER]: "kriel.manager@reef.test" };
  return repo;
}

describe("T17: reminder emails, against a mail server running inside the test", () => {
  it("sends each reminder to the person it is for, and only to them", async () => {
    const { received, mail } = await mailServer();
    const repo = overdueSite();

    const result = await sweep(repo, "2026-10-05", mail);

    expect(result.emailed).toBe(2);
    expect(received.map((r) => r.to)).toEqual([["dave@reef.test"], ["kriel.manager@reef.test"]]);
    expect(received[0].from).toBe("no-reply@reef.test");
    // The message itself names the machine and carries the plain text version.
    expect(received[0].data).toContain("Wash plant pump");
    expect(received[0].data).toContain("text/plain");
    expect(received[0].data).toContain("https://reef.test/maintenance");
  });

  it("sends a standing warning once, not once per sweep", async () => {
    const { received, mail } = await mailServer();
    const repo = overdueSite();

    // The machine stays overdue for three days; each day's sweep sees it again.
    await sweep(repo, "2026-10-05", mail);
    const second = await sweep(repo, "2026-10-06", mail);
    const third = await sweep(repo, "2026-10-07", mail);

    expect(received).toHaveLength(2);
    expect(second.emailed).toBe(0);
    expect(third.emailed).toBe(0);
    expect(repo.delivery.every((d) => d.emailed_at !== null)).toBe(true);
  });

  it("records a refused email against the notification, and the sweep still succeeds", async () => {
    const { received, mail } = await mailServer({ refuse: "Mailbox unavailable" });
    const repo = overdueSite();
    const jobs = new MemoryJobs();

    const ran = await runSweepFor({ jobs, sweepRepo: repo, zone: "UTC", mail }, "2026-10-05");

    // The sweep did its job: the run is recorded as ok and the reminders exist in the app.
    expect(ran).toBe(true);
    const [run] = await jobs.runs("service_due_sweep", "2026-10-05", "2026-10-05");
    expect(run.outcome).toBe("ok");
    expect(run.detail).toContain("2 emails failed");
    expect(repo.raised).toHaveLength(2);

    // Nothing was delivered, and each notification says why.
    expect(received).toHaveLength(0);
    for (const d of repo.delivery) {
      expect(d.emailed_at).toBeNull();
      expect(d.email_error).toContain("Mailbox unavailable");
    }
  });

  it("tries a failed email again on the next sweep once the mail server is back", async () => {
    const down = await mailServer({ refuse: "Try again later" });
    const repo = overdueSite();
    await sweep(repo, "2026-10-05", down.mail);
    await new Promise<void>((resolve) => server!.close(() => resolve()));

    const up = await mailServer();
    const result = await sweep(repo, "2026-10-06", up.mail);

    expect(result.emailed).toBe(2);
    expect(up.received).toHaveLength(2);
    expect(repo.delivery.every((d) => d.emailed_at !== null && d.email_error === null)).toBe(true);
  });

  it("raises reminders without emailing when no mail server is configured", async () => {
    const repo = overdueSite();
    const result = await sweep(repo, "2026-10-05");
    expect(result.raised).toBe(2);
    expect(result.emailed).toBe(0);
    expect(repo.delivery.every((d) => d.emailed_at === null)).toBe(true);
  });
});
