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
import type { HistoryRepository, Repository, RoleRepository } from "./types.js";

export type Repositories = {
  roles: RoleRepository;
  history: HistoryRepository;
  mines: Repository<Mine, MineInput, MinePatch>;
  suppliers: Repository<Supplier, SupplierInput, SupplierPatch>;
  clients: Repository<Client, ClientInput, ClientPatch>;
};