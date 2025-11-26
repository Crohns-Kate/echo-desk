import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Phone,
  FileText,
  AlertCircle,
  Settings,
  BarChart3,
  Building2
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
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

export function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="hidden md:flex md:flex-col md:w-64 border-r bg-muted/10">
      <div className="p-6">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <Phone className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">Echo Desk</h2>
            <p className="text-xs text-muted-foreground">AI Voice Receptionist</p>
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

      <div className="p-4 border-t">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span>System Online</span>
        </div>
      </div>
    </aside>
  );
}
