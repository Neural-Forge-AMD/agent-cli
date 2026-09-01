/**
 * Authentication and Token Management Types for Groupy CLI.
 * Connects seamlessly to pikaa-cli-backend (FastAPI) and OpenAI-compatible gateways.
 */

export interface AuthCredentials {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  tokenType?: string;
  expiresAt?: number;
  baseUrl?: string;
  defaultModel?: string;
  model?: string;
  user?: {
    id?: string;
    email?: string;
    username?: string;
    role?: string;
    plan?: string;
    tier?: string;
  };
}

export interface DirectLoginParams {
  backendUrl?: string;
  emailOrUsername: string;
  password: string;
}

export interface OAuthLoginOptions {
  backendUrl?: string;
  port?: number;
  timeoutMs?: number;
  openBrowser?: boolean;
}
