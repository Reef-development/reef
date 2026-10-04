/**
<<<<<<< HEAD
 * The three roles the platform actually uses. The database enum `app_role` still carries
 * `supervisor` and `stock_controller` from the first migration; nothing assigns them and the
 * API treats a user holding only those as having no role.
=======
 * The three roles the platform actually uses.
>>>>>>> origin/develop
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
<<<<<<< HEAD
 * Who may do what, per resource. This is the single permission table: the API enforces it on
 * every route, the endpoint list prints it, and the web app reads it to decide what to show.
 * Row-level security in the database stays underneath as the second line of defence.
 *
 * Suppliers and clients are commercial records: they carry cost, contract and revenue
 * information. Workers capture stock usage and repairs; they do not see the vendors REEF
 * buys from or the contracts REEF holds.
=======
 * Who may do what, per resource.
 *
 * Purchase orders are management documents — REEF confirmed that employees may not place
 * them, so both reading and writing are restricted to owner and manager.
>>>>>>> origin/develop
 */
export const PERMISSIONS = {
  "mines:read": ["owner", "manager", "worker"],
  "mines:write": ["owner", "manager"],
<<<<<<< HEAD
  "suppliers:read": ["owner", "manager"],
  "suppliers:write": ["owner", "manager"],
  "clients:read": ["owner", "manager"],
  "clients:write": ["owner", "manager"],
=======
  "stock:read": ["owner", "manager", "worker"],
  "stock:write": ["owner", "manager"],
  "po:read": ["owner", "manager"],
  "po:write": ["owner", "manager"],
  // Managers see only their own plant's changes; the database enforces that part.
  "history:read": ["owner", "manager"],
>>>>>>> origin/develop
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
