---
name: owasp-top10
description: "OWASP Top 10 Web & API Security Checklist - Guidelines, code patterns, and automated remediation for modern web application vulnerabilities."
risk: low
source: built-in
---

# OWASP Top 10 Security Checklist

## 1. Broken Access Control (A01)
- **Check**: Are access control decisions enforced server-side on every request?
- **Remedy**: Implement centralized authorization middleware and verify tenancy on every query.

## 2. Cryptographic Failures (A02)
- **Check**: Are sensitive data in transit and at rest encrypted? Are deprecated algorithms (MD5, SHA1, DES) avoided?
- **Remedy**: Use Argon2id/bcrypt for passwords, AES-GCM for encryption, and TLS 1.3 for transport.

## 3. Injection (A03)
- **Check**: Are SQL, NoSQL, OS command, and LDAP queries parameterized?
- **Remedy**: Never concatenate user input into database queries or shell execution strings.

## 4. Insecure Design (A04)
- **Check**: Are threat modeling and defense-in-depth principles applied?
- **Remedy**: Enforce least privilege, strict input boundaries, and rate limits.

## 5. Security Misconfiguration (A05)
- **Check**: Are default passwords, unnecessary features, and debug error messages disabled in production?
- **Remedy**: Disable detailed stack traces in production API responses and enforce strict CSP headers.

## 6. Vulnerable and Outdated Components (A06)
- **Check**: Are dependencies monitored for known CVEs (`npm audit`, `bun audit`)?
- **Remedy**: Regularly update dependencies and pin exact versions.

## 7. Identification and Authentication Failures (A07)
- **Check**: Is multi-factor authentication supported? Are session identifiers secure?
- **Remedy**: Implement exponential backoff for failed logins and enforce strong password policies.

## 8. Software and Data Integrity Failures (A08)
- **Check**: Are plugins, libraries, and CDNs verified with integrity hashes?
- **Remedy**: Enforce subresource integrity (SRI) and signed package downloads.

## 9. Security Logging and Monitoring Failures (A09)
- **Check**: Are login attempts, access failures, and sensitive transactions logged?
- **Remedy**: Centralize structured security logs without logging plaintext credentials or PII.

## 10. Server-Side Request Forgery - SSRF (A10)
- **Check**: Do servers make HTTP requests to user-supplied URLs without validation?
- **Remedy**: Whitelist permitted target domains and reject private/internal IP ranges.
