# REEF lost device procedure

**Applies to:** any phone, tablet or laptop used to sign in to the REEF Operations Platform
**Owner:** the Owner-Administrator (currently Dave Goddard)
**Last reviewed:** 2026-10-04
**Next review:** on any lost-device incident, or every six months, whichever comes first

---

## 1. Purpose

This procedure states what a REEF employee does when a device that can reach the REEF Operations Platform is lost, stolen or about to be reassigned. It covers the worker who lost the device, the manager who revokes its access, and the Owner-Administrator who decides whether the incident needs to be reported.

A lost device is a security event, not an inconvenience. A signed-in device holds a session token that is accepted by the platform until it expires or is revoked. If the device also held captured-but-not-yet-synced operational records, losing it may mean losing those records permanently, because the device may hold the only copy.

This procedure is the operational form of two requirements stated in the REEF Operations Platform building document:

- Section 3, *Lost, Stolen or Reassigned Devices* — the offline storage risk
- Section 8, *Lost or Stolen Devices* — the security response

---

## 2. Scope

**In scope:**

- Any phone or tablet on which a REEF worker or manager has signed in to the platform
- Any laptop used by finance or the Owner-Administrator to access the platform
- REEF-owned devices and personally-owned devices on which REEF accounts have been used

**Out of scope:**

- A device that has never had a REEF account signed in on it
- A device that is confirmed destroyed and has been in REEF possession the whole time (still record the incident, but no access revocation is required)
- A lost password (see the account-recovery runbook, not this procedure)

---

## 3. Immediate response — the worker

If you realise a device is missing, or it has been stolen, do this **within one hour** of noticing:

1. **Stop trying to use the account elsewhere.** Do not sign in on another device "to check something". Every new sign-in extends the window in which the old token is still usable, and it makes the incident harder to reason about.
2. **Call your site manager.** Do not wait, do not send a WhatsApp message hoping they see it. If you cannot reach your manager, call the Owner-Administrator directly. The contact numbers are in the quick-reference card.
3. **Say what you know:**
   - When you last had the device
   - What device it was (make, model, phone number if it had a SIM)
   - Whether it was locked (PIN, fingerprint, face)
   - Whether you were signed in to the REEF platform at the time
   - Whether you had unsent records on it — for example, a repair or a downtime event captured with no signal and not yet synchronised
4. **Do not attempt to recover the device yourself.** Do not go back into an unsafe area for it. Do not confront anyone.
5. **If the device had a SIM, ask your manager to have the SIM suspended** with the mobile network operator.

The worker's role ends here. The manager takes over.

---

## 4. Revocation — the site manager

The site manager is responsible for revoking the lost device's access. This must happen **within two hours** of being told.

### 4.1 Revoke the user's sessions in Supabase

Every signed-in device holds a session token issued by Supabase Auth. Revoking the sessions invalidates every token issued to that user, on every device — including the lost one.

1. Sign in to the Supabase dashboard for the REEF project.
2. Go to **Authentication → Users**.
3. Find the affected user's account.
4. Click the menu on the user's row and choose **Sign out user** (or **Revoke sessions**, depending on the dashboard version).
5. Confirm. Every active session for that user is now invalid.

### 4.2 Force a password reset

Even with sessions revoked, the account password may still be known to whoever holds the device if it was written down or stored in a browser. Force a reset.

1. Still on the user's row in the Supabase dashboard, choose **Send password recovery**.
2. Do not share the recovery link with anyone other than the user, in person or over a channel they can verify.
3. Wait for the user to confirm the new password is set before the account is considered safe again.

### 4.3 Check recent activity on the account

Confirm whether anyone used the account after the device was lost.

1. In Supabase, go to **Table Editor → history**.
2. Filter by `changed_by = <the affected user's id>`.
3. Look at records created after the time the worker reported the device missing. Anything found is worth investigating.
4. If REEF has application logs (the delivered platform writes structured logs of authentication outcomes and authorisation refusals), check them for sign-ins from unfamiliar addresses during the same window.

### 4.4 Confirm what was on the device

Ask the worker:

- Were there unsent records on the device?
- Roughly how many, and of what kind (repairs, production entries, downtime events, stock movements)?
- Were any photographs attached?

If records were unsent, they are lost. They will need to be re-captured from the worker's memory and any paper notes they took. This is not a technical failure of the platform — the offline queue is designed to survive a device restart, not to survive the device being physically lost.

### 4.5 Notify the Owner-Administrator

Send the Owner-Administrator a short message with:

- The worker's name
- The date and time the device was reported missing
- The kind of device
- Whether sessions have been revoked (yes/no, and when)
- Whether the password has been reset (yes/no)
- Whether any unsent records are lost

The Owner-Administrator decides what happens next.

---

## 5. Data exposure assessment — the Owner-Administrator

The Owner-Administrator reviews what the device could have exposed and decides whether the incident needs to be reported.

### 5.1 What the device could have held

- A session token, valid until revocation. Now revoked.
- The signed-in user's own access to the platform — scoped by row-level security to their plant and role. A worker at plant A could only ever see plant A's operational data, even from a stolen device.
- Any records captured offline and not yet synchronised. Those records are gone unless the worker re-captures them.
- No other plant's data. No financial data if the user was a worker. No personal information beyond what the worker could already see.

### 5.2 Does this need to be reported under POPIA?

