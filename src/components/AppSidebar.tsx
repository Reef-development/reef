import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, Mountain, Wrench, Boxes, Truck,
  ClipboardList, ShoppingCart, Receipt, AlertOctagon, HardHat,
  Gauge, LineChart, Bot, Fuel,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import reefLogo from "@/assets/reef-logo.png.asset.json";

const items = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Cost Analytics", url: "/analytics", icon: LineChart },
  { title: "Reefie", url: "/reefie", icon: Bot },
  { title: "Clients", url: "/clients", icon: Users },
  { title: "Employees", url: "/employees", icon: HardHat },
  { title: "Mines", url: "/mines", icon: Mountain },
  { title: "Equipment", url: "/equipment", icon: Wrench },
  { title: "Maintenance", url: "/maintenance", icon: ClipboardList },
  { title: "Downtime", url: "/downtime", icon: AlertOctagon },
  { title: "Inventory", url: "/inventory", icon: Boxes },
  { title: "Suppliers", url: "/suppliers", icon: Truck },
  { title: "Purchase Orders", url: "/purchase-orders", icon: ShoppingCart },
  { title: "Production", url: "/production", icon: Gauge },
  { title: "Fuel Slips", url: "/fuel", icon: Fuel },
  { title: "Static Costs", url: "/static-costs", icon: Receipt },
] as const;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({ select: (r) => r.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        {collapsed ? (
          <div className="flex items-center justify-center py-2">
            <div className="w-8 h-8 rounded bg-sidebar-primary/10 flex items-center justify-center border border-sidebar-primary/30 transition-all hover:bg-sidebar-primary/20 hover:scale-105">
              <span className="text-sidebar-primary font-display text-lg leading-none">R</span>
            </div>
          </div>
        ) : (
          <div className="px-2 py-3 animate-fade-in-soft">
            <img src={reefLogo.url} alt="R.E.E.F" className="h-10 w-auto transition-transform hover:scale-[1.02]" />
            <div className="mt-2 text-[10px] tracking-[0.22em] uppercase text-sidebar-foreground/50">
              Operations · Est. 2014
            </div>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item, i) => {
                const active = currentPath === item.url || currentPath.startsWith(item.url + "/");
                return (
                  <SidebarMenuItem key={item.url} className="animate-fade-up" style={{ animationDelay: `${i * 25}ms` }}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link to={item.url} className="flex items-center gap-2 group">
                        <item.icon className="w-4 h-4 shrink-0 transition-transform group-hover:scale-110 group-hover:text-sidebar-primary" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}