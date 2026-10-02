import type { Mine, MineInput, MinePatch } from "@reef/shared";
import type {
  AnalyticsRepository,
  Repository,
  RetentionRepository,
  RoleRepository,
} from "./types.js";

/** Everything a request can reach, already scoped to the caller. */
export type Repositories = {
  roles: RoleRepository;
  mines: Repository<Mine, MineInput, MinePatch>;
  analytics: AnalyticsRepository;
  retention: RetentionRepository;
};
