import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, Clock, MapPin, User, Mail, ArrowLeft, Download, Play, AlertCircle } from "lucide-react";
import type { CallLog } from "@shared/schema";

export default function CallDetail() {
  const [, params] = useRoute("/calls/:id");
  const callId = params?.id;

  const { data: call, isLoading } = useQuery<CallLog>({
    queryKey: ["/api/calls", callId],
    enabled: !!callId,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-sm text-muted-foreground">Loading call details...</div>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <Phone className="h-12 w-12 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Call not found</p>
          <Link href="/calls">
            <Button variant="outline">Back to Calls</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/calls">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-foreground">Call Details</h1>
            <p className="text-sm text-muted-foreground font-mono mt-1" data-testid="text-call-sid">
              {call.callSid || `Call #${call.id}`}
            </p>
          </div>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Metadata */}
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Call Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <dt className="text-xs font-medium text-muted-foreground">From Number</dt>
                  <dd className="font-mono text-sm" data-testid="text-from-number">{call.fromNumber}</dd>
                </div>

                <div className="space-y-2">
                  <dt className="text-xs font-medium text-muted-foreground">To Number</dt>
                  <dd className="font-mono text-sm" data-testid="text-to-number">{call.toNumber}</dd>
                </div>

                <div className="space-y-2">
                  <dt className="text-xs font-medium text-muted-foreground">Intent</dt>
                  <dd>
                    {call.intent ? (
                      <Badge variant="secondary" data-testid="badge-intent">{call.intent}</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">Not detected</span>
                    )}
                  </dd>
                </div>

                <div className="space-y-2">
                  <dt className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Timestamp
                  </dt>
                  <dd className="text-sm" data-testid="text-timestamp">
                    {new Date(call.createdAt!).toLocaleString('en-AU', {
                      timeZone: 'Australia/Brisbane',
                      dateStyle: 'full',
                      timeStyle: 'long',
                    })}
                  </dd>
                </div>

                {call.duration && (
                  <div className="space-y-2">
                    <dt className="text-xs font-medium text-muted-foreground">Duration</dt>
                    <dd className="text-sm" data-testid="text-duration">
                      {Math.floor(call.duration / 60)} minutes {call.duration % 60} seconds
                    </dd>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recording Player - ALWAYS SHOWN */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span>Call Recording</span>
                  <div className="flex items-center gap-2">
                    {call.recordingSid && call.recordingStatus && (
                      <Badge variant="outline" className="text-xs" data-testid="badge-recording-status">
                        {call.recordingStatus}
                      </Badge>
                    )}
                    {!call.recordingSid && (
                      <Badge variant="secondary" className="text-xs">
                        Not Available
                      </Badge>
                    )}
                    {call.recordingSid && (
                      <a
                        href={`/api/recordings/${call.recordingSid}/download`}
                        download
                      >
                        <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-download-recording">
                          <Download className="h-4 w-4" />
                        </Button>
                      </a>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {call.recordingSid ? (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div className="font-mono" data-testid="text-recording-sid">
                        Recording SID: {call.recordingSid}
                      </div>
                      {call.duration && (
                        <div data-testid="text-recording-duration">
                          Duration: {Math.floor(call.duration / 60).toString().padStart(2, '0')}:{(call.duration % 60).toString().padStart(2, '0')}
                        </div>
                      )}
                      {call.recordingUrl && (
                        <div className="truncate" data-testid="text-recording-url">
                          URL: {call.recordingUrl}
                        </div>
                      )}
                    </div>
                    {call.recordingStatus === 'completed' && (
                      <audio
                        controls
                        className="w-full"
                        data-testid="audio-player"
                        src={`/api/recordings/${call.recordingSid}/stream`}
                      >
                        Your browser does not support the audio element.
                      </audio>
                    )}
                    {call.recordingStatus === 'in-progress' && (
                      <div className="text-xs text-muted-foreground italic">
                        Recording in progress...
                      </div>
                    )}
                    {call.recordingStatus === 'failed' && (
                      <div className="text-xs text-red-500">
                        Recording failed
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-4 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900 rounded-lg">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
                        <div className="space-y-2 text-sm">
                          <p className="font-medium text-yellow-900 dark:text-yellow-100">
                            Recording Not Available
                          </p>
                          <p className="text-yellow-800 dark:text-yellow-200">
                            This call was not recorded. This usually happens when:
                          </p>
                          <ul className="list-disc list-inside space-y-1 text-yellow-700 dark:text-yellow-300 ml-2">
                            <li>Recording was disabled in environment settings</li>
                            <li>The PUBLIC_BASE_URL is incorrect in Replit Secrets</li>
                            <li>Twilio couldn't reach the webhook callback URL</li>
                          </ul>
                          <div className="mt-3 pt-3 border-t border-yellow-200 dark:border-yellow-900">
                            <p className="font-medium text-yellow-900 dark:text-yellow-100 mb-2">
                              How to fix:
                            </p>
                            <ol className="list-decimal list-inside space-y-1 text-yellow-700 dark:text-yellow-300 ml-2 text-xs">
                              <li>Open Replit Secrets (🔒 icon in sidebar)</li>
                              <li>Check PUBLIC_BASE_URL - it should be your app URL</li>
                              <li>Delete or fix any incorrect values</li>
                              <li>Restart your application</li>
                              <li>Make a new test call</li>
                            </ol>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Transcript & Summary */}
          <div className="lg:col-span-2 space-y-6">
            {call.summary && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed" data-testid="text-summary">{call.summary}</p>
                </CardContent>
              </Card>
            )}

            {/* Transcript Section - ALWAYS SHOWN */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span>Transcript</span>
                  {call.transcript && (
                    <Button variant="outline" size="sm" data-testid="button-download-transcript">
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {call.transcript ? (
                  <div className="space-y-3" data-testid="transcript-container">
                    <div className="bg-muted/50 rounded-md p-3 space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">Transcript</div>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">
                        {call.transcript}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <div className="flex flex-col items-center justify-center space-y-3 text-center py-8">
                      <Phone className="h-12 w-12 text-muted-foreground" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium">No transcript available</p>
                        <p className="text-xs text-muted-foreground max-w-md">
                          {call.recordingSid
                            ? "Transcription was not enabled or is still processing. Check back in a few minutes."
                            : "No recording was created for this call, so transcription is not available."
                          }
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
