import type { Mine, MineInput, MinePatch } from "@reef/shared";
import type { Repository, RoleRepository, SessionRepository } from "./types.js";

/** Everything a request can reach, already scoped to the caller. */
export type Repositories = {
  roles: RoleRepository;
  sessions: SessionRepository;
  mines: Repository<Mine, MineInput, MinePatch>;
};