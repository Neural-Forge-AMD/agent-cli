import { expect, test, describe } from "bun:test";
import { DomainMatcher } from "../src/network/domain-matcher";
import { NetworkProxyServer, parseHostAndPort } from "../src/network/proxy-server";

describe("Network Egress Proxy & Domain Matching", () => {
  test("parseHostAndPort handles IPv4, IPv6 bracketed literals, and hostnames", () => {
    expect(parseHostAndPort("api.github.com", 443)).toEqual({ host: "api.github.com", port: 443 });
    expect(parseHostAndPort("localhost:3000", 80)).toEqual({ host: "localhost", port: 3000 });
    expect(parseHostAndPort("[::1]:8080", 80)).toEqual({ host: "::1", port: 8080 });
    expect(parseHostAndPort("[fe80::1]:443", 443)).toEqual({ host: "fe80::1", port: 443 });
    expect(parseHostAndPort("[::1]", 80)).toEqual({ host: "::1", port: 80 });
  });

  test("DomainMatcher allows whitelisted exact domains and wildcards", () => {
    const matcher = new DomainMatcher({
      enabled: true,
      domains: {
        "example.com": "allow",
        "*.internal.io": "allow",
        "malicious.com": "deny",
      },
    });

    expect(matcher.evaluate("example.com").allowed).toBe(true);
    expect(matcher.evaluate("api.internal.io").allowed).toBe(true);
    expect(matcher.evaluate("sub.api.internal.io").allowed).toBe(true);
    expect(matcher.evaluate("malicious.com").allowed).toBe(false);
    expect(matcher.evaluate("unregistered-domain.org").allowed).toBe(false);
  });

  test("DomainMatcher blocks cloud metadata SSRF IPs and allows loopback IPv6", () => {
    const matcher = new DomainMatcher({ enabled: true });

    // AWS/GCP Metadata
    const ssrfCheck = matcher.evaluate("169.254.169.254");
    expect(ssrfCheck.allowed).toBe(false);
    expect(ssrfCheck.reason).toContain("SSRF Guard");

    // Private subnets blocked unless local binding allowed
    expect(matcher.evaluate("10.0.0.1").allowed).toBe(false);
    expect(matcher.evaluate("192.168.1.1").allowed).toBe(false);

    // Localhost and IPv6 loopback allowed by default
    expect(matcher.evaluate("localhost").allowed).toBe(true);
    expect(matcher.evaluate("127.0.0.1").allowed).toBe(true);
    expect(matcher.evaluate("::1").allowed).toBe(true);
    expect(matcher.evaluate("[::1]").allowed).toBe(true);
  });

  test("NetworkProxyServer intercepts and blocks unauthorized HTTP requests with 403", async () => {
    const blockedHosts: string[] = [];
    const proxy = new NetworkProxyServer({
      port: 0, // ephemeral port
      config: {
        enabled: true,
        domains: {
          "allowed.local": "allow",
          "blocked.local": "deny",
        },
      },
      onBlocked: (host) => {
        blockedHosts.push(host);
      },
    });

    const proxyPort = await proxy.start();
    expect(proxyPort).toBeGreaterThan(0);

    // Test proxying a request to a blocked host
    const res = await fetch(`http://127.0.0.1:${proxyPort}/test`, {
      headers: {
        Host: "blocked.local",
      },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
    expect(body.targetHost).toBe("blocked.local");
    expect(blockedHosts).toContain("blocked.local");

    const stats = proxy.getStats();
    expect(stats.blockedRequests).toBeGreaterThanOrEqual(1);

    await proxy.stop();
  });
});
