/**
 * The three roles the platform actually uses.
 */
export const ROLES = ["owner", "manager", "worker"] as const;
export type Role = (typeof ROLES)[number];

export function highestRole(held: readonly string[]): Role | null {
  for (const role of ROLES) {
    if (held.includes(role)) return role;
  }
  return null;
}

export const PERMISSIONS = {
  "mines:read": ["owner", "manager", "worker"],
  "mines:write": ["owner", "manager"],
  "stock:read": ["owner", "manager", "worker"],
  "stock:write": ["owner", "manager"],
  // Managers see only their own plant's changes; the database enforces that part.
  "history:read": ["owner", "manager"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}