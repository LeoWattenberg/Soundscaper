/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed Node orchestration rule for target-native professional self-tests. */

const TARGETS = new Set([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);

export function resolveSoundscaperNativeTestRuntime(options) {
	const target = targetId(options?.requestedTarget);
	const observed = runtimeTarget(options?.platform, options?.architecture);
	if (observed === target) {
		return Object.freeze({ target, orchestration: 'target-native-node' });
	}
	throw new Error(`The ${observed} Node runtime cannot orchestrate ${target}.`);
}

function runtimeTarget(platform, architecture) {
	const family = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
	const target = `${String(family)}-${String(architecture)}`;
	if (!TARGETS.has(target)) throw new TypeError('The Node self-test runtime is unsupported.');
	return target;
}

function targetId(value) {
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new TypeError('The requested native self-test target is unsupported.');
	}
	return value;
}
