# Privacy and Personal Information

## Overview

REEF stores personal information relating to employees as part of its workforce management functionality by treating employee identity numbers are treated as sensitive personal information and are protected separately from general employee information.

The system is designed so that identity numbers are not automatically exposed when an employee record is retrieved.

## Storage of Identity Numbers

Employee identity numbers are stored in the `employee_personal_information` table instead of the general `employees` table.

The `employees` table contains general employee information required by the application, while the protected table contains the employee's identity number.

Direct access to `employee_personal_information` is not granted to authenticated application users. This prevents an identity number from being obtained simply by querying an employee record from the browser.

## Access to Personal Information

Personal information is accessed through the `disclose_personal_information` database function.

Authorization is checked inside the database before the identity number is returned. The function uses the existing manager authorization check to determine whether the current user has an owner or manager role.

If the user is authorized, the requested identity number may be returned.

If the user is not authorized, the request is refused and no identity number is returned.

This ensures that access control is enforced by the database rather than only by the user interface.

## Disclosure Audit History

Every attempt to disclose an employee's identity number is recorded in the `personal_information_audit` table.

The audit record includes:

- the user who attempted to access the information;
- the employee whose personal information was requested;
- the action name `disclose`;
- whether the disclosure was allowed or refused;
- the reason for the audit result; and
- the date and time of the attempt.

Both successful and refused disclosure attempts are recorded.

The employee's actual identity number is never written to the audit history.

## Audit Integrity

The personal information audit history is append-only for application users. Direct update and delete policies are not provided for audit records.

This prevents users from quietly changing or deleting the history of personal information disclosure attempts.

## Updating Identity Numbers

Employee identity numbers are created or updated through the `set_employee_id_number` database function.

The function performs an authorization check before modifying the protected personal information. Only users who pass the owner or manager authorization check may update an employee's identity number.

General employee updates do not directly write identity numbers to the `employees` table.

## Refused Access Attempts

A refused personal information request is still recorded in the audit history.

The audit entry identifies the user who attempted the disclosure and records the attempt with:

- `action` set to `disclose`; and
- `allowed` set to `false`.

No identity number is returned to the unauthorized user and the identity number itself is not included in the audit record.