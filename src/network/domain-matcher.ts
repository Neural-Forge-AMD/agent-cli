/**
 * DomainMatcher - High-performance domain pattern evaluator.
 * Evaluates hostnames and IPs against allowlist/denylist rules with anti-SSRF protection.
 * Directly mirrors codex-rs/network-proxy domain policy evaluator.
 */

import type { NetworkConfig, NetworkRuleAction } from "./types";

export const DEFAULT_DEVELOPER_DOMAINS: Record<string, NetworkRuleAction> = {
  "localhost": "allow",
  "127.0.0.1": "allow",
  "::1": "allow",
  "[::1]": "allow",
  "*.openai.com": "allow",
  "api.openai.com": "allow",
  "github.com": "allow",
  "*.github.com": "allow",
  "api.github.com": "allow",
  "raw.githubusercontent.com": "allow",
  "registry.npmjs.org": "allow",
  "*.npmjs.org": "allow",
  "pypi.org": "allow",
  "*.pypi.org": "allow",
  "files.pythonhosted.org": "allow",
  "*.groupy-hub.store": "allow",
  "api.groupy-hub.store": "allow",
};

// Reserved/Private IP ranges to prevent SSRF vulnerabilities
const BLOCKED_IP_PATTERNS = [
  /^169\.254\./, // AWS/GCP/Azure Cloud Metadata IP
  /^10\./,        // Class A Private
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Class B Private
  /^192\.168\./,  // Class C Private
  /^127\.(?!0\.0\.1)/, // Non-standard loopback
  /^fe80:/i,      // IPv6 Link-Local
  /^fc00:/i,      // IPv6 Unique Local Address
  /^fd00:/i,      // IPv6 Unique Local Address
];

export class DomainMatcher {
  private rules: Map<string, NetworkRuleAction> = new Map();
  private allowLocalBinding: boolean = false;

  constructor(config?: NetworkConfig) {
    this.allowLocalBinding = config?.allowLocalBinding ?? false;

    // Load default developer whitelist first
    for (const [pattern, action] of Object.entries(DEFAULT_DEVELOPER_DOMAINS)) {
      this.rules.set(pattern.toLowerCase(), action);
    }

    // Override with user configuration if provided
    if (config?.domains) {
      for (const [pattern, action] of Object.entries(config.domains)) {
        this.rules.set(pattern.toLowerCase(), action);
      }
    }
  }

  /**
   * Evaluates whether a host (hostname or IP) is allowed to connect.
   */
  evaluate(host: string): { allowed: boolean; reason: string } {
    let normalizedHost = host.trim().toLowerCase();
    
    // Strip brackets if IPv6
    if (normalizedHost.startsWith("[") && normalizedHost.endsWith("]")) {
      normalizedHost = normalizedHost.slice(1, -1);
    }

    if (!normalizedHost) {
      return { allowed: false, reason: "Empty host" };
    }

    // 1. Anti-SSRF check: block private/cloud metadata IPs unless explicitly allowed in local binding
    const isStandardLoopback =
      normalizedHost === "localhost" ||
      normalizedHost === "127.0.0.1" ||
      normalizedHost === "::1" ||
      normalizedHost === "0:0:0:0:0:0:0:1";

    if (!this.allowLocalBinding && !isStandardLoopback) {
      for (const pattern of BLOCKED_IP_PATTERNS) {
        if (pattern.test(normalizedHost)) {
          return {
            allowed: false,
            reason: `SSRF Guard: connection to private/cloud-metadata IP '${normalizedHost}' is blocked.`,
          };
        }
      }
    }

    // 2. Exact match check
    if (this.rules.has(normalizedHost) || this.rules.has(`[${normalizedHost}]`)) {
      const action = this.rules.get(normalizedHost) || this.rules.get(`[${normalizedHost}]`)!;
      return {
        allowed: action === "allow",
        reason: `Matched exact rule '${normalizedHost}' (${action})`,
      };
    }

    // 3. Scoped wildcard match (e.g. *.openai.com matches api.openai.com)
    for (const [pattern, action] of this.rules.entries()) {
      if (pattern.startsWith("*.")) {
        const rootDomain = pattern.slice(2);
        if (normalizedHost === rootDomain || normalizedHost.endsWith("." + rootDomain)) {
          return {
            allowed: action === "allow",
            reason: `Matched wildcard rule '${pattern}' (${action})`,
          };
        }
      } else if (pattern.startsWith("**.")) {
        const rootDomain = pattern.slice(3);
        if (normalizedHost === rootDomain || normalizedHost.endsWith("." + rootDomain)) {
          return {
            allowed: action === "allow",
            reason: `Matched recursive wildcard rule '${pattern}' (${action})`,
          };
        }
      }
    }

    // 4. Default policy: deny unknown domains
    return {
      allowed: false,
      reason: `Host '${normalizedHost}' is not in the allowlist.`,
    };
  }

  /**
   * Adds or updates a domain rule.
   */
  setRule(pattern: string, action: NetworkRuleAction): void {
    this.rules.set(pattern.trim().toLowerCase(), action);
  }

  /**
   * Retrieves all active domain rules.
   */
  getRules(): Record<string, NetworkRuleAction> {
    return Object.fromEntries(this.rules.entries());
  }
}
