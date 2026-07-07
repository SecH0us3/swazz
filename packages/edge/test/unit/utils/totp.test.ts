import { describe, it, expect } from 'vitest';
import { base32Encode, base32Decode, generateTOTPSecret, generateTOTP, verifyTOTP, encryptTOTPSecret, decryptTOTPSecret } from '../../../src/utils/totp';

describe('TOTP Utils', () => {
  it('should encode and decode base32 correctly', () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const encoded = base32Encode(original);
    expect(encoded).toBe('JBSWY3DP');
    
    const decoded = base32Decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('should generate a secret of correct length', () => {
    const secret = generateTOTPSecret();
    expect(secret.length).toBe(16); // 10 bytes = 16 base32 chars
  });

  it('should generate and verify TOTP codes', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'; // "Hello!"
    const token = await generateTOTP(secret);
    
    expect(token.length).toBe(6);
    expect(/^\d+$/.test(token)).toBe(true);
    
    const isValid = await verifyTOTP(secret, token);
    expect(isValid).toBe(true);
    
    const isInvalid = await verifyTOTP(secret, '000000');
    expect(isInvalid).toBe(false);
  });

  it('should encrypt and decrypt TOTP secrets using AES-256-GCM', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const password = 'my-super-secret-password-123';
    
    const encrypted = await encryptTOTPSecret(secret, password);
    expect(encrypted).toContain(':');
    expect(encrypted.split(':').length).toBe(3);
    
    const decrypted = await decryptTOTPSecret(encrypted, password);
    expect(decrypted).toBe(secret);
    
    // Attempt decryption with wrong password
    await expect(decryptTOTPSecret(encrypted, 'wrong-password')).rejects.toThrow();
  });
});
