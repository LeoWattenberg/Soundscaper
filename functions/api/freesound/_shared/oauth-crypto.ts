/* SPDX-License-Identifier: AGPL-3.0-only */

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function randomCapability(byteLength = 32): string {
	if (!Number.isSafeInteger(byteLength) || byteLength < 16 || byteLength > 64) {
		throw new TypeError('The capability byte length is invalid.');
	}
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return encodeBase64Url(bytes);
}

export async function hashCapability(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
	return encodeBase64Url(new Uint8Array(digest));
}

export function constantTimeEqual(left: string, right: string): boolean {
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	let difference = leftBytes.byteLength ^ rightBytes.byteLength;
	const maximum = Math.max(leftBytes.byteLength, rightBytes.byteLength);
	for (let index = 0; index < maximum; index += 1) {
		difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	}
	return difference === 0;
}

export async function encryptOAuthSecret(
	value: string,
	masterKey: string,
	additionalData: string,
): Promise<string> {
	const key = await importMasterKey(masterKey, ['encrypt']);
	const iv = new Uint8Array(12);
	crypto.getRandomValues(iv);
	const encrypted = await crypto.subtle.encrypt({
		name: 'AES-GCM',
		iv,
		additionalData: encoder.encode(additionalData),
		tagLength: 128,
	}, key, encoder.encode(value));
	return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptOAuthSecret(
	value: string,
	masterKey: string,
	additionalData: string,
): Promise<string> {
	const parts = value.split('.');
	if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('The encrypted OAuth secret is invalid.');
	const iv = decodeBase64Url(parts[1] ?? '');
	const ciphertext = decodeBase64Url(parts[2] ?? '');
	if (iv.byteLength !== 12 || ciphertext.byteLength < 17) throw new Error('The encrypted OAuth secret is invalid.');
	const key = await importMasterKey(masterKey, ['decrypt']);
	try {
		const decrypted = await crypto.subtle.decrypt({
			name: 'AES-GCM',
			iv,
			additionalData: encoder.encode(additionalData),
			tagLength: 128,
		}, key, ciphertext);
		return decoder.decode(decrypted);
	} catch {
		throw new Error('The encrypted OAuth secret could not be authenticated.');
	}
}

function parseMasterKey(value: string): Uint8Array<ArrayBuffer> {
	const match = /^v1:([A-Za-z0-9_-]{43})$/u.exec(value.trim());
	if (match === null) throw new Error('Freesound OAuth encryption is not configured.');
	const bytes = decodeBase64Url(match[1] ?? '');
	if (bytes.byteLength !== 32) throw new Error('Freesound OAuth encryption is not configured.');
	return bytes;
}

async function importMasterKey(value: string, usages: readonly KeyUsage[]): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', parseMasterKey(value), { name: 'AES-GCM' }, false, usages);
}

export function encodeBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid base64url data.');
	const padding = '='.repeat((4 - value.length % 4) % 4);
	let binary: string;
	try {
		binary = atob(value.replace(/-/gu, '+').replace(/_/gu, '/') + padding);
	} catch {
		throw new Error('Invalid base64url data.');
	}
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
