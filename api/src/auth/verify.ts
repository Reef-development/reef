import { createRemoteJWKSet, jwtVerify } from "jose";

export type VerifiedToken = { userId: string };
export type TokenVerifier = (token: string) => Promise<VerifiedToken>;

/**
 * Verifies a Supabase access token against the project's published signing keys. The API holds
 * no signing secret: a token it did not issue, that has expired, or that was issued for another
 * project fails here and never reaches a route.
 */
export function supabaseVerifier(supabaseUrl: string): TokenVerifier {
  const issuer = `${supabaseUrl}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: "authenticated" });
    if (!payload.sub) throw new Error("Token has no subject");
    return { userId: payload.sub };
  };
}
