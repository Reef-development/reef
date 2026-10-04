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
  "stock:read": ["owner", "manager", "worker"],
  "stock:write": ["owner", "manager"],
  "po:read": ["owner", "manager"],
  "po:write": ["owner", "manager"],
  // Managers see only their own plant's changes; the database enforces that part.
  "history:read": ["owner", "manager"],
  // Who can sign in and with which role. Owner only: a role decides what every screen allows.
  "users:manage": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