POPIA s22 requires a responsible party to notify the Information Regulator and the affected data subject when there are reasonable grounds to believe that personal information has been accessed or acquired by an unauthorised person.

A lost device needs to be reported under POPIA if **all three** of these are true:

1. Personal information was on the device, and
2. That information was not adequately protected (for example, the device was unlocked, or the app's cached data was not encrypted), and
3. There is a real risk that an unauthorised person could have accessed it.

In REEF's case, the platform does not hold employee identity numbers in the client at all — they live in `employee_personal_information` and are only reachable through a disclosure function that logs every attempt. Employee names, positions and shift assignments may be visible to a manager who was signed in. If the device was locked and the sessions have been revoked within the window, the practical risk is low.

The Owner-Administrator decides, and records the decision in the incident record whether the answer is yes or no.

### 5.3 If POPIA notification is required

1. Notify the Information Regulator through their online portal, on the prescribed form.
2. Notify any affected data subjects directly, in writing.
3. Record both notifications in the incident record, with dates.

The REEF POPIA officer (currently the Owner-Administrator) owns this step.

---

## 6. Replacement — getting the worker back online

1. The worker signs in on a replacement device once the manager has confirmed the password reset went through and the account is safe again.
2. Any records captured on the lost device that had not been synchronised are gone. The worker re-captures them from memory and any paper notes.
3. If the replacement device is a REEF-owned device, the worker sets a device passcode or biometric lock before signing in. If it is personally-owned, the same rule applies: no signing in to REEF without a device lock.
4. The worker confirms on the replacement device that the offline queue is empty (or only contains records they have just re-captured).

The worker must not share their REEF credentials with anyone, including another worker whose device is broken. A shared login is a shared incident and destroys the audit trail.

---

## 7. Reassignment

Before any REEF device is reassigned to a different worker, given away, sold or disposed of:

1. Sign out of the REEF platform on the device.
2. Sign out of any other accounts that were used on the device.
3. Uninstall the REEF app, if the mobile client is installed.
4. If the device holds cached REEF data (a browser's cache, or a mobile app's local database), clear it. On Android: **Settings → Apps → REEF → Storage → Clear data**. On iOS: delete the app and reinstall if it is being kept, or wipe the device if it is being sold.
5. Perform a factory reset if the device is leaving REEF's possession.
6. Record the reassignment in the device register — who had it, who it went to, and when.

If a device cannot be cleared because it is broken or inaccessible, treat it as a lost device and follow sections 4 and 5.

---

## 8. Incident record

Fill in this record for every incident. The Owner-Administrator keeps the completed records.

```
REEF LOST DEVICE INCIDENT RECORD

Incident number: ___________
Date and time reported: ___________
Reported by (worker): ___________
Device (make, model, SIM if any): ___________
Device owned by: REEF / personally-owned
Device was locked: yes / no / unknown
Device was signed in to REEF: yes / no / unknown
Unsent records on the device: none / unknown / approx. count and kind
  ___________________________________________________________

Sessions revoked: yes / no   Date/time: ___________
Password reset: yes / no     Date/time: ___________
History reviewed for suspicious activity: yes / no   Findings: ___________
Application logs reviewed: yes / no   Findings: ___________

POPIA assessment: not required / required / unclear
Reason: ____________________________________________________
  (if required)
  Regulator notified: yes / no   Date: ___________
  Data subjects notified: yes / no   Date: ___________

Replacement device issued: yes / no   Date: ___________
Unsent records re-captured: yes / no / not applicable

Root cause (if known): ____________________________________
Corrective action taken: __________________________________
Follow-up required: yes / no   Details: ___________

Reviewed by (Owner-Administrator): ___________
Date reviewed: ___________
```

---

## 9. Review

The Owner-Administrator reviews this procedure:

- After every incident, to see whether any step was unclear or missing
- Every six months, to check it still matches how the platform works

The review checks three things: that the revocation steps still work (Supabase changes its dashboard from time to time), that the POPIA assessment is still accurate (the law and the Regulator's guidance change), and that the contact numbers are still current.

---

## 10. Testing

The procedure is verified once a year against the scenario the building document lists among the offline tests:

> Attempting to access cached information using an unauthorised account.

The test:

1. Sign in as a worker on a test device.
2. Load a page that caches some data.
3. Follow section 4 to revoke that worker's sessions.
4. Attempt to use the same test device to load a page that requires a signed-in session.
5. Confirm the platform refuses the request, and that the refusal is recorded in the audit log.

If the platform accepts the request after revocation, the revocation step is wrong and the procedure needs fixing before it can be relied on. Record the test result and the date in the incident log's cover sheet.

---

## 11. Roles

| Role | Responsibility under this procedure |
|---|---|
| Worker | Report the loss immediately, answer the manager's questions, re-capture any unsent records |
| Site manager | Revoke sessions, force password reset, review activity, notify the Owner-Administrator |
| Owner-Administrator (Dave Goddard) | Decide whether POPIA notification is required, keep the incident record, review the procedure |
| REEF POPIA officer | Notify the Information Regulator and affected data subjects when required (currently the Owner-Administrator) |

---

## 12. Quick reference

For the notice board at each plant:

**If you lose your phone or tablet:**

1. Call your site manager straight away.
2. Do not sign in on another device.
3. Have ready: when you last had it, whether it was locked, whether you had unsent work on it.

**Site managers:** the step-by-step for revocation is section 4. Total time to complete: about fifteen minutes. Do it the same day, every time.