// Quick script to verify PUBLIC_BASE_URL
console.log('PUBLIC_BASE_URL =', process.env.PUBLIC_BASE_URL);

const expected = 'https://echo-desk-mbjltd70.replit.app';
if (process.env.PUBLIC_BASE_URL === expected) {
  console.log('✅ PUBLIC_BASE_URL is CORRECT!');
} else {
  console.log('❌ PUBLIC_BASE_URL is WRONG!');
  console.log('   Expected:', expected);
  console.log('   Got:', process.env.PUBLIC_BASE_URL);
}
