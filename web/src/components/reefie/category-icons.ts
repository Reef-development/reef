import {
  Coins,
  Factory,
  FileText,
  Hammer,
  Package,
  Timer,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Category } from "@/lib/reefie/quick-chats";

export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  Stock: Package,
  Equipment: Wrench,
  Maintenance: Hammer,
  Production: Factory,
  Costs: Coins,
  Downtime: Timer,
  People: Users,
  Reports: FileText,
};
