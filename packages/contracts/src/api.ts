export type PortalRole = 'admin' | 'manager';
export type Actor = { accountId: string; role: PortalRole };
export type SessionData = { user: { id: string; email: string; role: PortalRole }; expiresAt: string };
export type ApiErrorBody = { error: { code: string; message: string; fieldErrors?: Record<string, string[]>; requestId: string } };
export type AuthBinding = { accountId: string; authGeneration: number };
