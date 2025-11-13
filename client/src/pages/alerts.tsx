import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, X, CheckCircle, Link as LinkIcon } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Alert } from "@shared/schema";

export default function Alerts() {
  const [activeTab, setActiveTab] = useState<"open" | "all">("open");
  const { toast } = useToast();

  const { data: alerts, isLoading } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
  });

  const dismissMutation = useMutation({
    mutationFn: async (alertId: number) => {
      return apiRequest("PATCH", `/api/alerts/${alertId}/dismiss`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Alert dismissed",
        description: "The alert has been marked as resolved.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to dismiss alert. Please try again.",
        variant: "destructive",
      });
    },
  });

  const filteredAlerts = alerts?.filter((alert) => {
    if (activeTab === "open") {
      return alert.status === "open";
    }
    return true;
  });

  const getAlertVariant = (reason: string) => {
    switch (reason) {
      case "human_request":
        return "destructive";
      case "booking_failed":
        return "destructive";
      default:
        return "secondary";
    }
  };

  const getAlertDescription = (alert: Alert) => {
    switch (alert.reason) {
      case "human_request":
        return "Caller requested to speak with a receptionist";
      case "booking_failed":
        return "Failed to complete appointment booking";
      default:
        return alert.reason || "Alert notification";
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-foreground">Alerts</h1>
            <p className="text-sm text-muted-foreground">
              Manage notifications and receptionist alerts
            </p>
          </div>
          <Link href="/">
            <Button variant="outline" data-testid="button-back-dashboard">
              Back to Dashboard
            </Button>
          </Link>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "open" | "all")}>
          <TabsList>
            <TabsTrigger value="open" data-testid="tab-open">
              Open
              {alerts && (
                <Badge variant="secondary" className="ml-2">
                  {alerts.filter((a) => a.status === "open").length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="all" data-testid="tab-all">
              All
              {alerts && (
                <Badge variant="secondary" className="ml-2">
                  {alerts.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-6 space-y-4">
            {isLoading ? (
              <Card>
                <CardContent className="p-12">
                  <div className="flex items-center justify-center">
                    <div className="animate-pulse text-sm text-muted-foreground">Loading alerts...</div>
                  </div>
                </CardContent>
              </Card>
            ) : !filteredAlerts || filteredAlerts.length === 0 ? (
              <Card>
                <CardContent className="p-12">
                  <div className="flex flex-col items-center justify-center space-y-3 text-center">
                    <CheckCircle className="h-12 w-12 text-green-500" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        {activeTab === "open" ? "No open alerts" : "No alerts yet"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {activeTab === "open" 
                          ? "All clear! No pending notifications."
                          : "Alerts will appear here when generated."
                        }
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              filteredAlerts.map((alert) => (
                <Card 
                  key={alert.id}
                  className="border-l-4 hover-elevate"
                  style={{ 
                    borderLeftColor: alert.status === 'open' 
                      ? 'hsl(var(--destructive))' 
                      : 'hsl(var(--border))' 
                  }}
                  data-testid={`card-alert-${alert.id}`}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge 
                            variant={getAlertVariant(alert.reason!)}
                            data-testid={`badge-reason-${alert.id}`}
                          >
                            {alert.reason}
                          </Badge>
                          {alert.status === 'open' ? (
                            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                              Open
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-muted/50">
                              Dismissed
                            </Badge>
                          )}
                        </div>

                        <p className="text-sm" data-testid={`text-description-${alert.id}`}>
                          {getAlertDescription(alert)}
                        </p>

                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span data-testid={`text-timestamp-${alert.id}`}>
                            {new Date(alert.createdAt!).toLocaleString('en-AU', {
                              timeZone: 'Australia/Brisbane',
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </span>
                          {alert.conversationId && (
                            <span className="flex items-center gap-1">
                              <LinkIcon className="h-3 w-3" />
                              Conversation #{alert.conversationId}
                            </span>
                          )}
                        </div>

                        {alert.payload && typeof alert.payload === 'object' && alert.payload !== null && Object.keys(alert.payload).length > 0 ? (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                              View payload
                            </summary>
                            <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                              {JSON.stringify(alert.payload, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </div>

                      {alert.status === 'open' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => dismissMutation.mutate(alert.id)}
                          disabled={dismissMutation.isPending}
                          data-testid={`button-dismiss-${alert.id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
