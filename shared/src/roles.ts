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
  "stock:read": ["owner", "manager", "worker"],
  "stock:write": ["owner", "manager"],
  "po:read": ["owner", "manager"],
  "po:write": ["owner", "manager"],
  // Managers see only their own plant's changes; the database enforces that part.
  "history:read": ["owner", "manager"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
