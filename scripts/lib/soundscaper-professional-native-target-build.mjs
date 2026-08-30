/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed CMake target selection shared by professional candidate orchestration. */

import { isAbsolute, resolve } from 'node:path';

const TARGETS = new Set([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);

export function soundscaperProfessionalNativeIsolationConfigureArguments(options) {
	const target = targetId(options?.target);
	const args = [
		'-S', absolutePath(options?.sourceRoot, 'isolation source root'),
		'-B', absolutePath(options?.buildRoot, 'isolation build root'),
	];
	if (target.startsWith('win-')) {
		args.push('-A', target === 'win-arm64' ? 'ARM64' : 'x64');
	} else args.push('-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release');
	args.push(`-DSOUNDSCAPER_NATIVE_TARGET=${target}`);
	if (target === 'mac-arm64') args.push('-DCMAKE_OSX_ARCHITECTURES=arm64');
	return Object.freeze(args);
}

function targetId(value) {
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new TypeError('The isolation build target is unsupported.');
	}
	return value;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0')) throw new TypeError(`The ${label} must be absolute and normalized.`);
	return value;
}
