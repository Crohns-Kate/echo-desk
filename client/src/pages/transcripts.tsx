import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Search, ArrowLeft, Clock, Phone } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import type { CallLog } from "@shared/schema";

export default function Transcripts() {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: calls, isLoading } = useQuery<CallLog[]>({
    queryKey: ["/api/calls"],
  });

  // Filter only calls with transcripts
  const callsWithTranscripts = calls?.filter(call => call.transcript && call.transcript.trim().length > 0);

  const filteredCalls = callsWithTranscripts?.filter((call) => {
    const search = searchTerm.toLowerCase();
    return (
      call.fromNumber?.toLowerCase().includes(search) ||
      call.transcript?.toLowerCase().includes(search) ||
      call.callSid?.toLowerCase().includes(search) ||
      call.summary?.toLowerCase().includes(search)
    );
  });

  const truncateTranscript = (text: string, maxLength: number = 200) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...";
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
                <FileText className="h-6 w-6" />
                Call Transcripts
              </h1>
              <p className="text-sm text-muted-foreground">
                Full text transcriptions of recorded calls
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
              placeholder="Search transcripts by content, phone number, or Call SID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Transcripts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{callsWithTranscripts?.length ?? 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Avg Words/Call
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {callsWithTranscripts?.length
                  ? Math.round(
                      callsWithTranscripts.reduce((sum, c) => sum + (c.transcript?.split(/\s+/).length ?? 0), 0) /
                      callsWithTranscripts.length
                    )
                  : 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Search Results
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{filteredCalls?.length ?? 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Transcripts List */}
        <div className="space-y-4">
          {isLoading ? (
            <Card>
              <CardContent className="p-8">
                <div className="flex items-center justify-center">
                  <div className="animate-pulse text-sm text-muted-foreground">Loading transcripts...</div>
                </div>
              </CardContent>
            </Card>
          ) : !filteredCalls || filteredCalls.length === 0 ? (
            <Card>
              <CardContent className="p-12">
                <div className="flex flex-col items-center justify-center space-y-3">
                  <FileText className="h-16 w-16 text-muted-foreground" />
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium">No transcripts found</p>
                    <p className="text-xs text-muted-foreground">
                      {searchTerm
                        ? "Try adjusting your search terms"
                        : "Transcripts will appear here after calls are transcribed"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            filteredCalls.map((call) => (
              <Card key={call.id} className="hover-elevate">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <span className="font-mono text-sm font-medium">{call.fromNumber}</span>
                        {call.intent && (
                          <Badge variant="secondary">{call.intent}</Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          <FileText className="h-3 w-3 mr-1" />
                          {call.transcript?.split(/\s+/).length ?? 0} words
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>
                          {new Date(call.createdAt!).toLocaleString('en-AU', {
                            timeZone: 'Australia/Brisbane',
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </span>
                        {call.duration && (
                          <span>• {Math.floor(call.duration / 60)}m {call.duration % 60}s</span>
                        )}
                      </div>
                    </div>
                    <Link href={`/calls/${call.id}`}>
                      <Button variant="outline" size="sm">
                        View Full Call
                      </Button>
                    </Link>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {call.summary && (
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Summary</p>
                        <p className="text-sm">{call.summary}</p>
                      </div>
                    )}
                    <div className="bg-background border rounded-lg p-4">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Transcript</p>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {truncateTranscript(call.transcript!, 300)}
                      </p>
                      {call.transcript && call.transcript.length > 300 && (
                        <Link href={`/calls/${call.id}`}>
                          <Button variant="link" size="sm" className="mt-2 px-0 h-auto">
                            Read full transcript →
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
