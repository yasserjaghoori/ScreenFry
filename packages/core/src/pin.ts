import type { PinAttemptState, PinVerifier } from '@shared/index';

const encoder = new TextEncoder();
const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};
const fromBase64 = (value: string): Uint8Array => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    256
  );
  return new Uint8Array(bits);
}

export function validatePinFormat(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export async function createPinVerifier(pin: string): Promise<PinVerifier> {
  if (!validatePinFormat(pin)) throw new Error('PIN must be exactly six digits.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 310_000;
  const verifier = await derive(pin, salt, iterations);
  return { algorithm: 'PBKDF2-SHA-256', iterations, salt: toBase64(salt), verifier: toBase64(verifier) };
}

export async function verifyPin(pin: string, record: PinVerifier): Promise<boolean> {
  if (!validatePinFormat(pin)) return false;
  const actual = await derive(pin, fromBase64(record.salt), record.iterations);
  const expected = fromBase64(record.verifier);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

export function pinCooldownMilliseconds(failedAttempts: number): number {
  if (failedAttempts < 3) return 0;
  return Math.min(60 * 60_000, 30_000 * (2 ** Math.min(failedAttempts - 3, 7)));
}

export function recordFailedPin(state: PinAttemptState, now: number): PinAttemptState {
  const failedAttempts = state.failedAttempts + 1;
  const cooldown = pinCooldownMilliseconds(failedAttempts);
  return { failedAttempts, cooldownUntil: cooldown ? now + cooldown : undefined };
}

export const clearPinAttempts = (): PinAttemptState => ({ failedAttempts: 0 });
