# Service reminders: what runs, and how to tell when it stops

Every other figure in this system exists because a person captured it. A machine falling due for
a service is a date passing, and nothing is written when a date passes. So the reminder is the
one thing in the platform that has to happen with nobody asking for it, which means two separate
problems: making it happen, and being able to tell that it stopped.

## What decides that a machine is due

`shared` holds nothing here; the rule is in `api/src/services/service-due.ts` and it is
arithmetic over a date and a tonnage, with no database behind it, so it is tested directly.

|            | Rule                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| By date    | Due when today has reached the `next_due_date` on the machine's most recent maintenance log. With no maintenance log, the service interval counted from the last service, or failing that from the install date |
| By tons    | Due when `tons_since_install` has reached the `next_due_tons` on that log, or the machine's `service_interval_tons`                                                                                             |
| Which wins | The date is checked first, so a machine late on both reads as late rather than busy                                                                                                                             |
| Never due  | A machine that is not active, and a machine with no interval and no next due recorded                                                                                                                           |

That last row is deliberate. A reminder raised against a figure nobody entered teaches people to
ignore reminders, and an ignored reminder is worse than none.

## Who is told

Owners and managers. A worker cannot book a machine in, so a reminder to one is a notification
they can do nothing about.

If a machine is due and there is nobody to tell, the run records it by name rather than passing
over it in silence. A site with no manager assigned is a configuration fault, and silence is how
that fault survives for months.

## Not sent twice

Each reminder carries a key made of the machine and the threshold it passed, for example
`service_due:<equipment id>:date:2026-09-30`. The database holds a unique constraint on
`(user_id, dedupe_key)`, so the same machine still being due tomorrow raises nothing, while the
same machine falling due again after it has been serviced raises a new reminder, because the
threshold has moved.

**Why the key is required rather than optional.** The obvious design is a partial index carrying
`WHERE dedupe_key IS NOT NULL`, so that a notification with no key is allowed to repeat. It was
rejected deliberately, for a reason worth knowing before anybody changes it back.

PostgreSQL only uses a partial index for `ON CONFLICT` when the statement repeats the same
`WHERE` clause. The API reaches this table through PostgREST, whose `on_conflict` parameter takes
a list of column names and has no way to express an index predicate at all. So against a partial
index the insert could never match, and **every sweep would fail with 42P10** the first time it
ran against the real database. Nothing in an in-memory test can catch that, because the fake has
no index to mismatch.

Requiring the key makes the constraint a plain one, which PostgREST can name, and makes the
invariant stronger: every notification can say what would make it a repeat. A genuinely one-off
notification carries a key of its own rather than carrying none.

Two smaller things in the same statement that are easy to get wrong:

- The column list is sent as `user_id,dedupe_key` with no space. PostgREST splits it on the comma
  and does not trim, so `" dedupe_key"` would go out as a column name that does not exist.
- The insert is one statement rather than a loop, so two sweeps racing cannot both create the
  same reminder, and the rows it returns are only the ones really inserted, which is the number
  the run records.

`api/test/notifications.test.ts` asserts both halves of the suppression: that the second run
raises nothing, **and that the first run really did create something.** A test with only the
first half passes while nothing works. It also asserts that every draft carries a key, since a
draft without one would now be refused by the database.

## The schedule

`api/src/services/scheduler.ts`, started in `server.ts` after the server is listening.

The timer is not the schedule. The claimed day is. The scheduler wakes every fifteen minutes,
works out REEF's calendar day, and tries to **claim** that day by inserting a row into
`job_runs`, which has a unique constraint on `(job, ran_for)`. One process wins and sweeps; any
other is told by the database that the day is taken.

That matters more than it sounds. Reading the table and then writing to it would let two
processes both see no run and both sweep, which on a free host that runs more than one instance
means every reminder arrives twice. It also means a restart, a redeploy or a host that slept
through the night all end with the same number of sweeps.

The day is REEF's own calendar day, not the day in UTC. 00:30 in South Africa is 22:30 the
previous day in UTC, and filing it against the wrong day makes "did yesterday's sweep run" a
question nobody can answer from the table. The time zone is the `SCHEDULE_TIMEZONE` setting.

## Seeing that it stopped

`GET /api/v1/admin/jobs`, owner only. It defaults to the last thirty days.

The field that matters is **`missed`**. A day the sweep did not run raises no error, writes no
log line and fails no check, because nothing happened. The only evidence is a row that is not
there, so the missing days are what the endpoint returns. `last_success` is the other half of the
answer.

Job runs are never deleted, for the same reason.

## The credential, and why the sweep needs its own

The sweep runs with no user behind it, so it cannot borrow a caller's token the way every
request does. It uses `SUPABASE_SERVICE_ROLE_KEY`, built in `schedulerRepositories` and reachable
from nowhere else.

That key bypasses row level security. It stays on the server, never reaches the web app, and is
never committed. There is no row level security policy allowing `authenticated` to insert a
notification, which means **nobody can send themselves or anybody else a notification** through
the API. Only the sweep can.

**If the key is not set, the sweep does not run.** The API still serves every request, says so
in a warning at start up, and every day shows as missed on the jobs endpoint. That is the
intended behaviour rather than a gap: a reminder system that quietly was not running is the
failure this task exists to close.

## Email

**Sending is not built.** The notifications are records, and the web app reads them. What is
built is the part that goes wrong in an inbox: `api/src/services/email.ts` renders the reminder
with a plain text alternative and HTML that Outlook can actually draw, with the rules a mail
client forces on you.

| Choice                                                 | Why                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Table layout, no flexbox and no grid                   | Outlook renders with Word rather than a browser, and collapses both           |
| Inline styles, no stylesheet and no style block        | Outlook strips them                                                           |
| 600 pixels wide, with a maximum of one hundred percent | Survives the Outlook reading pane and still reads on a plant phone            |
| No background image                                    | Silently dropped                                                              |
| A plain text version, always                           | A phone that refuses the HTML still has to show something a person can act on |

`api/test/email.test.ts` asserts each of those is absent rather than merely unused, and that a
machine name cannot carry markup into the message.

`Mailer` is the seam. `LoggingMailer` is the default and records what would have gone out, so
nothing is lost in silence. A provider is one class, and the key is a server side setting.

### The step nobody can do in code

**Send one reminder to a real mailbox and look at it in Outlook and on a phone.** An email that
looks correct in a browser very often does not, and no test here can tell you otherwise. That
tick box on the task stays open until there is a provider configured and somebody has looked.

## What to check before this is deployed

- `20261004090000_notifications_and_jobs.sql` applied to the Supabase project
- `SUPABASE_SERVICE_ROLE_KEY` set on the API host, and nowhere else
- `SCHEDULE_TIMEZONE` left at `Africa/Johannesburg` unless there is a reason
- The jobs endpoint checked the morning after the first deployment. One run, outcome `ok`
