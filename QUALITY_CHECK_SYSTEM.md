# Communication Quality Check System

## Overview

A comprehensive system has been added to continuously analyze and improve communication flow and logic for all call transcripts. The system automatically evaluates each call for quality, identifies issues, and provides actionable improvement suggestions.

## Features

### 1. Automatic Quality Analysis
When a call transcript is completed, the system automatically:
- Analyzes communication clarity and effectiveness
- Identifies conversation flow issues
- Detects customer frustration or satisfaction
- Provides quality scores (0-100)
- Generates improvement suggestions

### 2. Dual Analysis Approach
The system uses both:
- **AI-powered analysis** (using OpenAI GPT-4o-mini) for deep insights
- **Rule-based analysis** as a fallback for reliability

### 3. Quality Metrics Tracked

#### Overall Scores
- **Overall Quality Score** (0-100): Combined assessment of call quality
- **Clarity Score** (0-100): How clear and understandable the conversation was
- **Efficiency Score** (0-100): How concise and productive the conversation was
- **Successful Resolution**: Whether the caller's need was addressed

#### Issues Detected
- **Misunderstandings**: Instances where caller/AI didn't understand each other
- **Repetitions**: Unnecessary repeated information or apologies
- **Unclear Intent**: Failed to identify what the caller wanted
- **Escalations**: Required human operator intervention
- **Timeouts**: Call ended prematurely
- **Technical Errors**: System or API failures
- **Poor Flow**: Awkward or inefficient conversation progression

#### Conversation Flow Metrics
- Total conversation turns
- Average turn length
- Intent recognition success
- Data collection success
- Appointment booking success
- Customer satisfaction indicators:
  - Frustration detection
  - Positive language usage
  - Successful completion

## Integration Points

### 1. Automatic Analysis After Transcription
Location: `server/routes/voice.ts:332-340` and `:397-405`

When a recording is transcribed, quality analysis is automatically triggered:
```typescript
// In recording-status callback
const qualityMetrics = await analyzeCallQuality(updatedWithTranscript);
if (qualityMetrics) {
  await storeQualityMetrics(qualityMetrics);
}
```

### 2. API Endpoints

#### Get Quality Insights
```bash
GET /api/quality/insights?limit=50
```

Returns aggregate quality metrics across recent calls:
```json
{
  "averageScore": 85.3,
  "totalCalls": 25,
  "commonIssues": [
    {"type": "repetition", "count": 8},
    {"type": "unclear_intent", "count": 5}
  ],
  "successRate": 0.92
}
```

#### Analyze Specific Call
```bash
GET /api/quality/analyze/:callSid
```

Returns detailed quality metrics for a specific call:
```json
{
  "callSid": "CA1234...",
  "overallScore": 87,
  "clarity": 90,
  "efficiency": 85,
  "successfulResolution": true,
  "issues": [
    {
      "type": "repetition",
      "severity": "low",
      "description": "Excessive apologies detected"
    }
  ],
  "suggestions": [
    "Reduce repeated apologies in error handling"
  ],
  "conversationFlow": {
    "totalTurns": 12,
    "averageTurnLength": 45,
    "intentRecognitionSuccess": true,
    "dataCollectionSuccess": true,
    "appointmentBookingSuccess": true,
    "customerSatisfactionIndicators": {
      "frustrationDetected": false,
      "positiveLanguage": true,
      "completedSuccessfully": true
    }
  }
}
```

### 3. CLI Testing Tool

Test the quality analysis system on existing calls:

```bash
npm run test:quality
```

This will:
- Fetch recent calls with transcripts
- Analyze the most recent call
- Display detailed quality metrics
- Show aggregate insights across all calls
- Provide improvement suggestions

Sample output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Analyzing Most Recent Call
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Call SID: CA1234567890
From: +1234567890
Intent: book
Duration: 125s
Transcript Length: 2543 characters

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 Quality Metrics Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Overall Score: 87/100 ✅
Clarity Score: 90/100
Efficiency Score: 85/100
Resolution: ✅ Successful

💡 Improvement Suggestions:
  1. Reduce confirmation repetitions when booking appointments
  2. Streamline email collection process
