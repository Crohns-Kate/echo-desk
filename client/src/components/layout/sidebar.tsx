import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Phone,
  FileText,
  AlertCircle,
  Activity,
  Settings,
  BarChart3,
  Building2,
  MessageSquare,
  CreditCard,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

// Admin navigation items
const adminNavItems: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  {
    href: "/calls",
    label: "Call Logs",
    icon: <Phone className="h-4 w-4" />,
  },
  {
    href: "/qa-reports",
    label: "QA Reports",
    icon: <BarChart3 className="h-4 w-4" />,
  },
  {
    href: "/transcripts",
    label: "Transcripts",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    href: "/alerts",
    label: "Alerts",
    icon: <AlertCircle className="h-4 w-4" />,
  },
  {
    href: "/health",
    label: "System Health",
    icon: <Activity className="h-4 w-4" />,
  },
  {
    href: "/tenants",
    label: "Tenants",
    icon: <Building2 className="h-4 w-4" />,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: <Settings className="h-4 w-4" />,
  },
];

// Tenant navigation items
const tenantNavItems: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  {
    href: "/calls",
    label: "Call Logs",
    icon: <Phone className="h-4 w-4" />,
  },
  {
    href: "/transcripts",
    label: "Transcripts",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    href: "/faqs",
    label: "FAQs",
    icon: <MessageSquare className="h-4 w-4" />,
  },
  {
    href: "/alerts",
    label: "Alerts",
    icon: <AlertCircle className="h-4 w-4" />,
  },
  {
    href: "/settings",
    label: "Clinic Settings",
    icon: <Settings className="h-4 w-4" />,
  },
  {
    href: "/billing",
    label: "Billing",
    icon: <CreditCard className="h-4 w-4" />,
  },
];

export function Sidebar() {
  const [location] = useLocation();
  const { isSuperAdmin, tenant, logout } = useAuth();

  // Choose navigation items based on user role
  const navItems = isSuperAdmin ? adminNavItems : tenantNavItems;

  return (
    <aside className="hidden md:flex md:flex-col md:w-64 border-r bg-muted/10">
      <div className="p-6">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <Phone className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">Echo Desk</h2>
            <p className="text-xs text-muted-foreground">
              {isSuperAdmin ? "Admin Portal" : tenant?.clinicName || "AI Voice Receptionist"}
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href ||
            (item.href !== "/" && location.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span>System Online</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={() => logout()}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
