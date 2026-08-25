/* SPDX-License-Identifier: AGPL-3.0-only */

const EXPECTED_TOOLCHAIN = Object.freeze({
	emscriptenVersion: '3.1.64',
	dockerImage: 'emscripten/emsdk:3.1.64',
	dockerImageDigest: 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc',
	sourceDateEpoch: '1768696955',
});
const TOOLCHAIN_KEYS = Object.freeze(Object.keys(EXPECTED_TOOLCHAIN).sort());

/** Reject mutable tags and every toolchain identity outside the reviewed WavPack build. */
export function assertWavPackEmscriptenToolchainIdentity(value) {
	if (!plainRecord(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(TOOLCHAIN_KEYS)
		|| Object.entries(EXPECTED_TOOLCHAIN).some(([key, expected]) => value[key] !== expected)) {
		throw new Error('WavPack WASM requires the reviewed digest-qualified Emscripten 3.1.64 toolchain.');
	}
	return EXPECTED_TOOLCHAIN;
}

/** Canonical immutable container reference for reproducing the WavPack artifact. */
export function wavPackEmscriptenDockerReference(value) {
	const identity = assertWavPackEmscriptenToolchainIdentity(value);
	return `${identity.dockerImage}@${identity.dockerImageDigest}`;
}

function plainRecord(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
