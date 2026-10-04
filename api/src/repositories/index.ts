import type {
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
import type {
  AnalyticsRepository,
  HistoryRepository,
  JobRepository,
  NotificationRepository,
  Repository,
  RetentionRepository,
  RoleRepository,
  ScopedRepository,
} from "./types.js";

/** Everything a request can reach, already scoped to the caller. */
export type Repositories = {
  roles: RoleRepository;
  history: HistoryRepository;
  mines: Repository<Mine, MineInput, MinePatch>;
  stock: ScopedRepository<Stock, StockInput, StockPatch>;
  stockLevels: ScopedRepository<StockLevel, StockLevelInput, StockLevelPatch>;
  purchaseOrders: ScopedRepository<PurchaseOrder, PurchaseOrderInput, PurchaseOrderPatch>;
  analytics: AnalyticsRepository;
  retention: RetentionRepository;
  notifications: NotificationRepository;
  jobs: JobRepository;
};
