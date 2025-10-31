import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWebSocket } from "@/hooks/useWebSocket";
import Dashboard from "@/pages/dashboard";
import Calls from "@/pages/calls";
import CallDetail from "@/pages/call-detail";
import Alerts from "@/pages/alerts";
import Tenants from "@/pages/tenants";
import NotFound from "@/pages/not-found";

function Router() {
  useWebSocket();
  
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/calls" component={Calls} />
      <Route path="/calls/:id" component={CallDetail} />
      <Route path="/alerts" component={Alerts} />
      <Route path="/tenants" component={Tenants} />
      <Route component={NotFound} />
    </Switch>
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
