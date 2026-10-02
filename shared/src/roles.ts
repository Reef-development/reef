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
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
