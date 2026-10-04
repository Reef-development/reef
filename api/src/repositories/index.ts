import type {
<<<<<<< HEAD
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
=======
  Mine,
  MineInput,
  MinePatch,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderPatch,
  Stock,
  StockInput,
  StockLevel,
  StockLevelInput,
  StockLevelPatch,
  StockPatch,
} from "@reef/shared";
import type { HistoryRepository, Repository, RoleRepository, ScopedRepository } from "./types.js";
>>>>>>> origin/develop

/** Everything a request can reach, already scoped to the caller. */
export type Repositories = {
  roles: RoleRepository;
  history: HistoryRepository;
  mines: Repository<Mine, MineInput, MinePatch>;
<<<<<<< HEAD
  suppliers: Repository<Supplier, SupplierInput, SupplierPatch>;
  clients: Repository<Client, ClientInput, ClientPatch>;
=======
  stock: ScopedRepository<Stock, StockInput, StockPatch>;
  stockLevels: ScopedRepository<StockLevel, StockLevelInput, StockLevelPatch>;
  purchaseOrders: ScopedRepository<PurchaseOrder, PurchaseOrderInput, PurchaseOrderPatch>;
>>>>>>> origin/develop
};
