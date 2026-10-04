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
  HistoryRepository,
  Repository,
  RoleRepository,
  ScopedRepository,
  SessionRepository,
  AnalyticsRepository,
  JobRepository,
  NotificationRepository,
  RetentionRepository,
} from "./types.js";

/** Everything a request can reach, already scoped to the caller. */
export type Repositories = {
  roles: RoleRepository;
  sessions: SessionRepository;
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
