// Quick test of SSML unescape function
import { unescapeSSMLInTwiml } from './server/utils/voice-constants.ts';

const escapedTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Olivia-Neural">&lt;speak&gt;&lt;prosody pitch="+5%"&gt;Hi!&lt;/prosody&gt; &lt;break time="300ms"/&gt; World&lt;/speak&gt;</Say></Response>`;

console.log('Input (escaped):');
console.log(escapedTwiml);
console.log('\n');

const unescaped = unescapeSSMLInTwiml(escapedTwiml);

console.log('Output (unescaped):');
console.log(unescaped);
console.log('\n');

const hasRawSSML = unescaped.includes('<speak>') && unescaped.includes('<break');
const hasEscaped = unescaped.includes('&lt;speak&gt;') || unescaped.includes('&lt;break');

console.log(`Has raw SSML tags: ${hasRawSSML}`);
console.log(`Has escaped tags: ${hasEscaped}`);
console.log(`✅ SSML unescape ${hasRawSSML && !hasEscaped ? 'WORKS' : 'FAILED'}`);
