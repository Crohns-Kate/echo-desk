import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWebSocket } from "@/hooks/useWebSocket";
import { AppLayout } from "@/components/layout/app-layout";
import { AuthProvider } from "@/components/AuthProvider";
import { useAuth } from "@/hooks/useAuth";
import Dashboard from "@/pages/dashboard";
import Calls from "@/pages/calls";
import CallDetail from "@/pages/call-detail";
import QAReports from "@/pages/qa-reports";
import Transcripts from "@/pages/transcripts";
import Alerts from "@/pages/alerts";
import Health from "@/pages/health";
import Tenants from "@/pages/tenants";
import TenantOnboarding from "@/pages/tenant-onboarding";
import FaqManagement from "@/pages/faq-management";
import Billing from "@/pages/billing";
import Settings from "@/pages/settings";
import Login from "@/pages/login";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import ChangePassword from "@/pages/change-password";
import TenantDashboard from "@/pages/tenant-dashboard";
import TenantSettings from "@/pages/tenant-settings";
import Pricing from "@/pages/pricing";
import Signup from "@/pages/signup";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";

// Loading spinner component
function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto" />
        <p className="mt-2 text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  );
}

// Public routes (login, forgot password, pricing, signup, etc.)
function PublicRoutes() {
  return (
    <Switch>
      <Route path="/pricing" component={Pricing} />
      <Route path="/signup" component={Signup} />
      <Route path="/login" component={Login} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route>
        <Redirect to="/pricing" />
      </Route>
    </Switch>
  );
}

// Authenticated routes for super admin
function AdminRoutes() {
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
        <Route path="/health" component={Health} />
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

// Authenticated routes for tenant users
function TenantRoutes() {
  useWebSocket();

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={TenantDashboard} />
        <Route path="/calls" component={Calls} />
        <Route path="/calls/:id" component={CallDetail} />
        <Route path="/transcripts" component={Transcripts} />
        <Route path="/alerts" component={Alerts} />
        <Route path="/faqs" component={FaqManagement} />
        <Route path="/settings" component={TenantSettings} />
        <Route path="/billing" component={Billing} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

// Main router that handles auth state
function Router() {
  const { isLoading, isAuthenticated, isSuperAdmin, mustChangePassword } = useAuth();
  const [location] = useLocation();

  // Always allow these public routes regardless of auth state
  const publicPaths = ["/pricing", "/signup", "/reset-password", "/login", "/forgot-password"];
  const isPublicPath = publicPaths.some(path => location.startsWith(path));

  // Show loading while checking auth (but not for public paths)
  if (isLoading && !isPublicPath) {
    return <LoadingScreen />;
  }

  // Public routes accessible to everyone
  if (isPublicPath) {
    if (location.startsWith("/pricing")) return <Pricing />;
    if (location.startsWith("/signup")) return <Signup />;
    if (location.startsWith("/reset-password")) return <ResetPassword />;
    if (location.startsWith("/login")) return <Login />;
    if (location.startsWith("/forgot-password")) return <ForgotPassword />;
  }

  // Non-authenticated users see public routes
  if (!isAuthenticated) {
    return <PublicRoutes />;
  }

  // Force password change if required
  if (mustChangePassword) {
    return <ChangePassword />;
  }

  // Super admin gets full admin routes
  if (isSuperAdmin) {
    return <AdminRoutes />;
  }

  // Tenant users get scoped routes
  return <TenantRoutes />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
