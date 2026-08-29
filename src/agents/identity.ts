/**
 * Agent Identity & Cryptographic Provenance.
 * Directly mirrors codex-rs/agent-identity.
 * 
 * Provides runtime Ed25519 keypair generation, agent runtime IDs,
 * task attestation signing, and verifiable parent-child provenance.
 */

import { generateKeyPairSync, sign, verify } from "node:crypto";

export interface AgentBillOfMaterials {
  agentVersion: string;
  agentHarnessId: string;
  runningLocation: string;
}

export interface AgentIdentity {
  agentRuntimeId: string;
  publicKey: string;
  privateKey: string;
  createdAt: number;
  abom: AgentBillOfMaterials;
  parentId?: string;
}

export interface TaskAssertion {
  agentRuntimeId: string;
  taskId: string;
  timestamp: string;
  signature: string;
  publicKey: string;
}

/**
 * Generates a new cryptographic Agent Identity with an Ed25519 keypair
 */
export function createAgentIdentity(
  parentId?: string,
  harnessId = "groupy-harness-v1"
): AgentIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const agentRuntimeId = `aid_${crypto.randomUUID().replace(/-/g, "")}`;

  return {
    agentRuntimeId,
    publicKey,
    privateKey,
    createdAt: Date.now(),
    abom: {
      agentVersion: "0.1.0",
      agentHarnessId: harnessId,
      runningLocation: "local-process",
    },
    parentId,
  };
}

/**
 * Signs a task action / payload with the agent's private key
 */
export function signTaskAction(
  identity: AgentIdentity,
  taskId: string,
  payload: string
): TaskAssertion {
  const timestamp = new Date().toISOString();
  const dataToSign = `${identity.agentRuntimeId}:${taskId}:${timestamp}:${payload}`;
  const signatureBuffer = sign(null, Buffer.from(dataToSign), identity.privateKey);

  return {
    agentRuntimeId: identity.agentRuntimeId,
    taskId,
    timestamp,
    signature: signatureBuffer.toString("base64"),
    publicKey: identity.publicKey,
  };
}

/**
 * Verifies a task assertion against an agent's public key
 */
export function verifyTaskAction(
  assertion: TaskAssertion,
  payload: string
): boolean {
  try {
    const dataToVerify = `${assertion.agentRuntimeId}:${assertion.taskId}:${assertion.timestamp}:${payload}`;
    return verify(
      null,
      Buffer.from(dataToVerify),
      assertion.publicKey,
      Buffer.from(assertion.signature, "base64")
    );
  } catch {
    return false;
  }
}
