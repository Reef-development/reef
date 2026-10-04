import { describe, expect, it } from "vitest";
import { LoggingMailer, renderServiceDue } from "../src/services/email.js";
import { serviceDue, type Machine } from "../src/services/service-due.js";

const LINK = "https://reef.example.com/maintenance";

function due() {
  const m: Machine = {
    id: "m1",
    name: "Screen deck",
    mine_id: null,
    status: "active",
    install_date: "2026-01-01",
    tons_since_install: 0,
    service_interval_days: null,
    service_interval_tons: null,
    next_due_date: "2026-09-30",
    next_due_tons: null,
    last_serviced_on: null,
  };
  return serviceDue(m, "2026-10-04")!;
}

describe("the reminder email", () => {
  it("always carries a plain text version", () => {
    // A phone that refuses the HTML still has to show something a person can act on.
    const email = renderServiceDue(due(), LINK);
    expect(email.text).toContain("Screen deck");
    expect(email.text).toContain(LINK);
  });

  it("uses nothing Outlook cannot render", () => {
    // Outlook renders with Word rather than a browser. Each of these is a thing that silently
    // collapses the layout there, and each has to be absent rather than merely unused.
    const { html } = renderServiceDue(due(), LINK);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/display\s*:\s*(flex|grid)/i);
    expect(html).not.toMatch(/background-image/i);
    expect(html).not.toMatch(/position\s*:\s*(absolute|fixed)/i);
  });

  it("lays out in a table at a width the reading pane keeps", () => {
    const { html } = renderServiceDue(due(), LINK);
    expect(html).toContain("<table");
    expect(html).toContain("width:600px");
    expect(html).toContain("max-width:100%");
  });

  it("escapes what it is given, so a machine name cannot carry markup", () => {
    const d = due();
    d.equipment_name = 'Pump <script>alert("x")</script>';
    const { html, subject } = renderServiceDue(d, LINK);
    expect(subject).toContain("<script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("records what it would have sent when there is no provider", () => {
    // Silence here would mean reminders that were never going to arrive, which is the exact
    // failure this task exists to close.
    const lines: string[] = [];
    const mailer = new LoggingMailer((l) => lines.push(l));
    void mailer.send("owner@example.com", renderServiceDue(due(), LINK));
    expect(mailer.sent).toHaveLength(1);
    expect(lines[0]).toContain("email not sent");
  });
});
