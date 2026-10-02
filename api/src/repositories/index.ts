import type {
  Client,
  ClientInput,
  ClientPatch,
  Mine,
  MineInput,
  MinePatch,
  Supplier,
  SupplierInput,
  SupplierPatch,
} from "@reef/shared";
import type { Repository, RoleRepository } from "./types.js";

/** Everything a request can reach, already scoped to the caller. */
export type Repositories = {
  roles: RoleRepository;
  mines: Repository<Mine, MineInput, MinePatch>;
  suppliers: Repository<Supplier, SupplierInput, SupplierPatch>;
  clients: Repository<Client, ClientInput, ClientPatch>;
};
