/**
 * Tenant Routing Tests
 * Tests that incoming calls are correctly routed to tenants based on phone number
 */

import { describe, it, expect } from 'vitest';
import { normalizePhoneNumber } from '../services/tenantResolver';

describe('Phone Number Normalization', () => {
  describe('Australian mobile numbers', () => {
    it('should normalize 04xx numbers to E.164', () => {
      expect(normalizePhoneNumber('0468035585')).toBe('+61468035585');
      expect(normalizePhoneNumber('0412345678')).toBe('+61412345678');
    });

    it('should normalize numbers starting with 61', () => {
      expect(normalizePhoneNumber('61468035585')).toBe('+61468035585');
    });

    it('should keep E.164 format unchanged', () => {
      expect(normalizePhoneNumber('+61468035585')).toBe('+61468035585');
    });
  });

  describe('formatting cleanup', () => {
    it('should strip spaces', () => {
      expect(normalizePhoneNumber('+61 468 035 585')).toBe('+61468035585');
      expect(normalizePhoneNumber('04 6803 5585')).toBe('+61468035585');
    });

    it('should strip parentheses and dashes', () => {
      expect(normalizePhoneNumber('(04) 6803-5585')).toBe('+61468035585');
      expect(normalizePhoneNumber('+61-468-035-585')).toBe('+61468035585');
    });

    it('should handle dots', () => {
      expect(normalizePhoneNumber('04.6803.5585')).toBe('+61468035585');
    });
  });

  describe('Australian landline numbers', () => {
    it('should normalize landlines starting with 07 (QLD)', () => {
      expect(normalizePhoneNumber('0733001234')).toBe('+61733001234');
    });

    it('should normalize landlines starting with 02 (NSW)', () => {
      expect(normalizePhoneNumber('0299998888')).toBe('+61299998888');
    });

    it('should keep landlines with country code', () => {
      expect(normalizePhoneNumber('+61733001234')).toBe('+61733001234');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for empty input', () => {
      expect(normalizePhoneNumber('')).toBe('');
    });

    it('should return empty string for null-ish input', () => {
      expect(normalizePhoneNumber(null as any)).toBe('');
      expect(normalizePhoneNumber(undefined as any)).toBe('');
    });
  });
});

/**
 * Integration tests - require database connection
 * Run these tests with: npm run test:integration
 */
describe.skip('Tenant Resolution by Phone Number (Integration)', () => {
  it('should resolve spinalogic tenant for +61468035585', async () => {
    const { resolveTenant } = await import('../services/tenantResolver');
    const tenant = await resolveTenant('+61468035585');

    if (tenant) {
      expect(tenant.slug).toBe('spinalogic');
      expect(tenant.clinicName).not.toBe('Your Clinic');
      console.log('✓ Tenant resolved:', tenant.slug, '-', tenant.clinicName);
    } else {
      console.warn('⚠ No tenant found for +61468035585 - ensure spinalogic tenant has this phone number configured');
    }
  });

  it('should fall back to default tenant for unknown numbers', async () => {
    const { resolveTenantWithFallback } = await import('../services/tenantResolver');
    const ctx = await resolveTenantWithFallback('+19999999999');
    expect(ctx).not.toBeNull();
    expect(ctx?.slug).toBe('default');
  });

  it('should include clinic name in tenant context', async () => {
    const { resolveTenantWithFallback } = await import('../services/tenantResolver');
    const ctx = await resolveTenantWithFallback('+61468035585');
    expect(ctx).not.toBeNull();
    expect(ctx?.clinicName).toBeDefined();
    expect(ctx?.clinicName.length).toBeGreaterThan(0);
    console.log('✓ Tenant clinic name:', ctx?.clinicName);
  });
});
