import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarChart3, Search, TrendingUp, TrendingDown, Minus, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";

interface QAReport {
  id: number;
  callSid: string;
  callLogId: number;
  identityDetectionScore: number;
  patientClassificationScore: number;
  emailCaptureScore: number;
  appointmentTypeScore: number;
  promptClarityScore: number;
  overallScore: number;
  issues: Array<{
    issue: string;
    cause: string;
    locationInTranscript: string;
    recommendedFix: string;
  }>;
  createdAt: string;
}

export default function QAReports() {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: reports, isLoading } = useQuery<QAReport[]>({
    queryKey: ["/api/qa/reports"],
  });

  const filteredReports = reports?.filter((report) => {
    const search = searchTerm.toLowerCase();
    return (
      report.callSid.toLowerCase().includes(search) ||
      report.callLogId.toString().includes(search)
    );
  });

  // Calculate stats
  const avgOverallScore = reports?.length
    ? (reports.reduce((sum, r) => sum + r.overallScore, 0) / reports.length).toFixed(1)
    : "0.0";

  const highQualityCount = reports?.filter(r => r.overallScore >= 8).length ?? 0;
  const lowQualityCount = reports?.filter(r => r.overallScore < 6).length ?? 0;

  const getScoreBadge = (score: number) => {
    if (score >= 9) return { variant: "default" as const, label: "Excellent" };
    if (score >= 7) return { variant: "secondary" as const, label: "Good" };
    if (score >= 5) return { variant: "outline" as const, label: "Fair" };
    return { variant: "destructive" as const, label: "Poor" };
  };

  const getTrendIcon = (score: number) => {
    if (score >= 8) return <TrendingUp className="h-4 w-4 text-green-600" />;
    if (score >= 6) return <Minus className="h-4 w-4 text-yellow-600" />;
    return <TrendingDown className="h-4 w-4 text-red-600" />;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
                <BarChart3 className="h-6 w-6" />
                QA Reports
              </h1>
              <p className="text-sm text-muted-foreground">
                Quality assurance analysis for all completed calls
              </p>
            </div>
            <Link href="/">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by Call SID or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Reports
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{reports?.length ?? 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Average Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{avgOverallScore}/10</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                High Quality
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{highQualityCount}</div>
              <p className="text-xs text-muted-foreground mt-1">Score ≥ 8/10</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Needs Improvement
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{lowQualityCount}</div>
              <p className="text-xs text-muted-foreground mt-1">Score &lt; 6/10</p>
            </CardContent>
          </Card>
        </div>

        {/* Reports Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              All Reports ({filteredReports?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-pulse text-sm text-muted-foreground">Loading reports...</div>
              </div>
            ) : !filteredReports || filteredReports.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 space-y-3">
                <BarChart3 className="h-12 w-12 text-muted-foreground" />
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">No QA reports found</p>
                  <p className="text-xs text-muted-foreground">
                    {searchTerm ? "Try adjusting your search" : "Reports will appear after calls are transcribed"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Call</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Overall</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Identity</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Classification</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Email</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Appt Type</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Clarity</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Issues</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReports.map((report) => {
                      const scoreBadge = getScoreBadge(report.overallScore);

                      return (
                        <tr key={report.id} className="border-b hover:bg-muted/50">
                          <td className="py-3 px-4">
                            <div className="space-y-1">
                              <div className="font-mono text-xs text-muted-foreground">
                                #{report.callLogId}
                              </div>
                              <div className="font-mono text-xs truncate max-w-[120px]" title={report.callSid}>
                                {report.callSid.slice(-8)}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              {getTrendIcon(report.overallScore)}
                              <Badge variant={scoreBadge.variant}>
                                {report.overallScore}/10
                              </Badge>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-sm">{report.identityDetectionScore}/10</td>
                          <td className="py-3 px-4 text-sm">{report.patientClassificationScore}/10</td>
                          <td className="py-3 px-4 text-sm">{report.emailCaptureScore}/10</td>
                          <td className="py-3 px-4 text-sm">{report.appointmentTypeScore}/10</td>
                          <td className="py-3 px-4 text-sm">{report.promptClarityScore}/10</td>
                          <td className="py-3 px-4">
                            <Badge variant={report.issues.length > 0 ? "destructive" : "secondary"}>
                              {report.issues.length}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Link href={`/calls/${report.callLogId}`}>
                              <Button variant="ghost" size="sm">
                                View Call
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
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
