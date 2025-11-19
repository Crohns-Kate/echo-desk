#!/usr/bin/env tsx
/**
 * Test script to analyze call quality for existing transcripts
 * Usage: npm run test-quality OR tsx test-quality-check.ts
 */
import { storage } from './server/storage';
import { analyzeCallQuality, storeQualityMetrics, getQualityInsights } from './server/services/communication-quality';

async function main() {
  console.log('🔍 Testing Communication Quality Analysis\n');

  try {
    // Get recent calls with transcripts
    const calls = await storage.listCalls(undefined, 10);
    const callsWithTranscripts = calls.filter(c => c.transcript && c.transcript.length > 10);

    console.log(`📞 Found ${calls.length} total calls, ${callsWithTranscripts.length} with transcripts\n`);

    if (callsWithTranscripts.length === 0) {
      console.log('❌ No calls with transcripts found. Make a test call first!');
      process.exit(0);
    }

    // Analyze the most recent call with transcript
    console.log('━'.repeat(80));
    console.log('📊 Analyzing Most Recent Call');
    console.log('━'.repeat(80) + '\n');

    const latestCall = callsWithTranscripts[0];
    console.log(`Call SID: ${latestCall.callSid}`);
    console.log(`From: ${latestCall.fromNumber}`);
    console.log(`Intent: ${latestCall.intent || 'unknown'}`);
    console.log(`Duration: ${latestCall.duration || 0}s`);
    console.log(`Transcript Length: ${latestCall.transcript?.length || 0} characters`);
    console.log(`Created: ${latestCall.createdAt}\n`);

    // Run quality analysis
    const metrics = await analyzeCallQuality(latestCall);

    if (metrics) {
      await storeQualityMetrics(metrics);

      console.log('\n' + '━'.repeat(80));
      console.log('📈 Quality Metrics Summary');
      console.log('━'.repeat(80));
      console.log(`Overall Score: ${metrics.overallScore}/100 ${getScoreEmoji(metrics.overallScore)}`);
      console.log(`Clarity Score: ${metrics.clarity}/100`);
      console.log(`Efficiency Score: ${metrics.efficiency}/100`);
      console.log(`Resolution: ${metrics.successfulResolution ? '✅ Successful' : '❌ Unsuccessful'}\n`);

      if (metrics.issues.length > 0) {
        console.log('⚠️  Issues Detected:');
        metrics.issues.forEach((issue, i) => {
          const severityIcon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
          console.log(`  ${i + 1}. ${severityIcon} [${issue.severity.toUpperCase()}] ${issue.type}`);
          console.log(`     ${issue.description}`);
        });
        console.log('');
      }

      if (metrics.suggestions.length > 0) {
        console.log('💡 Improvement Suggestions:');
        metrics.suggestions.forEach((suggestion, i) => {
          console.log(`  ${i + 1}. ${suggestion}`);
        });
        console.log('');
      }

      console.log('🔄 Conversation Flow Analysis:');
      console.log(`  Total Turns: ${metrics.conversationFlow.totalTurns}`);
      console.log(`  Intent Recognition: ${metrics.conversationFlow.intentRecognitionSuccess ? '✅' : '❌'}`);
      console.log(`  Data Collection: ${metrics.conversationFlow.dataCollectionSuccess ? '✅' : '❌'}`);
      console.log(`  Booking Success: ${metrics.conversationFlow.appointmentBookingSuccess ? '✅' : '❌'}`);
      console.log(`  Frustration: ${metrics.conversationFlow.customerSatisfactionIndicators.frustrationDetected ? '⚠️ Yes' : '✅ None detected'}`);
      console.log(`  Positive Language: ${metrics.conversationFlow.customerSatisfactionIndicators.positiveLanguage ? '✅ Yes' : '➖ Not detected'}`);
      console.log(`  Completed Successfully: ${metrics.conversationFlow.customerSatisfactionIndicators.completedSuccessfully ? '✅ Yes' : '❌ No'}`);
    }

    // Get aggregate insights
    console.log('\n' + '━'.repeat(80));
    console.log('📊 Aggregate Quality Insights (Last 50 Calls)');
    console.log('━'.repeat(80) + '\n');

    const insights = await getQualityInsights(undefined, 50);
    console.log(`Analyzed Calls: ${insights.totalCalls}`);
    console.log(`Average Quality Score: ${insights.averageScore.toFixed(1)}/100 ${getScoreEmoji(insights.averageScore)}`);
    console.log(`Success Rate: ${(insights.successRate * 100).toFixed(1)}%`);

    if (insights.commonIssues.length > 0) {
      console.log('\nMost Common Issues:');
      insights.commonIssues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue.type}: ${issue.count} occurrences`);
      });
    }

    console.log('\n' + '━'.repeat(80));
    console.log('✅ Quality Analysis Complete!');
    console.log('━'.repeat(80));

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

function getScoreEmoji(score: number): string {
  if (score >= 90) return '🌟';
  if (score >= 80) return '✅';
  if (score >= 70) return '👍';
  if (score >= 60) return '⚠️';
  return '❌';
}

main();
