import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Phone, Clock, Download } from "lucide-react";
import { Link } from "wouter";
import type { CallLog } from "@shared/schema";

export default function Calls() {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: calls, isLoading } = useQuery<CallLog[]>({
    queryKey: ["/api/calls"],
  });

  const { data: qaReports } = useQuery<any[]>({
    queryKey: ["/api/qa/reports"],
  });

  // Map QA reports by callSid for quick lookup
  const qaReportMap = qaReports?.reduce((acc, report) => {
    acc[report.callSid] = report;
    return acc;
  }, {} as Record<string, any>) || {};

  const filteredCalls = calls?.filter((call) => {
    const search = searchTerm.toLowerCase();
    return (
      call.fromNumber?.toLowerCase().includes(search) ||
      call.intent?.toLowerCase().includes(search) ||
      call.summary?.toLowerCase().includes(search)
    );
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-foreground">Call History</h1>
              <p className="text-sm text-muted-foreground">
                Complete log of all voice interactions
              </p>
            </div>
            <Link href="/">
              <Button variant="outline" data-testid="button-back-dashboard">
                Back to Dashboard
              </Button>
            </Link>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by phone number, intent, or summary..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search"
            />
          </div>
        </div>

        {/* Calls Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              All Calls ({filteredCalls?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-pulse text-sm text-muted-foreground">Loading calls...</div>
              </div>
            ) : !filteredCalls || filteredCalls.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 space-y-3">
                <Phone className="h-12 w-12 text-muted-foreground" />
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">No calls found</p>
                  <p className="text-xs text-muted-foreground">
                    {searchTerm ? "Try adjusting your search" : "Calls will appear here once received"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Timestamp</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">From</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Intent</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Duration</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">QA</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCalls.map((call) => (
                      <tr 
                        key={call.id} 
                        className="border-b hover-elevate" 
                        data-testid={`row-call-${call.id}`}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className="font-mono text-xs" data-testid={`text-timestamp-${call.id}`}>
                              {new Date(call.createdAt!).toLocaleString('en-AU', {
                                timeZone: 'Australia/Brisbane',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono text-sm" data-testid={`text-from-${call.id}`}>
                            {call.fromNumber}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {call.intent ? (
                            <Badge variant="secondary" data-testid={`badge-intent-${call.id}`}>
                              {call.intent}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-sm" data-testid={`text-duration-${call.id}`}>
                            {call.duration
                              ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s`
                              : "—"
                            }
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {call.callSid && qaReportMap[call.callSid] ? (
                            <Badge
                              variant={
                                qaReportMap[call.callSid].overallScore >= 8 ? "default" :
                                qaReportMap[call.callSid].overallScore >= 6 ? "secondary" :
                                "destructive"
                              }
                              className="text-xs"
                            >
                              {qaReportMap[call.callSid].overallScore}/10
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            {call.recordingSid && (
                              <Badge
                                variant={call.recordingStatus === 'completed' ? 'default' : 'outline'}
                                className="text-xs"
                                data-testid={`badge-recording-${call.id}`}
                              >
                                {call.recordingStatus === 'completed' ? 'Recorded' :
                                 call.recordingStatus === 'in-progress' ? 'Recording...' :
                                 call.recordingStatus === 'failed' ? 'Rec Failed' : 'Recording'}
                              </Badge>
                            )}
                            {call.transcript && (
                              <Badge variant="outline" className="text-xs">
                                Transcribed
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-2">
                            <Link href={`/calls/${call.id}`}>
                              <Button variant="ghost" size="sm" data-testid={`button-view-${call.id}`}>
                                View
                              </Button>
                            </Link>
                            {call.transcript && (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8"
                                data-testid={`button-download-${call.id}`}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
