/**
 * The three roles the platform actually uses.
 */
export const ROLES = ["owner", "manager", "worker"] as const;
export type Role = (typeof ROLES)[number];

/** Highest role wins when a user holds several rows in `user_roles`. */
export function highestRole(held: readonly string[]): Role | null {
  for (const role of ROLES) {
    if (held.includes(role)) return role;
  }
  return null;
}

/**
 * Who may do what, per resource.
 *
 * Purchase orders are management documents — REEF confirmed that employees may not place
 * them, so both reading and writing are restricted to owner and manager.
 */
export const PERMISSIONS = {
  "mines:read": ["owner", "manager", "worker"],
  "mines:write": ["owner", "manager"],

  // Daily operations. Everyone captures; changing or deleting a captured entry is for the
  // people accountable for the site. These mirror the row-level security in the migrations.
  "production:read": ["owner", "manager", "worker"],
  "production:create": ["owner", "manager", "worker"],
  "production:write": ["owner", "manager"],
  "maintenance:read": ["owner", "manager", "worker"],
  "maintenance:create": ["owner", "manager", "worker"],
  "maintenance:write": ["owner", "manager"],
  "fuel:read": ["owner", "manager", "worker"],
  "fuel:create": ["owner", "manager", "worker"],
  "fuel:write": ["owner", "manager"],
  "fuel:delete": ["owner"],
  "stock:use": ["owner", "manager", "worker"],
  "photos:upload": ["owner", "manager", "worker"],
  "photos:view": ["owner", "manager", "worker"],
  "sessions:manage": ["owner"],
  "stock:read": ["owner", "manager", "worker"],
  "stock:write": ["owner", "manager"],
  "po:read": ["owner", "manager"],
  "po:write": ["owner", "manager"],
  // Managers see only their own plant's changes; the database enforces that part.
  "history:read": ["owner", "manager"],
  // Who can sign in and with which role. Owner only: a role decides what every screen allows.
  "users:manage": ["owner"],
  // Money figures. A worker captures the numbers that feed these and does not see what they
  // add up to, which is the line section 2.2.2 of the brief draws.
  "analytics:read": ["owner", "manager"],
  // Comparing sites against each other is the owner's alone: a manager seeing the ranking
  // learns how another manager's site is doing, which is not theirs to know. REEF has since
  // given the same reason for keeping plants apart.
  "analytics:compare": ["owner"],
  "reports:read": ["owner", "manager"],
  // What is due for removal under the retention rules REEF gave. The owner's alone: it is a
  // list of people who have left, and who has left a site is not a site manager's business.
  "retention:read": ["owner"],
  // Your own notifications, whatever your role. The database policy underneath limits it to
  // your own rows, so this permission is about reaching the endpoint at all.
  "notifications:read": ["owner", "manager", "worker"],
  // Whether the scheduled sweep has been running. The owner's, because a day with no run is a
  // question about whether the system is working rather than about one site.
  "jobs:read": ["owner"],

  // Settings: everyone reads them (the capture forms need the age limit); only the owner
  // changes them, because they change what every plant may capture.
  "settings:read": ["owner", "manager", "worker"],
  "settings:write": ["owner"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
