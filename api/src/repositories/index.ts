import type { Mine, MineInput, MinePatch, Stock, StockInput, StockPatch } from "@reef/shared";
import type { Repository, RoleRepository, ScopedRepository } from "./types.js";

/** Everything a request can reach, already scoped to the caller. */
export type Repositories = {
  roles: RoleRepository;
  mines: Repository<Mine, MineInput, MinePatch>;
  stock: ScopedRepository<Stock, StockInput, StockPatch>;
};
