
/**
 * 🛡️ Cloudflare Access Identity Utility
 */

export interface UserIdentity {
  email: string;
  name: string;
  picture?: string;
  role: string;
  initials: string;
}

/**
 * Decodes the Cloudflare Access JWT payload safely.
 * Cloudflare Access JWTs are base64url encoded.
 */
function decodeJWTPayload(token: string) {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error("JWT Decode Error:", e);
    return null;
  }
}

/**
 * Extracts the user identity from Cloudflare Access headers.
 */
export function getUserIdentity(request: Request): UserIdentity | null {
  // 1. Try to get the JWT assertion header (most reliable for name/picture)
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  
  // 2. Fallbacks for email/name from direct headers if JWT is missing
  const emailHeader = request.headers.get("Cf-Access-Authenticated-User-Email");
  
  if (!jwt && !emailHeader) {
    // If we're in development or no headers, return null (handled by components)
    return null;
  }

  let identity: any = {};

  if (jwt) {
    identity = decodeJWTPayload(jwt) || {};
  }

  const email = identity.email || emailHeader || "unknown@medicert.com.tr";
  const name = identity.name || "Kullanıcı";
  const picture = identity.picture || null;

  // Initials logic
  const initials = name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Role logic as requested
  // r.serdar@gmail.com -> Admin
  // Others -> Personel
  const role = email === "r.serdar@gmail.com" ? "Admin" : "Personel";

  return {
    email,
    name,
    picture,
    role,
    initials
  };
}
