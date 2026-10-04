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
  "suppliers:read": ["owner", "manager"],
  "suppliers:write": ["owner", "manager"],
  "clients:read": ["owner", "manager"],
  "clients:write": ["owner", "manager"],
  "stock:read": ["owner", "manager", "worker"],
  "stock:write": ["owner", "manager"],
  "po:read": ["owner", "manager"],
  "po:write": ["owner", "manager"],
  "history:read": ["owner", "manager"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
