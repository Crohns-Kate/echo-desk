/**
 * Tenant Dashboard
 * Self-service portal for tenant admins to view their clinic's data
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import {
  Phone,
  Clock,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  Settings,
  FileText,
  CreditCard,
  Calendar,
  MessageSquare,
  ArrowRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";

// Types for dashboard data
interface DashboardStats {
  callsToday: number;
  callsThisWeek: number;
  avgDuration: number;
  successRate: number;
  appointmentsBooked: number;
  messagesHandled: number;
}

interface RecentCall {
  id: number;
  callerNumber: string;
  duration: number;
  status: string;
  createdAt: string;
  intent?: string;
}

export default function TenantDashboard() {
  const { user, tenant } = useAuth();

  // Fetch dashboard stats
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["tenantStats"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/stats", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch stats");
      return response.json();
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch recent calls
  const { data: recentCalls, isLoading: callsLoading } = useQuery<RecentCall[]>({
    queryKey: ["tenantRecentCalls"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/calls/recent", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch calls");
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Calculate trial days remaining
  const trialDaysRemaining = tenant?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(tenant.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const isTrialing = tenant?.subscriptionStatus === "trialing" || tenant?.subscriptionStatus === "pending";

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Format phone number
  const formatPhone = (phone: string) => {
    if (phone.startsWith("+61")) {
      return phone.replace(/^\+61(\d{3})(\d{3})(\d{3})$/, "0$1 $2 $3");
    }
    return phone;
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Welcome back, {user?.firstName || "there"}!</h1>
          <p className="text-gray-500">{tenant?.clinicName}</p>
        </div>
        <div className="flex items-center gap-2">
          {tenant?.phoneNumber && (
            <Badge variant="outline" className="text-sm py-1 px-3">
              <Phone className="h-3 w-3 mr-1" />
              {formatPhone(tenant.phoneNumber)}
            </Badge>
          )}
        </div>
      </div>

      {/* Trial Alert */}
      {isTrialing && trialDaysRemaining !== null && (
        <Alert variant={trialDaysRemaining <= 3 ? "destructive" : "default"}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {trialDaysRemaining === 0
              ? "Trial ends today!"
              : trialDaysRemaining === 1
                ? "Trial ends tomorrow"
                : `${trialDaysRemaining} days left in your trial`}
          </AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              Add your payment details to keep your phone number and continue using Echo Desk.
            </span>
            <Link href="/billing">
              <Button size="sm" variant={trialDaysRemaining <= 3 ? "default" : "outline"}>
                <CreditCard className="h-4 w-4 mr-1" />
                Add payment
              </Button>
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* Onboarding Progress */}
      {tenant && !tenant.onboardingCompleted && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Complete your setup</CardTitle>
              <Badge variant="secondary">{tenant.onboardingStep}/8 steps</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Progress value={(tenant.onboardingStep / 8) * 100} className="h-2 mb-3" />
            <p className="text-sm text-gray-500 mb-3">
              Finish setting up your AI receptionist to start handling calls.
            </p>
            <Link href="/settings">
              <Button size="sm">
                Continue setup
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Calls Today</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.callsToday ?? 0}</div>
                <p className="text-xs text-muted-foreground">
                  {stats?.callsThisWeek ?? 0} this week
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg. Call Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <div className="text-2xl font-bold">{formatDuration(stats?.avgDuration ?? 0)}</div>
                <p className="text-xs text-muted-foreground">minutes average</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.successRate ?? 0}%</div>
                <p className="text-xs text-muted-foreground">calls handled successfully</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Appointments</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.appointmentsBooked ?? 0}</div>
                <p className="text-xs text-muted-foreground">booked this week</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Calls */}
        <Card className="col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Calls</CardTitle>
              <Link href="/calls">
                <Button variant="ghost" size="sm">
                  View all
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
            <CardDescription>Latest calls handled by your AI receptionist</CardDescription>
          </CardHeader>
          <CardContent>
            {callsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : recentCalls && recentCalls.length > 0 ? (
              <div className="space-y-4">
                {recentCalls.slice(0, 5).map((call) => (
                  <Link key={call.id} href={`/calls/${call.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            call.status === "completed"
                              ? "bg-green-500"
                              : call.status === "failed"
                                ? "bg-red-500"
                                : "bg-yellow-500"
                          }`}
                        />
                        <div>
                          <p className="font-medium text-sm">{formatPhone(call.callerNumber)}</p>
                          <p className="text-xs text-gray-500">{call.intent || "General inquiry"}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm">{formatDuration(call.duration)}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(call.createdAt).toLocaleTimeString("en-AU", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Phone className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No calls yet</p>
                <p className="text-sm">Calls will appear here once your number is active</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks for managing your AI receptionist</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href="/faqs" className="block">
              <Button variant="outline" className="w-full justify-start h-auto py-3">
                <MessageSquare className="h-5 w-5 mr-3 text-blue-600" />
                <div className="text-left">
                  <p className="font-medium">Manage FAQs</p>
                  <p className="text-xs text-gray-500">Update common questions and answers</p>
                </div>
              </Button>
            </Link>

            <Link href="/transcripts" className="block">
              <Button variant="outline" className="w-full justify-start h-auto py-3">
                <FileText className="h-5 w-5 mr-3 text-green-600" />
                <div className="text-left">
                  <p className="font-medium">View Transcripts</p>
                  <p className="text-xs text-gray-500">Read full call transcripts</p>
                </div>
              </Button>
            </Link>

            <Link href="/settings" className="block">
              <Button variant="outline" className="w-full justify-start h-auto py-3">
                <Settings className="h-5 w-5 mr-3 text-purple-600" />
                <div className="text-left">
                  <p className="font-medium">Settings</p>
                  <p className="text-xs text-gray-500">Update hours, voice, and more</p>
                </div>
              </Button>
            </Link>

            <Link href="/billing" className="block">
              <Button variant="outline" className="w-full justify-start h-auto py-3">
                <CreditCard className="h-5 w-5 mr-3 text-orange-600" />
                <div className="text-left">
                  <p className="font-medium">Billing</p>
                  <p className="text-xs text-gray-500">Manage subscription and invoices</p>
                </div>
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Status Summary */}
      <Card>
        <CardHeader>
          <CardTitle>System Status</CardTitle>
          <CardDescription>Current status of your Echo Desk services</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium text-sm">Phone Line</p>
                <p className="text-xs text-gray-500">Active and receiving calls</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium text-sm">AI Receptionist</p>
                <p className="text-xs text-gray-500">Online and responding</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium text-sm">Cliniko Integration</p>
                <p className="text-xs text-gray-500">Connected and syncing</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
