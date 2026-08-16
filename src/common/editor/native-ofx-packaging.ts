/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Where an OpenFX bundle's binary lives on each qualifying target.
 *
 * These directory names are the OpenFX packaging convention, not ours, and the
 * mapping is deliberately exact rather than derived. Windows on ARM is the
 * reason: the host there is a dedicated Arm64EC binary and looks for
 * `Win-arm64ec`, which no rule of thumb about "platform plus architecture"
 * would produce. Linux on ARM uses the standard-documented `Linux-aarch64`
 * forward-compatibility convention for the same reason — guessing
 * `Linux-arm64` would silently find nothing on a real machine.
 *
 * macOS x64 is deliberately absent: it is an explicit milestone-5B non-goal, so
 * asking for it returns null rather than a plausible directory that would then
 * be qualified against nothing.
 */

export const OFX_TARGETS = Object.freeze([
	'win32-x64', 'win32-arm64', 'darwin-arm64', 'linux-x64', 'linux-arm64',
] as const);

export type OfxTarget = (typeof OFX_TARGETS)[number];

export const OFX_TARGET_ARCHITECTURE_DIRECTORIES: Readonly<Record<OfxTarget, string>> =
	Object.freeze({
		'win32-x64': 'Win64',
		'win32-arm64': 'Win-arm64ec',
		'darwin-arm64': 'MacOS',
		'linux-x64': 'Linux-x86-64',
		'linux-arm64': 'Linux-aarch64',
	});

/** The host process ABI each target's isolated OFX host is built as. */
export const OFX_TARGET_HOST_ABI: Readonly<Record<OfxTarget, string>> = Object.freeze({
	'win32-x64': 'x86_64-pc-windows-msvc',
	'win32-arm64': 'arm64ec-pc-windows-msvc',
	'darwin-arm64': 'arm64-apple-darwin',
	'linux-x64': 'x86_64-unknown-linux-gnu',
	'linux-arm64': 'aarch64-unknown-linux-gnu',
});

/** Qualification that must pass on every target, with no hardware excuse. */
export const OFX_UNIVERSAL_QUALIFICATIONS: readonly string[] = Object.freeze([
	'cpu-render',
	'interact-v1',
	'interact-v2',
	'custom-parameter-interact',
	'draw-suite-v1',
	'packaging',
]);

/** GPU mechanisms, each qualified only where the hardware actually exists. */
export const OFX_GPU_QUALIFICATIONS: readonly string[] = Object.freeze([
	'opengl-render', 'opencl-render', 'cuda-render', 'metal-render',
]);

/** Which GPU mechanisms are even applicable on a given target. */
export const OFX_TARGET_GPU_QUALIFICATIONS: Readonly<Record<OfxTarget, readonly string[]>> =
	Object.freeze({
		'win32-x64': Object.freeze(['opengl-render', 'opencl-render', 'cuda-render']),
		'win32-arm64': Object.freeze(['opengl-render', 'opencl-render']),
		'darwin-arm64': Object.freeze(['opengl-render', 'opencl-render', 'metal-render']),
		'linux-x64': Object.freeze(['opengl-render', 'opencl-render', 'cuda-render']),
		'linux-arm64': Object.freeze(['opengl-render', 'opencl-render']),
	});

/** Explicitly out of scope for milestone 5B; asking returns null, not a guess. */
export const OFX_DEFERRED_TARGETS: readonly string[] = Object.freeze(['darwin-x64']);

export function ofxArchitectureDirectory(target: string): string | null {
	return Object.hasOwn(OFX_TARGET_ARCHITECTURE_DIRECTORIES, target)
		? OFX_TARGET_ARCHITECTURE_DIRECTORIES[target as OfxTarget]
		: null;
}

/**
 * The bundle-relative path a plug-in binary must occupy for a given target.
 * OpenFX bundles are `<name>.ofx.bundle/Contents/<architecture>/<name>.ofx`.
 */
export function ofxBundleBinaryPath(bundleName: string, target: string): string | null {
	const directory = ofxArchitectureDirectory(target);
	if (directory === null) return null;
	if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/u.test(bundleName)) {
		throw new RangeError('An OFX bundle name must be bounded and free of separators.');
	}
	return `${bundleName}.ofx.bundle/Contents/${directory}/${bundleName}.ofx`;
}

/** Everything one target must pass before 5B may claim it. */
export function ofxRequiredQualifications(
	target: OfxTarget,
	provisionedGpuMechanisms: readonly string[] = [],
): readonly string[] {
	const applicable = OFX_TARGET_GPU_QUALIFICATIONS[target];
	const gpu = provisionedGpuMechanisms.filter((mechanism) => applicable.includes(mechanism));
	return Object.freeze([...OFX_UNIVERSAL_QUALIFICATIONS, ...gpu]);
}

/**
 * A target is qualified only when every universal requirement passed. GPU
 * mechanisms qualify where their hardware exists; unprovisioned ones stay
 * unqualified rather than being counted as passes.
 */
export function ofxTargetIsQualified(
	target: OfxTarget,
	passed: readonly string[],
	provisionedGpuMechanisms: readonly string[] = [],
): boolean {
	const required = ofxRequiredQualifications(target, provisionedGpuMechanisms);
	const observed = new Set(passed);
	return required.every((requirement) => observed.has(requirement));
}
