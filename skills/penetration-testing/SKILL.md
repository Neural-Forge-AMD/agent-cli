---
name: penetration-testing
description: "Defensive Penetration Testing & API Vulnerability Assessment - Threat modeling, endpoint security probing, authentication boundary verification, and defense-in-depth posture validation."
risk: low
source: built-in
---

# Defensive Penetration Testing & API Security

This skill guides defensive assessment of web applications, REST/GraphQL APIs, and distributed microservices.

## Assessment Checklist

### 1. Authentication & Session Security
- [ ] JWT tokens have valid signature verification and explicit algorithm enforcement (reject `none` algorithm).
- [ ] Refresh tokens are rotated and revoked upon logout.
- [ ] Sensitive cookies use `HttpOnly`, `Secure`, and `SameSite=Strict/Lax` flags.
- [ ] Rate limiting and brute-force protection are enforced on login, registration, and password reset endpoints.

### 2. Authorization & Multi-Tenancy (BOLA / IDOR)
- [ ] Users can only access resources belonging to their organization/account (`WHERE user_id = :current_user`).
- [ ] Administrative routes require explicit privilege checks beyond just being logged in.
- [ ] Object IDs cannot be sequentially enumerated or tampered with to access foreign records.

### 3. Input Validation & Sanitization
- [ ] All incoming payloads pass strict schema validation (e.g., Zod, Pydantic, Joi).
- [ ] File uploads validate MIME type, file extension, and enforce size limits.
- [ ] File paths from user inputs are sanitized against directory traversal (`../` or null bytes).

### 4. Egress & SSRF Protection
- [ ] Outbound webhooks and URL fetchers validate IP addresses and block private/loopback ranges (`127.0.0.1`, `10.0.0.0/8`, `169.254.169.254`).
