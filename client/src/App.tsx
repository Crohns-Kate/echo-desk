import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWebSocket } from "@/hooks/useWebSocket";
import { AppLayout } from "@/components/layout/app-layout";
import Dashboard from "@/pages/dashboard";
import Calls from "@/pages/calls";
import CallDetail from "@/pages/call-detail";
import QAReports from "@/pages/qa-reports";
import Transcripts from "@/pages/transcripts";
import Alerts from "@/pages/alerts";
import Tenants from "@/pages/tenants";
import TenantOnboarding from "@/pages/tenant-onboarding";
import FaqManagement from "@/pages/faq-management";
import Billing from "@/pages/billing";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";

function Router() {
  useWebSocket();

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/calls" component={Calls} />
        <Route path="/calls/:id" component={CallDetail} />
        <Route path="/qa-reports" component={QAReports} />
        <Route path="/transcripts" component={Transcripts} />
        <Route path="/alerts" component={Alerts} />
        <Route path="/tenants" component={Tenants} />
        <Route path="/tenants/new" component={TenantOnboarding} />
        <Route path="/tenants/:tenantId/faqs" component={FaqManagement} />
        <Route path="/tenants/:tenantId/billing" component={Billing} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
