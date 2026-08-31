/**
 * Network Policy & Proxy Types.
 * Directly mirrors codex-rs/network-proxy/src/lib.rs.
 */

export type NetworkPolicyMode = "full" | "limited" | "denied";

export type NetworkRuleAction = "allow" | "deny";

export interface DomainRule {
  pattern: string;
  action: NetworkRuleAction;
}

export interface NetworkConfig {
  enabled: boolean;
  mode?: NetworkPolicyMode;
  port?: number;
  allowLocalBinding?: boolean;
  domains?: Record<string, NetworkRuleAction>;
}

export interface ProxyServerOptions {
  port?: number;
  host?: string;
  config?: NetworkConfig;
  onBlocked?: (host: string, port: number, reason: string) => void;
  onAllowed?: (host: string, port: number) => void;
}

export interface ProxyServerStats {
  totalRequests: number;
  allowedRequests: number;
  blockedRequests: number;
  activeTunnels: number;
}
