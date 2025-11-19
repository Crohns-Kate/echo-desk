const CLINIKO_NEW_PATIENT_APPT_TYPE_ID = process.env.CLINIKO_NEW_PATIENT_APPT_TYPE_ID;
const CLINIKO_APPT_TYPE_ID = process.env.CLINIKO_APPT_TYPE_ID;

console.log('\n=== Environment Variable Verification ===\n');
console.log('Standard Appointment Type ID:');
console.log(`  CLINIKO_APPT_TYPE_ID = ${CLINIKO_APPT_TYPE_ID}`);
console.log(`  Expected: 1797514429433128673`);
console.log(`  Status: ${CLINIKO_APPT_TYPE_ID === '1797514429433128673' ? '✅ CORRECT' : '❌ INCORRECT'}`);

console.log('\nNew Patient Appointment Type ID:');
console.log(`  CLINIKO_NEW_PATIENT_APPT_TYPE_ID = ${CLINIKO_NEW_PATIENT_APPT_TYPE_ID || 'NOT SET'}`);
console.log(`  Expected: 1797514429785450210`);
console.log(`  Status: ${CLINIKO_NEW_PATIENT_APPT_TYPE_ID === '1797514429785450210' ? '✅ CORRECT' : '❌ INCORRECT'}`);

console.log('\n=== What the App Will Use ===\n');
const effectiveNewPatientId = CLINIKO_NEW_PATIENT_APPT_TYPE_ID || CLINIKO_APPT_TYPE_ID;
console.log(`New Patient Appointments will use: ${effectiveNewPatientId}`);

if (effectiveNewPatientId === '1797514429785450210') {
  console.log('✅ SUCCESS: New patients will get "First Appointment" (45 min)');
} else {
  console.log('❌ WARNING: New patients will get "Standard Appointment" (30 min)');
}

console.log('\n');
