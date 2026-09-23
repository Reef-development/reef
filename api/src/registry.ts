import type { Permission } from "@reef/shared";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * One entry per endpoint. Routes are only ever added through `defineRoute`, so this list is
 * complete by construction and the endpoint document is generated from it rather than written
 * by hand.
 */
export type RouteInfo = {
  method: Method;
  path: string;
  /** `public` means no sign-in; `signed-in` means any role; otherwise the permission required. */
  access: "public" | "signed-in" | Permission;
  /** What the endpoint is for. */
  summary?: string;
  /** Why it refuses what it refuses, beyond the access rule. */
  refuses?: string;
};

export class Registry {
  readonly routes: RouteInfo[] = [];

  add(info: RouteInfo) {
    if (this.routes.some((r) => r.method === info.method && r.path === info.path)) {
      throw new Error(`Route registered twice: ${info.method} ${info.path}`);
    }
    this.routes.push(info);
  }
}
