import { AppError } from '../errors.js';
import { validPassword } from './password.js';
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  const [local,domain]=email.split('@');
  return email.length <= 254 && !!local && local.length<=64 && !!domain && domain.split('.').every(label=>label.length<=63) && /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) ? email : null;
}
export function loginCredentials(body: unknown): { email: string; password: string } {
  const errors: Record<string, string[]> = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(422, 'VALIDATION_ERROR', 'Check the highlighted fields.', { _form: ['Enter email and password.'] });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !['email', 'password'].includes(key))) errors._form = ['Unexpected fields.'];
  const email = normalizeEmail(input.email);
  if (!email) errors.email = ['Enter a valid email address.'];
  if (!validPassword(input.password)) errors.password = ['Use 8-128 Unicode characters.'];
  if (Object.keys(errors).length) throw new AppError(422, 'VALIDATION_ERROR', 'Check the highlighted fields.', errors);
  return { email: email!, password: input.password as string };
}
