/**
 * Speech parsing utilities
 * Helps parse spoken input into structured data
 */

/**
 * Parse a spelled out email address from speech
 * Handles common patterns like "john at gmail dot com" or "j o h n at g mail dot com"
 */
export function parseSpelledEmail(speech: string): string {
  let email = speech.toLowerCase().trim();

  // Replace common spoken patterns
  email = email
    // Handle "at" symbol
    .replace(/\s+at\s+/g, '@')
    .replace(/\s+@\s+/g, '@')
    // Handle "dot"
    .replace(/\s+dot\s+/g, '.')
    .replace(/\s+period\s+/g, '.')
    .replace(/\s+point\s+/g, '.')
    // Handle common domains spoken as words
    .replace(/g\s*mail/g, 'gmail')
    .replace(/hot\s*mail/g, 'hotmail')
    .replace(/out\s*look/g, 'outlook')
    .replace(/yahoo/g, 'yahoo')
    .replace(/i\s*cloud/g, 'icloud')
    // Handle spelled out letters (remove spaces between single letters)
    .replace(/\b([a-z])\s+(?=[a-z]\b)/g, '$1')
    // Remove extra spaces
    .replace(/\s+/g, '')
    // Handle common mishearings
    .replace(/bee/g, 'b')
    .replace(/see/g, 'c')
    .replace(/dee/g, 'd')
    .replace(/gee/g, 'g')
    .replace(/jay/g, 'j')
    .replace(/kay/g, 'k')
    .replace(/pee/g, 'p')
    .replace(/cue/g, 'q')
    .replace(/are/g, 'r')
    .replace(/tee/g, 't')
    .replace(/you/g, 'u')
    .replace(/vee/g, 'v')
    .replace(/double\s*you/g, 'w')
    .replace(/doubleyou/g, 'w')
    .replace(/ex/g, 'x')
    .replace(/why/g, 'y')
    .replace(/zee/g, 'z')
    .replace(/zed/g, 'z')
    // Numbers
    .replace(/zero/g, '0')
    .replace(/one/g, '1')
    .replace(/two/g, '2')
    .replace(/three/g, '3')
    .replace(/four/g, '4')
    .replace(/five/g, '5')
    .replace(/six/g, '6')
    .replace(/seven/g, '7')
    .replace(/eight/g, '8')
    .replace(/nine/g, '9');

  // Ensure we have an @ symbol
  if (!email.includes('@')) {
    // Try to find a likely domain split point
    const domainPatterns = ['gmail', 'hotmail', 'outlook', 'yahoo', 'icloud'];
    for (const domain of domainPatterns) {
      const idx = email.indexOf(domain);
      if (idx > 0) {
        email = email.slice(0, idx) + '@' + email.slice(idx);
        break;
      }
    }
  }

  // Ensure we have a TLD
  if (email.includes('@') && !email.includes('.')) {
    // Common domain completions
    if (email.endsWith('gmail') || email.endsWith('hotmail') || email.endsWith('outlook') || email.endsWith('yahoo') || email.endsWith('icloud')) {
      email += '.com';
    }
  }

  return email;
}

/**
 * Parse a phone number from speech
 * Handles various spoken formats
 */
export function parseSpokenPhone(speech: string): string {
  let phone = speech.toLowerCase().trim();

  // Replace spoken numbers
  phone = phone
    .replace(/zero/g, '0')
    .replace(/oh/g, '0')
    .replace(/one/g, '1')
    .replace(/two/g, '2')
    .replace(/to/g, '2')
    .replace(/too/g, '2')
    .replace(/three/g, '3')
    .replace(/four/g, '4')
    .replace(/for/g, '4')
    .replace(/five/g, '5')
    .replace(/six/g, '6')
    .replace(/seven/g, '7')
    .replace(/eight/g, '8')
    .replace(/ate/g, '8')
    .replace(/nine/g, '9')
    // Handle doubles/triples
    .replace(/double\s*(\d)/g, '$1$1')
    .replace(/triple\s*(\d)/g, '$1$1$1')
    // Remove non-digits
    .replace(/[^\d+]/g, '');

  // Format as Australian number if it looks like one
  if (phone.startsWith('0') && phone.length === 10) {
    phone = '+61' + phone.slice(1);
  } else if (phone.startsWith('4') && phone.length === 9) {
    phone = '+614' + phone.slice(1);
  } else if (!phone.startsWith('+') && phone.length >= 9) {
    phone = '+61' + phone;
  }

  return phone;
}
