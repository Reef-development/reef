/**
 * The three roles the platform actually uses. The database enum `app_role` still carries
 * `supervisor` and `stock_controller` from the first migration; nothing assigns them and the
 * API treats a user holding only those as having no role.
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
 * Who may do what, per resource. This is the single permission table: the API enforces it on
 * every route, the endpoint list prints it, and the web app reads it to decide what to show.
 * Row-level security in the database stays underneath as the second line of defence.
 */
export const PERMISSIONS = {
  "mines:read": ["owner", "manager", "worker"],
  "mines:write": ["owner", "manager"],
  // Money figures. A worker captures the numbers that feed these and does not see what they
  // add up to, which is the line section 2.2.2 of the brief draws.
  "analytics:read": ["owner", "manager"],
  // Comparing sites against each other is the owner's alone: a manager seeing the ranking
  // learns how another manager's site is doing, which is not theirs to know.
  "analytics:compare": ["owner"],
  "reports:read": ["owner", "manager"],
  "assistant:ask": ["owner", "manager"],
  // What is due to be removed under the retention rules REEF gave. The owner's alone: it is
  // a list of people who have left, and who has left a site is not a site manager's business.
  "retention:read": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
