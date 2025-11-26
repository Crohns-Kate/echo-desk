import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
  X,
  CheckCircle,
  Link as LinkIcon,
  Volume2,
  FileText,
  MessageSquare,
  Phone,
  User,
  Loader2,
} from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Alert } from "@shared/schema";

interface EnrichedAlert extends Alert {
  recordingUrl?: string | null;
  recordingSid?: string | null;
  transcript?: string | null;
  callSid?: string | null;
  fromNumber?: string | null;
}

function formatPhoneNumber(phone?: string | null): string {
  if (!phone) return "Unknown";
  if (phone.startsWith("+61")) {
    return "0" + phone.slice(3);
  }
  return phone;
}

function AlertRecordingPlayer({ recordingUrl }: { recordingUrl: string }) {
  return (
    <div className="text-sm bg-muted/50 p-3 rounded-lg flex items-center justify-between">
      <span className="text-muted-foreground">
        Recording available (Twilio authenticated access required)
      </span>
      <a
        href={recordingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline text-sm font-medium"
      >
        View in Twilio →
      </a>
    </div>
  );
}

export default function Alerts() {
  const [activeTab, setActiveTab] = useState<"open" | "all">("open");
  const { toast } = useToast();

  const { data: alerts, isLoading } = useQuery<EnrichedAlert[]>({
    queryKey: ["/api/alerts"],
    refetchInterval: 30000, // Refresh every 30 seconds
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
      case "caller_question":
        return "secondary";
      case "unanswered_faq":
        return "default";
      default:
        return "secondary";
    }
  };

  const getAlertIcon = (reason: string) => {
    switch (reason) {
      case "caller_question":
        return <MessageSquare className="h-4 w-4" />;
      case "unanswered_faq":
        return <MessageSquare className="h-4 w-4" />;
      case "human_request":
        return <Phone className="h-4 w-4" />;
      default:
        return <AlertCircle className="h-4 w-4" />;
    }
  };

  const getAlertDescription = (alert: EnrichedAlert) => {
    const payload = alert.payload as Record<string, any> || {};

    switch (alert.reason) {
      case "human_request":
        return "Caller requested to speak with a receptionist";
      case "booking_failed":
        return "Failed to complete appointment booking";
      case "caller_question":
        return payload.question
          ? `Caller asked: "${payload.question}"`
          : "Caller had a question";
      case "unanswered_faq":
        return payload.question
          ? `📚 Unanswered FAQ: "${payload.question}" - Add to knowledge base`
          : "Question couldn't be answered from knowledge base";
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
              Manage caller questions and receptionist alerts
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
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">Loading alerts...</span>
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
              filteredAlerts.map((alert) => {
                const payload = alert.payload as Record<string, any> || {};
                const fromNumber = alert.fromNumber || payload.fromNumber || null;

                return (
                  <Card
                    key={alert.id}
                    className="border-l-4 hover-elevate"
                    style={{
                      borderLeftColor: alert.status === "open"
                        ? "hsl(var(--destructive))"
                        : "hsl(var(--border))"
                    }}
                    data-testid={`card-alert-${alert.id}`}
                  >
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-4">
                          {/* Header row */}
                          <div className="flex items-center gap-2 flex-wrap">
                            {getAlertIcon(alert.reason || "")}
                            <Badge
                              variant={getAlertVariant(alert.reason!)}
                              data-testid={`badge-reason-${alert.id}`}
                            >
                              {alert.reason?.replace(/_/g, " ")}
                            </Badge>
                            {alert.status === "open" ? (
                              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                                Open
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-muted/50">
                                Dismissed
                              </Badge>
                            )}
                          </div>

                          {/* Description / Question */}
                          <p className="text-sm" data-testid={`text-description-${alert.id}`}>
                            {getAlertDescription(alert)}
                          </p>

                          {/* Caller info and timestamp */}
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            {fromNumber && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {formatPhoneNumber(fromNumber)}
                              </span>
                            )}
                            <span data-testid={`text-timestamp-${alert.id}`}>
                              {new Date(alert.createdAt!).toLocaleString("en-AU", {
                                timeZone: "Australia/Brisbane",
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </span>
                            {alert.conversationId && (
                              <span className="flex items-center gap-1">
                                <LinkIcon className="h-3 w-3" />
                                Conversation #{alert.conversationId}
                              </span>
                            )}
                          </div>

                          {/* Recording Player */}
                          {alert.recordingUrl && (
                            <div className="space-y-2 pt-2 border-t">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                                <Volume2 className="h-3 w-3" />
                                Call Recording
                              </p>
                              <AlertRecordingPlayer recordingUrl={alert.recordingUrl} />
                            </div>
                          )}

                          {/* Transcript */}
                          {alert.transcript && (
                            <div className="space-y-2 pt-2 border-t">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                Transcript
                              </p>
                              <div className="text-sm bg-muted/50 p-3 rounded-lg max-h-48 overflow-y-auto whitespace-pre-wrap">
                                {alert.transcript}
                              </div>
                            </div>
                          )}

                          {/* No recording/transcript message for caller questions */}
                          {!alert.recordingUrl && !alert.transcript && alert.reason === "caller_question" && (
                            <p className="text-xs text-muted-foreground italic pt-2">
                              Recording and transcript are being processed. Refresh to check for updates.
                            </p>
                          )}

                          {/* Payload details */}
                          {payload && Object.keys(payload).length > 0 && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                View technical details
                              </summary>
                              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                                {JSON.stringify(payload, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>

                        {alert.status === "open" && (
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
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
