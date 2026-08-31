/**
 * Local Network Policy Enforcement Proxy Server.
 * Intercepts HTTP/HTTPS (CONNECT) traffic from agent subprocesses and enforces domain policies.
 * Directly mirrors codex-rs/network-proxy.
 */

import * as http from "node:http";
import * as net from "node:net";
import { DomainMatcher } from "./domain-matcher";
import type { ProxyServerOptions, ProxyServerStats } from "./types";

/**
 * Robustly parses host and port from raw Host headers or CONNECT URLs,
 * properly supporting bracketed IPv6 literals (e.g. [::1]:8080).
 */
export function parseHostAndPort(
  rawTarget: string,
  defaultPort: number = 80
): { host: string; port: number } {
  const trimmed = (rawTarget || "").trim();
  if (!trimmed) {
    return { host: "", port: defaultPort };
  }

  // Bracketed IPv6 format: [::1]:8080 or [fe80::1]
  if (trimmed.startsWith("[")) {
    const closeBracketIdx = trimmed.indexOf("]");
    if (closeBracketIdx !== -1) {
      const host = trimmed.slice(1, closeBracketIdx);
      const remainder = trimmed.slice(closeBracketIdx + 1);
      const port = remainder.startsWith(":") ? parseInt(remainder.slice(1), 10) : defaultPort;
      return { host, port: isNaN(port) ? defaultPort : port };
    }
  }

  // IPv4 or Hostname format: localhost:8080 or api.github.com
  const lastColonIdx = trimmed.lastIndexOf(":");
  if (lastColonIdx !== -1) {
    const host = trimmed.slice(0, lastColonIdx);
    const port = parseInt(trimmed.slice(lastColonIdx + 1), 10);
    if (!isNaN(port)) {
      return { host, port };
    }
  }

  return { host: trimmed, port: defaultPort };
}

export class NetworkProxyServer {
  private server: http.Server | null = null;
  private matcher: DomainMatcher;
  private port: number = 3128;
  private host: string = "127.0.0.1";
  private isListening: boolean = false;
  private stats: ProxyServerStats = {
    totalRequests: 0,
    allowedRequests: 0,
    blockedRequests: 0,
    activeTunnels: 0,
  };

  constructor(private options: ProxyServerOptions = {}) {
    this.host = options.host || "127.0.0.1";
    this.port = options.port || options.config?.port || 3128;
    this.matcher = new DomainMatcher(options.config);
  }

  /**
   * Starts the proxy server.
   */
  async start(): Promise<number> {
    if (this.isListening && this.server) {
      return this.port;
    }

    return new Promise<number>((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      // Handle HTTPS CONNECT tunneling
      this.server.on("connect", (req, clientSocket, head) => {
        this.handleConnectRequest(req, clientSocket, head);
      });

      this.server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          // If default port is taken, fallback to ephemeral port (0)
          if (this.port !== 0) {
            this.port = 0;
            this.server?.listen(0, this.host);
            return;
          }
        }
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        const address = this.server?.address();
        if (address && typeof address === "object") {
          this.port = address.port;
        }
        this.isListening = true;
        resolve(this.port);
      });
    });
  }

  /**
   * Handles plain HTTP requests (e.g. GET http://api.github.com/...).
   */
  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    this.stats.totalRequests++;

    const hostHeader = req.headers.host || "";
    const { host: targetHost, port: targetPort } = parseHostAndPort(hostHeader, 80);

    const evaluation = this.matcher.evaluate(targetHost);

    if (!evaluation.allowed) {
      this.stats.blockedRequests++;
      this.options.onBlocked?.(targetHost, targetPort, evaluation.reason);

      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Forbidden",
          message: `Blocked by Groupy Network Egress Policy: ${evaluation.reason}`,
          targetHost,
        })
      );
      return;
    }

    this.stats.allowedRequests++;
    this.options.onAllowed?.(targetHost, targetPort);

    // Forward HTTP request upstream
    const upstreamReq = http.request(
      {
        host: targetHost,
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );

    upstreamReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
      }
      res.end(`Proxy Gateway Error: ${err.message}`);
    });

    req.pipe(upstreamReq);
  }

  /**
   * Handles HTTPS CONNECT tunnels (e.g. CONNECT api.openai.com:443).
   */
  private handleConnectRequest(req: http.IncomingMessage, clientSocket: any, head: Buffer) {
    this.stats.totalRequests++;

    const { host: targetHost, port: targetPort } = parseHostAndPort(req.url || "", 443);

    const evaluation = this.matcher.evaluate(targetHost);

    if (!evaluation.allowed) {
      this.stats.blockedRequests++;
      this.options.onBlocked?.(targetHost, targetPort, evaluation.reason);

      clientSocket.write(
        "HTTP/1.1 403 Forbidden\r\n" +
          "Content-Type: text/plain\r\n" +
          `X-Groupy-Reason: ${evaluation.reason}\r\n` +
          "\r\n" +
          `Blocked by Groupy Network Egress Policy: ${evaluation.reason}\r\n`
      );
      clientSocket.destroy();
      return;
    }

    this.stats.allowedRequests++;
    this.stats.activeTunnels++;
    this.options.onAllowed?.(targetHost, targetPort);

    const upstreamSocket = net.connect(targetPort, targetHost, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length > 0) {
        upstreamSocket.write(head);
      }
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });

    const cleanup = () => {
      this.stats.activeTunnels = Math.max(0, this.stats.activeTunnels - 1);
      upstreamSocket.destroy();
      clientSocket.destroy();
    };

    upstreamSocket.on("error", cleanup);
    clientSocket.on("error", cleanup);
    upstreamSocket.on("close", () => {
      this.stats.activeTunnels = Math.max(0, this.stats.activeTunnels - 1);
    });
  }

  /**
   * Stops the proxy server.
   */
  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.server || !this.isListening) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.isListening = false;
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * Returns environment variables needed to route client traffic through this proxy.
   */
  getEnv(): Record<string, string> {
    const proxyUrl = `http://${this.host}:${this.port}`;
    return {
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      ALL_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      all_proxy: proxyUrl,
    };
  }

  getPort(): number {
    return this.port;
  }

  getStats(): ProxyServerStats {
    return { ...this.stats };
  }

  getDomainMatcher(): DomainMatcher {
    return this.matcher;
  }
}
