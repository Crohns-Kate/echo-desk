import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Activity,
  Database,
  Phone,
  Lightbulb,
  Server,
  Calendar,
  User,
  FileText,
  Loader2
} from "lucide-react";
import { Link } from "wouter";

interface HealthResponse {
  timestamp: string;
  configuration: {
    region: string;
    businessId: string | null;
    practitionerId: string | null;
    appointmentTypeId: string | null;
    apiKeyConfigured: boolean;
  };
  autoDetection: {
    attempted: boolean;
    business: {
      id: string;
      name: string;
      note: string;
    } | null;
    practitioner: {
      id: string;
      name: string;
      note: string;
    } | null;
    appointmentType: {
      id: string;
      name: string;
      duration: number;
      note: string;
      allTypes?: Array<{ id: string; name: string; duration: number }>;
    } | null;
  };
  connectivity: {
    ok: boolean;
    reason: string | null;
  };
  availabilityTest: {
    attempted: boolean;
    ok: boolean;
    reason: string | null;
    slotsFound: number;
  };
  recommendations: string[];
}

function StatusIndicator({ status }: { status: "ok" | "warning" | "error" | "unknown" }) {
  if (status === "ok") {
    return (
      <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-5 w-5" />
        <span className="font-medium">OK</span>
      </div>
    );
  }
  if (status === "warning") {
    return (
      <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
        <AlertCircle className="h-5 w-5" />
        <span className="font-medium">Warning</span>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
        <XCircle className="h-5 w-5" />
        <span className="font-medium">Error</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <AlertCircle className="h-5 w-5" />
      <span className="font-medium">Unknown</span>
    </div>
  );
}

function TrafficLight({ status }: { status: "green" | "yellow" | "red" | "gray" }) {
  const colors = {
    green: "bg-green-500 ring-green-500/20",
    yellow: "bg-yellow-500 ring-yellow-500/20",
    red: "bg-red-500 ring-red-500/20",
    gray: "bg-gray-300 ring-gray-300/20"
  };

  return (
    <div className={`h-4 w-4 rounded-full ${colors[status]} ring-4 ring-offset-2 ring-offset-background`} />
  );
}

export default function Health() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery<HealthResponse>({
    queryKey: ["/__cliniko/health"],
    refetchInterval: 60000, // Refresh every minute
  });

  // Determine overall system status
  const getSystemStatus = (): "ok" | "warning" | "error" | "unknown" => {
    if (!data) return "unknown";
    if (!data.connectivity.ok) return "error";
    if (!data.availabilityTest.ok && data.availabilityTest.attempted) return "warning";
    if (data.availabilityTest.ok && data.availabilityTest.slotsFound > 0) return "ok";
    if (data.availabilityTest.ok && data.availabilityTest.slotsFound === 0) return "warning";
    return "ok";
  };

  const systemStatus = getSystemStatus();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Activity className="h-8 w-8 text-primary" />
              <h1 className="text-2xl font-semibold text-foreground">System Health</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Monitor Cliniko connectivity and configuration status
            </p>
          </div>
          <Button
            onClick={() => refetch()}
            disabled={isRefetching}
            variant="outline"
            size="sm"
          >
            {isRefetching ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <Card>
            <CardContent className="p-12">
              <div className="flex flex-col items-center justify-center space-y-4">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Running health checks...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error State */}
        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Failed to load health status</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : "Unknown error occurred"}
            </AlertDescription>
          </Alert>
        )}

        {/* Health Data */}
        {data && (
          <>
            {/* Overall Status Card */}
            <Card className="border-2">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-xl">System Status</CardTitle>
                    <CardDescription>
                      Last checked: {new Date(data.timestamp).toLocaleString()}
                    </CardDescription>
                  </div>
                  <StatusIndicator status={systemStatus} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <div className="flex flex-col items-center gap-2 flex-1">
                    <TrafficLight status={data.connectivity.ok ? "green" : "red"} />
                    <span className="text-xs font-medium text-muted-foreground">Connectivity</span>
                  </div>
                  <div className="flex flex-col items-center gap-2 flex-1">
                    <TrafficLight
                      status={
                        data.configuration.apiKeyConfigured &&
                        (data.configuration.practitionerId || data.autoDetection.practitioner) &&
                        (data.configuration.appointmentTypeId || data.autoDetection.appointmentType)
                          ? "green"
                          : data.autoDetection.attempted ? "yellow" : "red"
                      }
                    />
                    <span className="text-xs font-medium text-muted-foreground">Configuration</span>
                  </div>
                  <div className="flex flex-col items-center gap-2 flex-1">
                    <TrafficLight
                      status={
                        data.availabilityTest.ok && data.availabilityTest.slotsFound > 0 ? "green" :
                        data.availabilityTest.ok && data.availabilityTest.slotsFound === 0 ? "yellow" :
                        data.availabilityTest.attempted ? "red" : "gray"
                      }
                    />
                    <span className="text-xs font-medium text-muted-foreground">Availability</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Configuration Status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  Configuration
                </CardTitle>
                <CardDescription>
                  Cliniko API connection settings
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">API Key</span>
                      {data.configuration.apiKeyConfigured ? (
                        <Badge variant="default">Configured</Badge>
                      ) : (
                        <Badge variant="destructive">Missing</Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Region</span>
                      <Badge variant="secondary">{data.configuration.region}</Badge>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Business ID</span>
                      {data.configuration.businessId ? (
                        <Badge variant="default">{data.configuration.businessId}</Badge>
                      ) : data.autoDetection.business ? (
                        <Badge variant="outline">Auto-detected</Badge>
                      ) : (
                        <Badge variant="outline">Not set</Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Practitioner ID</span>
                      {data.configuration.practitionerId ? (
                        <Badge variant="default">{data.configuration.practitionerId}</Badge>
                      ) : data.autoDetection.practitioner ? (
                        <Badge variant="outline">Auto-detected</Badge>
                      ) : (
                        <Badge variant="outline">Not set</Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Appointment Type ID</span>
                      {data.configuration.appointmentTypeId ? (
                        <Badge variant="default">{data.configuration.appointmentTypeId}</Badge>
                      ) : data.autoDetection.appointmentType ? (
                        <Badge variant="outline">Auto-detected</Badge>
                      ) : (
                        <Badge variant="outline">Not set</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Auto-Detection Results */}
            {data.autoDetection.attempted && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    Auto-Detection Results
                  </CardTitle>
                  <CardDescription>
                    Automatically detected configuration from Cliniko
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {data.autoDetection.business && (
                    <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium">Business</span>
                      </div>
                      <div className="ml-6 space-y-1">
                        <p className="text-sm">{data.autoDetection.business.name}</p>
                        <p className="text-xs text-muted-foreground">ID: {data.autoDetection.business.id}</p>
                        <p className="text-xs text-muted-foreground">{data.autoDetection.business.note}</p>
                      </div>
                    </div>
                  )}

                  {data.autoDetection.practitioner && (
                    <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium">Practitioner</span>
                      </div>
                      <div className="ml-6 space-y-1">
                        <p className="text-sm">{data.autoDetection.practitioner.name}</p>
                        <p className="text-xs text-muted-foreground">ID: {data.autoDetection.practitioner.id}</p>
                        <p className="text-xs text-muted-foreground">{data.autoDetection.practitioner.note}</p>
                      </div>
                    </div>
                  )}

                  {data.autoDetection.appointmentType && (
                    <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium">Appointment Type</span>
                      </div>
                      <div className="ml-6 space-y-1">
                        <p className="text-sm">{data.autoDetection.appointmentType.name}</p>
                        <p className="text-xs text-muted-foreground">
                          ID: {data.autoDetection.appointmentType.id} • Duration: {data.autoDetection.appointmentType.duration} min
                        </p>
                        <p className="text-xs text-muted-foreground">{data.autoDetection.appointmentType.note}</p>

                        {data.autoDetection.appointmentType.allTypes && data.autoDetection.appointmentType.allTypes.length > 1 && (
                          <details className="mt-2">
                            <summary className="text-xs text-primary cursor-pointer hover:underline">
                              View all {data.autoDetection.appointmentType.allTypes.length} appointment types
                            </summary>
                            <div className="mt-2 space-y-1">
                              {data.autoDetection.appointmentType.allTypes.map((type) => (
                                <div key={type.id} className="text-xs text-muted-foreground pl-2 border-l-2 border-muted">
                                  {type.name} ({type.duration}min) - {type.id}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Connectivity Status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="h-5 w-5" />
                  Connectivity Test
                </CardTitle>
                <CardDescription>
                  Cliniko API connection status
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.connectivity.ok ? (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertTitle className="text-green-600">Connected</AlertTitle>
                    <AlertDescription>
                      Successfully connected to Cliniko API
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertTitle>Connection Failed</AlertTitle>
                    <AlertDescription>
                      {data.connectivity.reason || "Unknown error"}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Availability Test */}
            {data.availabilityTest.attempted && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Availability Test
                  </CardTitle>
                  <CardDescription>
                    Test fetching appointment slots from Cliniko
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {data.availabilityTest.ok ? (
                    <Alert>
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <AlertTitle className="text-green-600">
                        {data.availabilityTest.slotsFound} slots found
                      </AlertTitle>
                      <AlertDescription>
                        Successfully fetched appointment availability from Cliniko
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert variant="destructive">
                      <XCircle className="h-4 w-4" />
                      <AlertTitle>Availability Fetch Failed</AlertTitle>
                      <AlertDescription>
                        {data.availabilityTest.reason || "Unknown error"}
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Recommendations */}
            {data.recommendations && data.recommendations.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5" />
                    Recommendations
                  </CardTitle>
                  <CardDescription>
                    Suggested actions to improve your configuration
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {data.recommendations.map((rec, idx) => {
                      const isSuccess = rec.startsWith("✅");
                      const isWarning = rec.startsWith("⚠️") || rec.startsWith("❌");
                      const isInfo = rec.startsWith("💡");

                      return (
                        <li key={idx} className="flex gap-3">
                          {isSuccess && <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />}
                          {isWarning && <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />}
                          {isInfo && <Lightbulb className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />}
                          {!isSuccess && !isWarning && !isInfo && (
                            <div className="h-5 w-5 flex-shrink-0" />
                          )}
                          <span className="text-sm leading-relaxed">{rec}</span>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Quick Links */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Links</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-3 flex-wrap">
            <Link href="/settings">
              <Button variant="outline" size="sm">
                Configure Settings
              </Button>
            </Link>
            <Link href="/calls">
              <Button variant="outline" size="sm">
                View Call Logs
              </Button>
            </Link>
            <Link href="/alerts">
              <Button variant="outline" size="sm">
                View Alerts
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