```

## Configuration

### Required Environment Variables

For AI-powered analysis:
- `OPENAI_API_KEY`: OpenAI API key for GPT-4o-mini analysis
- `OPENAI_BASE_URL` (optional): Custom OpenAI-compatible endpoint

The system will automatically fall back to rule-based analysis if OpenAI is not configured.

### Existing Requirements
- `TRANSCRIPTION_ENABLED`: Must be `true` to generate transcripts
- `ASSEMBLYAI_API_KEY`: Required for transcript generation
- `CALL_RECORDING_ENABLED`: Must be `true` to record calls

## How It Works

### Automatic Flow

1. **Call Completes** → Recording starts
2. **Recording Finishes** → Transcription starts (AssemblyAI)
3. **Transcript Ready** → Quality analysis triggers automatically
4. **Analysis Complete** → Metrics logged and stored

### Analysis Process

#### AI Analysis (when OpenAI is available)
- Sends transcript to GPT-4o-mini
- Evaluates clarity, efficiency, and success
- Identifies specific issues and patterns
- Generates actionable suggestions
- Analyzes conversation flow and satisfaction

#### Rule-Based Analysis (fallback)
- Scans for frustration keywords
- Detects excessive repetitions
- Checks for operator transfers
- Validates intent recognition
- Analyzes call duration patterns

#### Combined Results
- Merges AI and rule-based insights
- Averages numerical scores
- Combines issue lists
- Aggregates suggestions

## Monitoring and Logs

All quality analysis is logged with structured output:

```
[QUALITY] 🔍 Analyzing call quality for: CA1234567890
[QUALITY] ✅ Analysis complete: {
  overallScore: 87,
  issuesFound: 2,
  suggestions: 3
}
[QUALITY] 📊 Quality Metrics Summary:
  Call: CA1234567890
  Overall Score: 87/100
  Clarity: 90/100
  Efficiency: 85/100
  Successful: ✅
  Issues Found: 2
  Issues:
    - [LOW] repetition: Excessive apologies detected
    - [MEDIUM] unclear_intent: Could not identify preferred time
  Suggestions:
    1. Improve time preference recognition
    2. Reduce repeated apologies
```

## Future Enhancements

### Planned Features
1. **Database Storage**: Store quality metrics in a dedicated table
2. **Trend Analysis**: Track quality improvements over time
3. **Dashboard Integration**: Visual quality metrics in the web UI
4. **Real-time Alerts**: Notify when quality drops below threshold
5. **A/B Testing**: Compare different conversation approaches
6. **Pattern Learning**: Automatically identify successful conversation patterns

### Integration Opportunities
- Add quality scores to call logs display
- Create quality reports for specific time periods
- Generate automated improvement recommendations
- Build training data from high-quality calls

## Files Added/Modified

### New Files
- `server/services/communication-quality.ts` - Core quality analysis service
- `test-quality-check.ts` - CLI testing tool
- `QUALITY_CHECK_SYSTEM.md` - This documentation

### Modified Files
- `server/routes/voice.ts` - Added quality analysis after transcription
- `server/routes/app.ts` - Added quality insights API endpoints
- `package.json` - Added `test:quality` script

## Usage Examples

### View Current Quality Insights
```bash
curl http://localhost:5000/api/quality/insights
```

### Analyze a Specific Call
```bash
curl http://localhost:5000/api/quality/analyze/CA1234567890abcdef
```

### Run Full Analysis Test
```bash
npm run test:quality
```

### Check Server Logs
Quality analysis is logged automatically:
```bash
# Look for [QUALITY] entries in server logs
grep "\[QUALITY\]" logs/server.log
```

## Troubleshooting

### No Quality Data Available
- Ensure calls have transcripts (check `TRANSCRIPTION_ENABLED`)
- Verify AssemblyAI is working (`ASSEMBLYAI_API_KEY`)
- Confirm recordings are enabled (`CALL_RECORDING_ENABLED`)

### Analysis Failing
- Check OpenAI API key if using AI analysis
- Review server logs for error details
- System will fall back to rule-based analysis automatically

### API Returns Empty Results
- No calls with transcripts in database yet
- Make a test call to generate data
- Check database connection

## Support

For issues or questions:
1. Check server logs for `[QUALITY]` entries
2. Run `npm run test:quality` to verify system
3. Review this documentation
4. Check API endpoints are accessible

---

**Status**: ✅ System is active and analyzing all new transcripts automatically
**Last Updated**: 2025-11-19
