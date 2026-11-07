import type { PasswordAttempts, PasswordVerifier } from "@shared/index";
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
export const validPassword = (value: string) =>
  typeof value === "string" && value.length >= 4 && value.length <= 128;
async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: salt as BufferSource,
        iterations,
      },
      key,
      256,
    ),
  );
}
export async function createPasswordVerifier(
  password: string,
): Promise<PasswordVerifier> {
  if (!validPassword(password))
    throw new Error("Use a password between 4 and 128 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 310_000;
  return {
    algorithm: "PBKDF2-SHA-256",
    iterations,
    salt: encode(salt),
    verifier: encode(await derive(password, salt, iterations)),
  };
}
export async function verifyPassword(
  password: string,
  record: PasswordVerifier,
): Promise<boolean> {
  if (!validPassword(password)) return false;
  const actual = await derive(password, decode(record.salt), record.iterations);
  const expected = decode(record.verifier);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
export function failedPasswordAttempt(
  attempts: PasswordAttempts,
  now: number,
): PasswordAttempts {
  const failedAttempts = attempts.failedAttempts + 1;
  const wait =
    failedAttempts < 3
      ? 0
      : Math.min(3_600_000, 30_000 * 2 ** Math.min(failedAttempts - 3, 7));
  return { failedAttempts, cooldownUntil: wait ? now + wait : undefined };
}
