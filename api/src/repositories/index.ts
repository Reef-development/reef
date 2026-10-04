import type {
  FuelInput,
  FuelPatch,
  MaintenanceInput,
  MaintenancePatch,
  Mine,
  MineInput,
  MinePatch,
  ProductionInput,
  ProductionPatch,
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
  AnalyticsRepository,
  JobRepository,
  MaintenancePartsRepository,
  NotificationRepository,
  PhotoStore,
  Repository,
  RetentionRepository,
  RoleRepository,
  Row,
  ScopedRepository,
  SessionRepository,
  StockUsageRepository,
  UserRepository,
} from "./types.js";

/** Everything a request can reach, already scoped to the caller. */
export type Repositories = {
  roles: RoleRepository;
  sessions: SessionRepository;
  history: HistoryRepository;
  users: UserRepository;
  mines: Repository<Mine, MineInput, MinePatch>;
  production: Repository<Row, ProductionInput, ProductionPatch>;
  fuel: Repository<Row, FuelInput, FuelPatch>;
  maintenance: Repository<Row, MaintenanceInput, MaintenancePatch>;
  maintenanceParts: MaintenancePartsRepository;
  stockUsage: StockUsageRepository;
  photos: PhotoStore;
  stock: ScopedRepository<Stock, StockInput, StockPatch>;
  stockLevels: ScopedRepository<StockLevel, StockLevelInput, StockLevelPatch>;
  purchaseOrders: ScopedRepository<PurchaseOrder, PurchaseOrderInput, PurchaseOrderPatch>;
  analytics: AnalyticsRepository;
  retention: RetentionRepository;
  notifications: NotificationRepository;
  jobs: JobRepository;
};
