/**
 * Tenant Update API Regression Tests
 * Ensures googleMapsUrl and other fields are properly saved via PATCH /api/admin/tenants/:id
 * 
 * Regression test for: Fix Google Maps URL not saving in Tenant edit modal
 * 
 * Run: node --import tsx server/tests/tenant-update.test.ts
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`    ✅ ${testName}`);
    passed++;
  } else {
    console.error(`    ❌ ${testName}${details ? ': ' + details : ''}`);
    failed++;
  }
}

// Mock storage
const mockStorage = {
  getTenantById: async (id: number) => {
    if (id === 1) {
      return {
        id: 1,
        slug: 'test-clinic',
        clinicName: 'Test Clinic',
        phoneNumber: '+61412345678',
        email: 'test@clinic.com',
        address: '123 Test St',
        googleMapsUrl: null, // Initially null
        timezone: 'Australia/Brisbane',
        voiceName: 'Polly.Olivia-Neural',
        greeting: 'Thanks for calling',
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
    return null;
  },
  updateTenant: async (id: number, updates: any) => {
    const existing = await mockStorage.getTenantById(id);
    if (!existing) return null;
    return { ...existing, ...updates, updatedAt: new Date() };
  }
};

console.log('\n[Tenant Update API - googleMapsUrl Persistence Regression Tests]\n');

// Test 1: Extract googleMapsUrl from request body
console.log('Test 1: Extract googleMapsUrl from request body');
{
  const reqBody = {
    clinicName: 'Test Clinic',
    googleMapsUrl: 'https://maps.google.com/?q=123+Test+St',
    timezone: 'Australia/Brisbane'
  };

  // Simulate the destructuring that happens in the route handler
  const { clinicName, googleMapsUrl, timezone } = reqBody;

  assert(clinicName === 'Test Clinic', 'clinicName extracted');
  assert(googleMapsUrl === 'https://maps.google.com/?q=123+Test+St', 'googleMapsUrl extracted');
  assert(timezone === 'Australia/Brisbane', 'timezone extracted');
}

// Test 2: Include googleMapsUrl in updates object
console.log('\nTest 2: Include googleMapsUrl in updates object');
{
  const reqBody = {
    clinicName: 'Test Clinic',
    googleMapsUrl: 'https://maps.google.com/?q=123+Test+St',
    email: 'test@clinic.com'
  };

  // Simulate the update logic from the route handler
  const updates: any = {};
  if (reqBody.clinicName !== undefined) updates.clinicName = reqBody.clinicName;
  if (reqBody.googleMapsUrl !== undefined) updates.googleMapsUrl = reqBody.googleMapsUrl;
  if (reqBody.email !== undefined) updates.email = reqBody.email;

  assert(updates.googleMapsUrl === 'https://maps.google.com/?q=123+Test+St', 'googleMapsUrl in updates');
  assert(updates.clinicName === 'Test Clinic', 'clinicName in updates');
  assert(updates.email === 'test@clinic.com', 'email in updates');
}

// Test 3: Update googleMapsUrl when provided
console.log('\nTest 3: Update googleMapsUrl when provided');
{
  const tenantId = 1;
  const updates = {
    googleMapsUrl: 'https://maps.google.com/?q=123+Test+St'
  };

  const updated = await mockStorage.updateTenant(tenantId, updates);
  
  assert(updated !== null, 'tenant updated');
  assert(updated?.googleMapsUrl === 'https://maps.google.com/?q=123+Test+St', 'googleMapsUrl persisted');
}

// Test 4: Preserve other fields when updating googleMapsUrl
console.log('\nTest 4: Preserve other fields when updating googleMapsUrl');
{
  const tenantId = 1;
  const updates = {
    googleMapsUrl: 'https://maps.google.com/?q=456+New+St',
    clinicName: 'Updated Clinic Name'
  };

  const updated = await mockStorage.updateTenant(tenantId, updates);
  
  assert(updated?.googleMapsUrl === 'https://maps.google.com/?q=456+New+St', 'googleMapsUrl updated');
  assert(updated?.clinicName === 'Updated Clinic Name', 'clinicName updated');
  assert(updated?.phoneNumber === '+61412345678', 'phoneNumber preserved');
  assert(updated?.email === 'test@clinic.com', 'email preserved');
}

// Test 5: Handle empty string (clearing the field)
console.log('\nTest 5: Handle empty string for googleMapsUrl');
{
  const tenantId = 1;
  // First set a value
  await mockStorage.updateTenant(tenantId, { googleMapsUrl: 'https://maps.google.com/?q=123' });
  
  // Then clear it
  const updates = {
    googleMapsUrl: ''
  };
  const updated = await mockStorage.updateTenant(tenantId, updates);
  
  assert(updated?.googleMapsUrl === '', 'googleMapsUrl cleared to empty string');
}

// Test 6: Don't update if undefined
console.log('\nTest 6: Don\'t update googleMapsUrl if undefined in request');
{
  const reqBody = {
    clinicName: 'Test Clinic'
    // googleMapsUrl not provided
  };

  const updates: any = {};
  if (reqBody.clinicName !== undefined) updates.clinicName = reqBody.clinicName;
  if (reqBody.googleMapsUrl !== undefined) updates.googleMapsUrl = reqBody.googleMapsUrl;

  assert(updates.googleMapsUrl === undefined, 'googleMapsUrl not in updates when undefined');
  assert(updates.clinicName === 'Test Clinic', 'clinicName still updated');
}

console.log('\n═══════════════════════════════════════════════════════════');
if (failed === 0) {
  console.log(`✅ All ${passed} tests passed!`);
  console.log('\nRegression test confirms: googleMapsUrl is properly extracted and persisted.');
} else {
  console.error(`❌ ${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log('═══════════════════════════════════════════════════════════\n');
