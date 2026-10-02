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
} from "@reef/shared";
import type {
  MaintenancePartsRepository,
  PhotoStore,
  Repository,
  RoleRepository,
  Row,
  StockUsageRepository,
} from "./types.js";

/** Everything a request can reach, already scoped to the caller. */
export type Repositories = {
  roles: RoleRepository;
  mines: Repository<Mine, MineInput, MinePatch>;
  production: Repository<Row, ProductionInput, ProductionPatch>;
  fuel: Repository<Row, FuelInput, FuelPatch>;
  maintenance: Repository<Row, MaintenanceInput, MaintenancePatch>;
  maintenanceParts: MaintenancePartsRepository;
  stockUsage: StockUsageRepository;
  photos: PhotoStore;
};
