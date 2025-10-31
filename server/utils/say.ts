import twilio from 'twilio';
import { env } from './env';

export const PRIMARY_VOICE = env.PRIMARY_VOICE;

export function say(node: any, text: string) {
  node.say({ voice: PRIMARY_VOICE, language: 'en-AU' }, text);
}

export function saySSML(node: any, ssml: string) {
  const s = ssml.trim().startsWith('<speak') ? ssml : `<speak>${ssml}</speak>`;
  node.say({ voice: PRIMARY_VOICE, language: 'en-AU' }, s);
}

export function gather(vr: twilio.twiml.VoiceResponse, actionUrl: string) {
  return vr.gather({
    input: 'speech',
    language: 'en-AU',
    timeout: '5',
    speechTimeout: 'auto',
    actionOnEmptyResult: 'true',
    bargeIn: 'true',
    action: actionUrl,
    method: 'POST',
  } as any);
}
