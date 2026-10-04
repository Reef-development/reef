import { z } from "zod";
import { ROLES } from "../roles.js";
import { Reason } from "./common.js";

/** A person who can sign in, as the owner's user list shows them. */
export type UserSummary = {
  id: string;
  full_name: string | null;
  email: string | null;
  /** Their highest real role, or null if they hold none (for example only a retired role). */
  role: (typeof ROLES)[number] | null;
  /** Their plant once T14 is in; null for the owner and before then. */
  plant: string | null;
  created_at: string;
};

/** Changing someone's role: one of the three real roles, and why. */
export const RoleChange = z
  .object({
    role: z.enum(ROLES, "A role must be owner, manager or worker"),
    reason: Reason,
  })
  .strict();
export type RoleChange = z.infer<typeof RoleChange>;
