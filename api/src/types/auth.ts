
export type UserClaims = { id: string; email?: string; role?: string };
export type AuthedRequest = Request & { user?: UserClaims };