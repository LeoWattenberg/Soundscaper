/* SPDX-License-Identifier: AGPL-3.0-only */
import { rebindSigningPins } from './desktop-signing-pins.mjs';

// The release inventory retains both source pins and distribution pins. Only
// explicitly identified files of the selected Mac package may be rebound.
export function signedAssistanceAuthority(manifest, signing, target) {
	if (signing === undefined) return manifest;
	if (target !== 'mac-arm64' || signing?.schemaVersion !== 1
		|| !/^[A-Z0-9]{10}$/u.test(signing.teamId ?? '') || !Array.isArray(signing.files)) {
		throw new Error('Invalid native signing receipt.');
	}
	const descriptor = manifest.targets[target].package;
	const prefix = `${manifest.runtimePrefix}/node_modules/${descriptor.name}/`;
	const replacements = new Map();
	const seen = new Set();
	for (const file of signing.files) {
		if (typeof file.path !== 'string' || file.path.includes('..') || file.path.startsWith('/') || seen.has(file.path)) {
			throw new Error('Invalid or repeated signed runtime path.');
		}
		seen.add(file.path);
		if (!file.path.startsWith(prefix)) continue;
		const original = descriptor.files[file.path.slice(prefix.length)];
		if (!original || original.sha256 !== file.original?.sha256 || original.byteLength !== file.original?.byteLength
			|| !/^[a-f0-9]{64}$/u.test(file.signed?.sha256 ?? '')
			|| !Number.isSafeInteger(file.signed?.byteLength) || file.signed.byteLength < 1) {
			throw new Error('Signed assistance payload does not bind its original source pins.');
		}
		replacements.set(original.sha256, file.signed);
	}
	return rebindSigningPins(manifest, replacements);
}
