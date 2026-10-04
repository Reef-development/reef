import type { Mine, MineInput, MinePatch } from "@reef/shared";
import type { HistoryRepository, Repository, RoleRepository, UserRepository } from "./types.js";

/** Everything a request can reach, already scoped to the caller. */
export type Repositories = {
  roles: RoleRepository;
  history: HistoryRepository;
  users: UserRepository;
  mines: Repository<Mine, MineInput, MinePatch>;
};
