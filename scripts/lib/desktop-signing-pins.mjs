/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';

export const signingDigest = bytes => createHash('sha256').update(bytes).digest('hex');

// Only replace a digest that was produced by this signing invocation. Other
// hashes (source provenance, build plans, upstream archives) remain untouched.
export function rebindSigningPins(value, replacements) {
	if (!value || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map(child => rebindSigningPins(child, replacements));
	const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
		typeof child === 'string' && replacements.has(child)
			? replacements.get(child).sha256 : rebindSigningPins(child, replacements),
	]));
	const replacement = replacements.get(value.sha256);
	if (replacement && Object.hasOwn(value, 'byteLength')) result.byteLength = replacement.byteLength;
	// Assistance package totals are derived from their file descriptors.
	if (value.files && typeof value.files === 'object' && !Array.isArray(value.files) && Object.hasOwn(value, 'byteLength')) {
		const files = Object.values(result.files);
		if (files.every(file => Number.isSafeInteger(file?.byteLength))) {
			result.byteLength = files.reduce((sum, file) => sum + file.byteLength, 0);
		}
	}
	// Native build-result checks bind canonical, tab-indented JSON.
	if (value.result && typeof value.sha256 === 'string'
		&& signingDigest(canonicalSigningJson(value.result)) === value.sha256) {
		result.sha256 = signingDigest(canonicalSigningJson(result.result));
	}
	return result;
}

export function canonicalSigningJson(value) {
	return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`);
}
