# Personal information: what is held, and how long it is kept

REEF holds personal information about its employees in order to run a mine: to pay people, to
record who was on shift, and to meet the record keeping the law requires of an employer. This
document says what is held, how long each piece of it is kept, and on whose instruction, so that
the answer does not have to be reconstructed from the code.

The rule is stated once, in `shared/src/retention.ts`. The API reads it from there, the database
columns carry it as comments, and this page is written from the same place, so the three cannot
quietly disagree.

## The two periods

| Period   | How long                            | What happens at the end                                          | Where it comes from                                                                                       |
| -------- | ----------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Identity | Five years after the person leaves  | The identity number is cleared. The employee row itself stays    | REEF, in writing, citing the Basic Conditions of Employment Act. Confirms the period the team had assumed |
| Record   | Seven years after the person leaves | The employee row is archived and removed from the working tables | REEF, in writing: seven to ten years for all other employee information                                   |

Both are settings, `RETENTION_IDENTITY_YEARS` and `RETENTION_RECORD_YEARS`, so either can be
changed without a change to the code. The API refuses to start if the identity period is set
longer than the record period, because removing the number while keeping the rest of the record
is the entire point of the shorter one.

**Seven rather than ten.** REEF gave a range, and software cannot act on a range. Seven is used
because it is the shortest period REEF allows, and section 14 of the Protection of Personal
Information Act says personal information is not kept for longer than is necessary for the
purpose it was collected for. Where a client permits a range, the shorter end is the defensible
choice. **This is open with REEF** and recorded as open in `decisions.md`: if they answer ten,
one setting changes.

**Why the row is not deleted at five years.** Attendance and overtime from past years feed
reports REEF has already received, seen and acted on. Deleting the employee row would change
figures the owner has already used. Removing the identity number is what the rule asks for.
Removing the history is a different and worse thing.

## What is held, and which period covers it

Every column of `employees` that says something about a person.

| Column        | What it is                       | Period               |
| ------------- | -------------------------------- | -------------------- |
| `id_number`   | South African identity number    | Identity, five years |
| `full_name`   | Name                             | Record, seven years  |
| `employee_no` | Payroll number                   | Record, seven years  |
| `phone`       | Telephone number                 | Record, seven years  |
| `position`    | Job title                        | Record, seven years  |
| `team_name`   | Team                             | Record, seven years  |
| `shift`       | Shift worked                     | Record, seven years  |
| `hourly_rate` | Pay rate                         | Record, seven years  |
| `hire_date`   | Date they started                | Record, seven years  |
| `notes`       | Free text notes about the person | Record, seven years  |

`left_on` is the date employment ended. Both periods are measured from it, and a person with no
leaving date recorded has no period running, so recording it when somebody leaves is what makes
the rule work at all.

If a personal column is added to `employees` and not added to the list in
`shared/src/retention.ts`, the test in `api/test/retention.test.ts` fails. That is deliberate:
the omission should be a decision somebody took rather than something nobody noticed.

## How to see what is due

`GET /api/v1/admin/retention` answers it. The owner only, because it is a list of people who
have left. It takes an optional `as_of` date, so the question "what falls due by the end of the
year" can be asked rather than only "what is due today".

**It never returns an identity number.** It reports whether one is still stored, which is all
the question needs. Returning the number to answer a question about the number would put
identity numbers into a response body, a server log and a browser cache for no reason.

## What is not built yet

The removal job itself. It is listed in the outstanding work document as work for after the ten
day window, and it now has two rules to act on rather than one. The endpoint above is what tells
somebody it is owed, and what will prove it worked once it exists.

## Who to ask

REEF, through the project's usual contact. One question is currently open with them: seven years
or ten for employee information other than the identity number.
