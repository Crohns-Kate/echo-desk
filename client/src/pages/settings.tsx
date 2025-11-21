import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Settings as SettingsIcon, ArrowLeft, Check, X } from "lucide-react";
import { Link } from "wouter";

export default function Settings() {
  // Check environment features
  const features = {
    recording: import.meta.env.VITE_CALL_RECORDING_ENABLED === 'true',
    transcription: import.meta.env.VITE_TRANSCRIPTION_ENABLED === 'true',
    qaEngine: import.meta.env.VITE_QA_ENGINE_ENABLED !== 'false', // Default to true
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <SettingsIcon className="h-6 w-6" />
              Settings
            </h1>
            <p className="text-sm text-muted-foreground">
              System configuration and feature management
            </p>
          </div>
          <Link href="/">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>

        {/* System Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Information</CardTitle>
            <CardDescription>Current deployment and version info</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-sm font-medium">Version</span>
              <Badge variant="secondary">1.0.0-beta</Badge>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-sm font-medium">Environment</span>
              <Badge variant="outline">
                {import.meta.env.MODE === 'production' ? 'Production' : 'Development'}
              </Badge>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-sm font-medium">Timezone</span>
              <span className="text-sm text-muted-foreground">Australia/Brisbane</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm font-medium">WebSocket</span>
              <Badge variant="default">Connected</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Feature Flags */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Feature Flags</CardTitle>
            <CardDescription>Enabled features in this deployment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">Call Recording</span>
                <p className="text-xs text-muted-foreground">Record all incoming calls</p>
              </div>
              <div className="flex items-center gap-2">
                {features.recording ? (
                  <>
                    <Check className="h-4 w-4 text-green-600" />
                    <Badge variant="default">Enabled</Badge>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="outline">Disabled</Badge>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border-b">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">Transcription</span>
                <p className="text-xs text-muted-foreground">Generate text transcripts using AssemblyAI</p>
              </div>
              <div className="flex items-center gap-2">
                {features.transcription ? (
                  <>
                    <Check className="h-4 w-4 text-green-600" />
                    <Badge variant="default">Enabled</Badge>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="outline">Disabled</Badge>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">QA Engine</span>
                <p className="text-xs text-muted-foreground">Automatic quality analysis with AI</p>
              </div>
              <div className="flex items-center gap-2">
                {features.qaEngine ? (
                  <>
                    <Check className="h-4 w-4 text-green-600" />
                    <Badge variant="default">Enabled</Badge>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="outline">Disabled</Badge>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Integrations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Integrations</CardTitle>
            <CardDescription>Connected external services</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">Twilio</span>
                <p className="text-xs text-muted-foreground">Voice and SMS services</p>
              </div>
              <Badge variant="default">Connected</Badge>
            </div>

            <div className="flex items-center justify-between py-2 border-b">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">Cliniko</span>
                <p className="text-xs text-muted-foreground">Practice management system</p>
              </div>
              <Badge variant="default">Connected</Badge>
            </div>

            <div className="flex items-center justify-between py-2 border-b">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">AssemblyAI</span>
                <p className="text-xs text-muted-foreground">Speech-to-text transcription</p>
              </div>
              <Badge variant={features.transcription ? "default" : "outline"}>
                {features.transcription ? "Connected" : "Not configured"}
              </Badge>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">OpenAI</span>
                <p className="text-xs text-muted-foreground">QA analysis and AI features</p>
              </div>
              <Badge variant={features.qaEngine ? "default" : "outline"}>
                {features.qaEngine ? "Connected" : "Not configured"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Actions</CardTitle>
            <CardDescription>Maintenance and diagnostic tools</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">Cliniko Health Check</span>
                <p className="text-xs text-muted-foreground">Test Cliniko API connectivity</p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href="/__cliniko/health" target="_blank" rel="noopener noreferrer">
                  Run Test
                </a>
              </Button>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">Timezone Check</span>
                <p className="text-xs text-muted-foreground">Verify server timezone configuration</p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href="/__tz/now" target="_blank" rel="noopener noreferrer">
                  Check Time
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Documentation Links */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Documentation</CardTitle>
            <CardDescription>Guides and reference materials</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <a
              href="https://github.com/anthropics/echo-desk"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-primary hover:underline"
            >
              View on GitHub →
            </a>
            <a
              href="/docs/echo-desk-architecture.md"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-primary hover:underline"
            >
              Architecture Documentation →
            </a>
            <a
              href="/docs/echo-desk-fsm.md"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-primary hover:underline"
            >
              FSM Documentation →
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
