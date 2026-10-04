import type { Mine, MineInput, MinePatch } from "@reef/shared";
import type {
  AnalyticsRepository,
  HistoryRepository,
  JobRepository,
  NotificationRepository,
  Repository,
  RetentionRepository,
  RoleRepository,
} from "./types.js";

/** Everything a request can reach, already scoped to the caller. */
export type Repositories = {
  roles: RoleRepository;
  history: HistoryRepository;
  analytics: AnalyticsRepository;
  retention: RetentionRepository;
  notifications: NotificationRepository;
  jobs: JobRepository;
  mines: Repository<Mine, MineInput, MinePatch>;
};
