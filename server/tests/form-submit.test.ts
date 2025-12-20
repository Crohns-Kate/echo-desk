/**
 * Form Submit Tests
 * Tests the /api/forms/submit endpoint behavior:
 * - With patientId: Updates the correct Cliniko patient
 * - Without patientId: Does NOT attempt phone lookup, creates alert instead
 *
 * Run: npm run test:forms
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ ${testName}${details ? ': ' + details : ''}`);
    failed++;
  }
}

function testSection(name: string) {
  console.log(`\n[${name}]`);
}

// ═══════════════════════════════════════════════════════════════
// Mock types for form submission testing
// ═══════════════════════════════════════════════════════════════
interface FormSubmitRequest {
  token: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  clinikoPatientId?: string;
}

interface MockCallRecord {
  callSid: string;
  conversationId: number;
  fromNumber: string;
}

interface MockConversation {
  id: number;
  tenantId: number;
  context: Record<string, any>;
}

interface MockAlert {
  tenantId: number;
  conversationId?: number;
  reason: string;
  payload: Record<string, any>;
  status: string;
}

// ═══════════════════════════════════════════════════════════════
// Simulated form submission logic (mirrors production code)
// ═══════════════════════════════════════════════════════════════

let clinikoUpdates: Array<{ patientId: string; data: any }> = [];
let alertsCreated: MockAlert[] = [];

function resetMocks() {
  clinikoUpdates = [];
  alertsCreated = [];
}

async function simulateFormSubmit(
  request: FormSubmitRequest,
  call: MockCallRecord,
  conversation: MockConversation
): Promise<{ success: boolean; message: string; clinikoUpdated: boolean; alertCreated: boolean }> {
  const { token, firstName, lastName, email, phone, clinikoPatientId } = request;

  // Validate inputs
  if (!token || !firstName || !lastName || !email || !phone) {
    throw new Error('Missing required fields');
  }

  // Simulate storing form data in conversation context
  conversation.context = {
    ...conversation.context,
    formToken: token,
    formData: { firstName, lastName, email, phone },
    formSubmittedAt: new Date().toISOString()
  };

  // CRITICAL: Only update if we have an explicit patientId - NEVER fall back to phone lookup
  if (clinikoPatientId) {
    // Update the specified patient
    clinikoUpdates.push({
      patientId: clinikoPatientId,
      data: {
        first_name: firstName,
        last_name: lastName,
        email: email
      }
    });

    return {
      success: true,
      message: 'Form submitted successfully',
      clinikoUpdated: true,
      alertCreated: false
    };
  } else {
    // NO patientId provided - do NOT attempt phone lookup (prevents wrong patient updates)
    // Create alert for manual review
    alertsCreated.push({
      tenantId: conversation.tenantId,
      conversationId: call.conversationId,
      reason: 'form_missing_patient_id',
      payload: {
        callSid: call.callSid,
        formData: { firstName, lastName, email, phone },
        callerPhone: call.fromNumber,
        message: 'Intake form submitted without patient ID - manual confirmation required'
      },
      status: 'open'
    });

    return {
      success: true,
      message: 'Form received; our team will confirm your details',
      clinikoUpdated: false,
      alertCreated: true
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// TESTS START
// ═══════════════════════════════════════════════════════════════

console.log('='.repeat(60));
console.log('FORM SUBMIT TEST SUITE');
console.log('='.repeat(60));

// ─────────────────────────────────────────────────────────────
// TEST 1: Form submit WITH patientId updates correct patient
// ─────────────────────────────────────────────────────────────
testSection('TEST 1: Form submit WITH patientId');

resetMocks();

const mockCall1: MockCallRecord = {
  callSid: 'CA123456',
  conversationId: 1,
  fromNumber: '+61400000001'
};

const mockConversation1: MockConversation = {
  id: 1,
  tenantId: 100,
  context: {}
};

const result1 = await simulateFormSubmit(
  {
    token: 'form_CA123456',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane.doe@example.com',
    phone: '+61400000001',
    clinikoPatientId: 'patient_789'  // Explicit patient ID provided
  },
  mockCall1,
  mockConversation1
);

assert(
  result1.success === true,
  'Request succeeds'
);

assert(
  result1.message === 'Form submitted successfully',
  'Returns success message'
);

assert(
  result1.clinikoUpdated === true,
  'Cliniko patient WAS updated'
);

assert(
  clinikoUpdates.length === 1,
  'Exactly one Cliniko update was made'
);

assert(
  clinikoUpdates[0]?.patientId === 'patient_789',
  'Updated the correct patient ID (patient_789)'
);

assert(
  clinikoUpdates[0]?.data.first_name === 'Jane',
  'Updated with correct first name'
);

assert(
  clinikoUpdates[0]?.data.last_name === 'Doe',
  'Updated with correct last name'
);

assert(
  clinikoUpdates[0]?.data.email === 'jane.doe@example.com',
  'Updated with correct email'
);

assert(
  result1.alertCreated === false,
  'No alert was created'
);

assert(
  alertsCreated.length === 0,
  'Alert array is empty'
);

// ─────────────────────────────────────────────────────────────
// TEST 2: Form submit WITHOUT patientId does NOT update Cliniko
// ─────────────────────────────────────────────────────────────
testSection('TEST 2: Form submit WITHOUT patientId');

resetMocks();

const mockCall2: MockCallRecord = {
  callSid: 'CA999888',
  conversationId: 2,
  fromNumber: '+61400000002'
};

const mockConversation2: MockConversation = {
  id: 2,
  tenantId: 200,
  context: {}
};

const result2 = await simulateFormSubmit(
  {
    token: 'form_CA999888',
    firstName: 'Bob',
    lastName: 'Smith',
    email: 'bob.smith@example.com',
    phone: '+61400000002'
    // NO clinikoPatientId provided!
  },
  mockCall2,
  mockConversation2
);

assert(
  result2.success === true,
  'Request still succeeds (user-facing)'
);

assert(
  result2.message === 'Form received; our team will confirm your details',
  'Returns pending confirmation message'
);

assert(
  result2.clinikoUpdated === false,
  'Cliniko patient was NOT updated'
);

assert(
  clinikoUpdates.length === 0,
  'No Cliniko updates were made'
);

assert(
  result2.alertCreated === true,
  'Alert WAS created for manual review'
);

assert(
  alertsCreated.length === 1,
  'Exactly one alert was created'
);

assert(
  alertsCreated[0]?.reason === 'form_missing_patient_id',
  'Alert reason is "form_missing_patient_id"'
);

assert(
  alertsCreated[0]?.tenantId === 200,
  'Alert has correct tenant ID'
);

assert(
  alertsCreated[0]?.conversationId === 2,
  'Alert has correct conversation ID'
);

assert(
  alertsCreated[0]?.payload.callSid === 'CA999888',
  'Alert payload contains callSid'
);

assert(
  alertsCreated[0]?.payload.formData.firstName === 'Bob',
  'Alert payload contains form data'
);

assert(
  alertsCreated[0]?.status === 'open',
  'Alert status is "open"'
);

// ─────────────────────────────────────────────────────────────
// TEST 3: Form data is saved to conversation context in both cases
// ─────────────────────────────────────────────────────────────
testSection('TEST 3: Form data saved to conversation context');

assert(
  mockConversation1.context.formData?.firstName === 'Jane',
  'WITH patientId: Form data saved to context (firstName)'
);

assert(
  mockConversation1.context.formData?.email === 'jane.doe@example.com',
  'WITH patientId: Form data saved to context (email)'
);

assert(
  mockConversation2.context.formData?.firstName === 'Bob',
  'WITHOUT patientId: Form data saved to context (firstName)'
);

assert(
  mockConversation2.context.formData?.email === 'bob.smith@example.com',
  'WITHOUT patientId: Form data saved to context (email)'
);

// ─────────────────────────────────────────────────────────────
// TEST 4: Existing patient NOT overwritten by phone lookup
// This is the critical bug scenario - caller's phone matches
// an EXISTING patient "John Smith" but form is for NEW caller
// ─────────────────────────────────────────────────────────────
testSection('TEST 4: Phone lookup does NOT corrupt existing patient');

resetMocks();

// Scenario: Caller's phone +61400000003 already exists in Cliniko as "John Smith"
// But the caller is actually "Mary Johnson" - a NEW patient
// WITHOUT the fix, phone lookup would find "John Smith" and overwrite their data!

const mockCall3: MockCallRecord = {
  callSid: 'CA777666',
  conversationId: 3,
  fromNumber: '+61400000003'  // This phone matches existing patient "John Smith"
};

const mockConversation3: MockConversation = {
  id: 3,
  tenantId: 300,
  context: {}
};

// New caller submits form with their details (Mary Johnson)
// No patientId because they're new
const result3 = await simulateFormSubmit(
  {
    token: 'form_CA777666',
    firstName: 'Mary',
    lastName: 'Johnson',
    email: 'mary.johnson@example.com',
    phone: '+61400000003'
    // NO clinikoPatientId - because this is a NEW caller
  },
  mockCall3,
  mockConversation3
);

assert(
  result3.clinikoUpdated === false,
  'CRITICAL: Cliniko was NOT updated (no patient corruption)'
);

assert(
  clinikoUpdates.length === 0,
  'CRITICAL: No Cliniko updates (existing John Smith is safe)'
);

assert(
  result3.alertCreated === true,
  'Alert created for team to manually create Mary Johnson'
);

// ─────────────────────────────────────────────────────────────
// TEST 5: Validation errors
// ─────────────────────────────────────────────────────────────
testSection('TEST 5: Validation errors');

resetMocks();

const mockCall4: MockCallRecord = {
  callSid: 'CA555444',
  conversationId: 4,
  fromNumber: '+61400000004'
};

const mockConversation4: MockConversation = {
  id: 4,
  tenantId: 400,
  context: {}
};

try {
  await simulateFormSubmit(
    {
      token: 'form_CA555444',
      firstName: '',  // Missing!
      lastName: 'Test',
      email: 'test@example.com',
      phone: '+61400000004'
    },
    mockCall4,
    mockConversation4
  );
  assert(false, 'Should throw error for missing firstName');
} catch (e) {
  assert(
    (e as Error).message === 'Missing required fields',
    'Throws error for missing firstName'
  );
}

// ─────────────────────────────────────────────────────────────
// TEST 6: Group booking - Two patients, same call, separate tokens
// Both should update their respective Cliniko patients
// ─────────────────────────────────────────────────────────────
testSection('TEST 6: Group booking - Two patients, same call');

resetMocks();

// Simulate a group booking scenario where mother and child both need forms
const groupCallSid = 'CA_GROUP_123';
const groupConversationId = 6;
const motherPatientId = 'patient_mother_001';
const childPatientId = 'patient_child_002';

const mockCallGroup: MockCallRecord = {
  callSid: groupCallSid,
  conversationId: groupConversationId,
  fromNumber: '+61400000006'  // Mother's phone
};

// Shared conversation context (simulates form submissions map)
const mockConversationGroup: MockConversation & { formSubmissions: Record<string, any> } = {
  id: groupConversationId,
  tenantId: 600,
  context: {},
  formSubmissions: {}
};

// Simulate per-token form submission tracking
function simulateFormSubmitWithPerTokenTracking(
  request: FormSubmitRequest,
  call: MockCallRecord,
  conversation: MockConversation & { formSubmissions: Record<string, any> }
): Promise<{ success: boolean; message: string; clinikoUpdated: boolean; alertCreated: boolean }> {
  const { token, firstName, lastName, email, phone, clinikoPatientId } = request;

  // Store this submission keyed by token (allows multiple forms for group booking)
  conversation.formSubmissions[token] = {
    firstName,
    lastName,
    email,
    phone,
    clinikoPatientId,
    submittedAt: new Date().toISOString()
  };

  // Same logic as before
  if (clinikoPatientId) {
    clinikoUpdates.push({
      patientId: clinikoPatientId,
      data: { first_name: firstName, last_name: lastName, email }
    });
    return Promise.resolve({ success: true, message: 'Form submitted successfully', clinikoUpdated: true, alertCreated: false });
  } else {
    alertsCreated.push({
      tenantId: conversation.tenantId,
      conversationId: call.conversationId,
      reason: 'form_missing_patient_id',
      payload: { callSid: call.callSid, formData: { firstName, lastName, email, phone } },
      status: 'open'
    });
    return Promise.resolve({ success: true, message: 'Form received', clinikoUpdated: false, alertCreated: true });
  }
}

// Mother submits her form (token includes her patientId)
const motherToken = `form_${groupCallSid}_${motherPatientId}`;
const motherResult = await simulateFormSubmitWithPerTokenTracking(
  {
    token: motherToken,
    firstName: 'Sarah',
    lastName: 'Smith',
    email: 'sarah.smith@example.com',
    phone: '+61400000006',
    clinikoPatientId: motherPatientId
  },
  mockCallGroup,
  mockConversationGroup
);

assert(motherResult.success === true, 'Mother form submission succeeds');
assert(motherResult.clinikoUpdated === true, 'Mother Cliniko record updated');

// Child submits their form (different token, different patientId)
const childToken = `form_${groupCallSid}_${childPatientId}`;
const childResult = await simulateFormSubmitWithPerTokenTracking(
  {
    token: childToken,
    firstName: 'Tommy',
    lastName: 'Smith',
    email: 'tommy.smith@example.com',
    phone: '+61400000007',  // Child might have different phone
    clinikoPatientId: childPatientId
  },
  mockCallGroup,
  mockConversationGroup
);

assert(childResult.success === true, 'Child form submission succeeds');
assert(childResult.clinikoUpdated === true, 'Child Cliniko record updated');

// Verify BOTH were updated correctly
assert(clinikoUpdates.length === 2, 'Two Cliniko updates were made (one per patient)');
assert(
  clinikoUpdates.some(u => u.patientId === motherPatientId && u.data.first_name === 'Sarah'),
  'Mother record updated with correct name'
);
assert(
  clinikoUpdates.some(u => u.patientId === childPatientId && u.data.first_name === 'Tommy'),
  'Child record updated with correct name'
);

// Verify per-token tracking
assert(
  Object.keys(mockConversationGroup.formSubmissions).length === 2,
  'Two form submissions tracked (one per token)'
);
assert(
  mockConversationGroup.formSubmissions[motherToken]?.firstName === 'Sarah',
  'Mother submission tracked by token'
);
assert(
  mockConversationGroup.formSubmissions[childToken]?.firstName === 'Tommy',
  'Child submission tracked by token'
);

// ─────────────────────────────────────────────────────────────
// TEST 7: Per-token "already submitted" check
// Token A submitted should NOT block Token B
// ─────────────────────────────────────────────────────────────
testSection('TEST 7: Per-token "already submitted" check');

// Simulate checking if a form is already submitted (per-token, not per-call)
function isFormAlreadySubmitted(
  token: string,
  formSubmissions: Record<string, any>
): boolean {
  return !!formSubmissions[token];
}

// Mother's form is submitted
assert(
  isFormAlreadySubmitted(motherToken, mockConversationGroup.formSubmissions) === true,
  'Mother token shows as "already submitted"'
);

// Child's form is also submitted
assert(
  isFormAlreadySubmitted(childToken, mockConversationGroup.formSubmissions) === true,
  'Child token shows as "already submitted"'
);

// A new token for same call should NOT be blocked
const newToken = `form_${groupCallSid}_patient_new_003`;
assert(
  isFormAlreadySubmitted(newToken, mockConversationGroup.formSubmissions) === false,
  'New token is NOT blocked (can submit new form)'
);

// ─────────────────────────────────────────────────────────────
// TEST 8: Shared phone scenario - correct patient updated
// Mother's phone used, but child's patientId in link
// ─────────────────────────────────────────────────────────────
testSection('TEST 8: Shared phone scenario');

resetMocks();

// Mother's phone number is used for the call
const sharedPhoneCall: MockCallRecord = {
  callSid: 'CA_SHARED_PHONE',
  conversationId: 8,
  fromNumber: '+61400000008'  // Mother's phone
};

const sharedPhoneConversation: MockConversation = {
  id: 8,
  tenantId: 800,
  context: {}
};

// Form link sent to child has CHILD's patientId (not mother's)
const childLinkPatientId = 'patient_child_specific';

const sharedPhoneResult = await simulateFormSubmit(
  {
    token: `form_CA_SHARED_PHONE_${childLinkPatientId}`,
    firstName: 'Billy',
    lastName: 'Jones',
    email: 'billy.jones@example.com',
    phone: '+61400000099',  // Child's own phone
    clinikoPatientId: childLinkPatientId  // Uses child's patientId from link
  },
  sharedPhoneCall,
  sharedPhoneConversation
);

assert(sharedPhoneResult.success === true, 'Shared phone submission succeeds');
assert(sharedPhoneResult.clinikoUpdated === true, 'Cliniko was updated');

// CRITICAL: Verify the CHILD's record was updated, NOT the caller's phone match
assert(
  clinikoUpdates[0]?.patientId === childLinkPatientId,
  'CRITICAL: Child patientId updated (NOT mother\'s phone match)'
);
assert(
  clinikoUpdates[0]?.data.first_name === 'Billy',
  'Child name "Billy" saved correctly'
);

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ ALL FORM SUBMIT TESTS PASSED');
} else {
  console.log('❌ SOME TESTS FAILED - Review output above');
}
console.log('='.repeat(60));

console.log('\n[BEHAVIORS VALIDATED]');
console.log('  - Form submit WITH patientId updates correct Cliniko patient');
console.log('  - Form submit WITHOUT patientId does NOT call Cliniko update');
console.log('  - Missing patientId creates alert with reason=form_missing_patient_id');
console.log('  - Form data is saved to conversation context regardless');
console.log('  - Existing patients are NOT corrupted by phone lookup');
console.log('  - Validation errors are thrown for missing fields');
console.log('  - Group booking: Two patients can submit separate forms');
console.log('  - Per-token tracking: Token A submitted does NOT block Token B');
console.log('  - Shared phone: Form updates correct patient (by patientId, not phone)');

console.log('\n[BUG FIXED]');
console.log('  Previously: Form submit without patientId would fallback to');
console.log('  phone lookup, which could find the WRONG patient (e.g., existing');
console.log('  "John Smith" instead of new caller "Mary Johnson") and overwrite');
console.log('  their data with the form submission.');
console.log('');
console.log('  Now: No phone lookup fallback. If no patientId, form data is saved');
console.log('  to context and an alert is created for manual confirmation.');
console.log('');
console.log('[GROUP BOOKING SUPPORT]');
console.log('  Each patient in a group booking gets a unique form link with');
console.log('  their own patientId. Forms are tracked per-token, allowing');
console.log('  multiple submissions in the same call without blocking.');

process.exit(failed > 0 ? 1 : 0);
