import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, AlertCircle, Clock, TrendingUp, Mic, FileText } from "lucide-react";
import { Link } from "wouter";
import type { CallLog, Alert } from "@shared/schema";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<{
    activeCalls: number;
    pendingAlerts: number;
    todayCalls: number;
  }>({
    queryKey: ["/api/stats"],
  });

  const { data: recentCalls, isLoading: callsLoading } = useQuery<CallLog[]>({
    queryKey: ["/api/calls", "recent"],
  });

  const { data: recentAlerts, isLoading: alertsLoading } = useQuery<Alert[]>({
    queryKey: ["/api/alerts", "recent"],
  });

  // Fetch callback requests (alerts with reason 'callback_requested')
  const { data: callbackRequests, isLoading: callbacksLoading } = useQuery<Alert[]>({
    queryKey: ["/api/alerts", "callback"],
    queryFn: async () => {
      const response = await fetch("/api/alerts?reason=callback_requested&limit=10");
      if (!response.ok) return [];
      return response.json();
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Real-time monitoring of voice calls and alerts
          </p>
        </div>

        {/* Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card data-testid="card-active-calls">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Calls</CardTitle>
              <Phone className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" data-testid="text-active-calls-count">
                {statsLoading ? "..." : stats?.activeCalls ?? 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Currently in progress
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-pending-alerts">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Alerts</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" data-testid="text-pending-alerts-count">
                {statsLoading ? "..." : stats?.pendingAlerts ?? 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Require attention
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-today-calls">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Today's Calls</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" data-testid="text-today-calls-count">
                {statsLoading ? "..." : stats?.todayCalls ?? 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Total volume
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Calls - Left 60% */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Recent Calls</h2>
              <Link href="/calls">
                <Button variant="ghost" size="sm" data-testid="link-view-all-calls">
                  View all
                </Button>
              </Link>
            </div>

            <div className="space-y-4">
              {callsLoading ? (
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-center h-24">
                      <div className="animate-pulse text-sm text-muted-foreground">Loading calls...</div>
                    </div>
                  </CardContent>
                </Card>
              ) : !recentCalls || recentCalls.length === 0 ? (
                <Card>
                  <CardContent className="p-6">
                    <div className="flex flex-col items-center justify-center h-24 space-y-2">
                      <Phone className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">No calls yet</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                recentCalls.slice(0, 5).map((call) => (
                  <Card key={call.id} className="hover-elevate" data-testid={`card-call-${call.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-medium" data-testid={`text-from-number-${call.id}`}>
                              {call.fromNumber}
                            </span>
                            {call.intent && (
                              <Badge variant="secondary" data-testid={`badge-intent-${call.id}`}>
                                {call.intent}
                              </Badge>
                            )}
                            {call.recordingSid && (
                              <Badge 
                                variant={call.recordingStatus === 'completed' ? 'default' : 'outline'} 
                                className="text-xs"
                                data-testid={`badge-recording-${call.id}`}
                              >
                                <Mic className="h-3 w-3 mr-1" />
                                {call.recordingStatus === 'completed' ? 'Recorded' :
                                 call.recordingStatus === 'in-progress' ? 'Recording...' :
                                 call.recordingStatus === 'failed' ? 'Failed' : 'Recording'}
                              </Badge>
                            )}
                            {call.transcript && (
                              <Badge variant="outline" className="text-xs" data-testid={`badge-transcript-${call.id}`}>
                                <FileText className="h-3 w-3 mr-1" />
                                Transcribed
                              </Badge>
                            )}
                            {call.handoffTriggered && (
                              <Badge 
                                variant="destructive" 
                                className="text-xs"
                                data-testid={`badge-handoff-${call.id}`}
                              >
                                <AlertCircle className="h-3 w-3 mr-1" />
                                HANDOFF {call.handoffStatus ? `(${call.handoffStatus})` : ''}
                              </Badge>
                            )}
                          </div>
                          {call.handoffTriggered && call.handoffReason && (
                            <p className="text-xs text-muted-foreground italic" data-testid={`text-handoff-reason-${call.id}`}>
                              Reason: {call.handoffReason}
                            </p>
                          )}
                          {call.summary && (
                            <p className="text-sm text-muted-foreground" data-testid={`text-summary-${call.id}`}>
                              {call.summary}
                            </p>
                          )}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span data-testid={`text-timestamp-${call.id}`}>
                              {new Date(call.createdAt!).toLocaleString('en-AU', {
                                timeZone: 'Australia/Brisbane',
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </span>
                            {call.duration && (
                              <span>• {Math.floor(call.duration / 60)}m {call.duration % 60}s</span>
                            )}
                          </div>
                        </div>
                        <Link href={`/calls/${call.id}`}>
                          <Button variant="outline" size="sm" data-testid={`button-view-call-${call.id}`}>
                            View
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>

          {/* Recent Alerts - Right 40% */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Recent Alerts</h2>
              <Link href="/alerts">
                <Button variant="ghost" size="sm" data-testid="link-view-all-alerts">
                  View all
                </Button>
              </Link>
            </div>

            <div className="space-y-4">
              {alertsLoading ? (
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-center h-24">
                      <div className="animate-pulse text-sm text-muted-foreground">Loading alerts...</div>
                    </div>
                  </CardContent>
                </Card>
              ) : !recentAlerts || recentAlerts.length === 0 ? (
                <Card>
                  <CardContent className="p-6">
                    <div className="flex flex-col items-center justify-center h-24 space-y-2">
                      <AlertCircle className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">No alerts - All clear!</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                recentAlerts.slice(0, 5).map((alert) => (
                  <Card 
                    key={alert.id} 
                    className="hover-elevate border-l-4" 
                    style={{ borderLeftColor: alert.status === 'open' ? 'hsl(var(--destructive))' : 'hsl(var(--border))' }}
                    data-testid={`card-alert-${alert.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <Badge 
                            variant={alert.status === 'open' ? 'destructive' : 'secondary'}
                            data-testid={`badge-reason-${alert.id}`}
                          >
                            {alert.reason}
                          </Badge>
                          {alert.status === 'open' && (
                            <Badge variant="outline" className="text-xs">Open</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground" data-testid={`text-alert-timestamp-${alert.id}`}>
                          {new Date(alert.createdAt!).toLocaleString('en-AU', {
                            timeZone: 'Australia/Brisbane',
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>

          {/* Callback Queue - Below Recent Alerts */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Callback Requests</h2>
              {callbackRequests && callbackRequests.length > 0 && (
                <Badge variant="secondary">{callbackRequests.length}</Badge>
              )}
            </div>

            <div className="space-y-4">
              {callbacksLoading ? (
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-center h-24">
                      <div className="animate-pulse text-sm text-muted-foreground">Loading callbacks...</div>
                    </div>
                  </CardContent>
                </Card>
              ) : !callbackRequests || callbackRequests.length === 0 ? (
                <Card>
                  <CardContent className="p-6">
                    <div className="flex flex-col items-center justify-center h-24 space-y-2">
                      <Phone className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">No callback requests</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                callbackRequests.slice(0, 5).map((alert) => {
                  const payload = alert.payload as any;
                  return (
                    <Card 
                      key={alert.id} 
                      className="hover-elevate border-l-4 border-blue-500"
                      data-testid={`card-callback-${alert.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <Badge variant="default" className="bg-blue-500">
                              Callback Requested
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(alert.createdAt!).toLocaleTimeString('en-AU', {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          </div>
                          <p className="text-sm font-medium">{payload?.fromNumber || 'Unknown number'}</p>
                          {payload?.callbackPreference && (
                            <p className="text-xs text-muted-foreground">
                              Preferred time: {payload.callbackPreference}
                            </p>
                          )}
                          {payload?.reason && (
                            <p className="text-xs text-muted-foreground italic">
                              Reason: {payload.reason}
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" data-testid="status-indicator" />
              <span className="text-sm text-muted-foreground">All systems operational</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
