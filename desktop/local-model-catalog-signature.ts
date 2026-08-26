/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Authentication primitives for the local-model catalog.
 *
 * The release signing key is deliberately absent from the repository. Builds
 * carry only public verification keys; tests inject their own ephemeral key.
 */

import { createHash, createPublicKey, verify } from 'node:crypto';

export const LOCAL_MODEL_CATALOG_SIGNATURE_ALGORITHM = 'Ed25519' as const;
export const LOCAL_MODEL_CATALOG_CURRENT_KEY_ID = 'soundscaper-local-model-catalog-2026-08' as const;
export const LOCAL_MODEL_CATALOG_NEXT_KEY_ID = 'soundscaper-local-model-catalog-2027-01' as const;

/** Public keys trusted by production builds. Add the successor before rotating. */
export const LOCAL_MODEL_CATALOG_TRUSTED_KEYS = Object.freeze({
	[LOCAL_MODEL_CATALOG_CURRENT_KEY_ID]: [
		'-----BEGIN PUBLIC KEY-----',
		'MCowBQYDK2VwAyEAvDGS1WkOsRAO0Oe1h6Rs1nwzxGrv7mZ7FyPQmr261fk=',
		'-----END PUBLIC KEY-----',
		'',
	].join('\n'),
	[LOCAL_MODEL_CATALOG_NEXT_KEY_ID]: [
		'-----BEGIN PUBLIC KEY-----',
		'MCowBQYDK2VwAyEAmY7m1C89oOgdxZr6ggF32jn8gMgThaz0nbsk1iWGR2M=',
		'-----END PUBLIC KEY-----',
		'',
	].join('\n'),
});

export interface LocalModelCatalogSignature {
	readonly algorithm: typeof LOCAL_MODEL_CATALOG_SIGNATURE_ALGORITHM;
	readonly keyId: string;
	readonly value: string;
}

export interface LocalModelCatalogSignatureOptions {
	/** Additional trusted public keys, intended for isolated tests and rotation canaries. */
	readonly trustedKeys?: Readonly<Record<string, string>>;
}

type JsonRecord = Record<string, unknown>;

function plainRecord(value: unknown): value is JsonRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}

/**
 * Deterministic JSON serialization used for both signatures and evidence pins.
 * Object keys use the JSON Canonicalization Scheme's UTF-16 lexical ordering;
 * arrays retain order and non-JSON values are refused rather than coerced.
 */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot contain a non-finite number.');
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
	if (!plainRecord(value)) throw new TypeError('Canonical JSON accepts plain JSON values only.');
	return `{${Object.keys(value).sort().map((key) => {
		const member = value[key];
		if (member === undefined) throw new TypeError('Canonical JSON cannot contain undefined.');
		return `${JSON.stringify(key)}:${canonicalJson(member)}`;
	}).join(',')}}`;
}

/** Pins the complete licensing row, not only the model id or current status. */
export function localModelEvidenceSha256(value: unknown): string {
	return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function assertSignature(value: unknown): LocalModelCatalogSignature {
	if (!plainRecord(value)) throw new Error('The local model catalog needs an Ed25519 signature.');
	const keys = Object.keys(value).sort();
	if (keys.join(',') !== 'algorithm,keyId,value'
		|| value.algorithm !== LOCAL_MODEL_CATALOG_SIGNATURE_ALGORITHM
		|| typeof value.keyId !== 'string'
		|| !/^[a-z\d][a-z\d.-]{0,126}[a-z\d]$/u.test(value.keyId)
		|| typeof value.value !== 'string'
		|| !/^[A-Za-z\d+/]{86}==$/u.test(value.value)) {
		throw new Error('The local model catalog needs an Ed25519 signature.');
	}
	return value as unknown as LocalModelCatalogSignature;
}

/** Verifies the signed envelope and returns its authenticated payload. */
export function verifyLocalModelCatalogSignature(
	value: unknown,
	options: LocalModelCatalogSignatureOptions = {},
): JsonRecord {
	if (!plainRecord(value)) throw new Error('A local model catalog must be an object.');
	const signature = assertSignature(value.signature);
	const trustedKeys: Readonly<Record<string, string>> = {
		...options.trustedKeys,
		...LOCAL_MODEL_CATALOG_TRUSTED_KEYS,
	};
	const trustedKey = Object.hasOwn(trustedKeys, signature.keyId) ? trustedKeys[signature.keyId] : undefined;
	if (trustedKey === undefined) {
		throw new Error(`The local model catalog signing key is not trusted: ${signature.keyId}.`);
	}
	const publicKey = createPublicKey(trustedKey);
	if (publicKey.asymmetricKeyType !== 'ed25519') {
		throw new Error(`The local model catalog signing key is not Ed25519: ${signature.keyId}.`);
	}
	const { signature: _signature, ...payload } = value;
	const authentic = verify(
		null,
		Buffer.from(canonicalJson(payload)),
		publicKey,
		Buffer.from(signature.value, 'base64'),
	);
	if (!authentic) throw new Error('The local model catalog signature is invalid.');
	return payload;
}
