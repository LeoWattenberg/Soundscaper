/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed CMake target selection shared by professional build-result orchestration. */

import { isAbsolute, resolve } from 'node:path';

const TARGETS = new Set([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);

export function soundscaperProfessionalNativeIsolationConfigureArguments(options) {
	const target = targetId(options?.target);
	const toolchain = exactNinjaToolchain(options);
	const args = [
		'-S', absolutePath(options?.sourceRoot, 'isolation source root'),
		'-B', absolutePath(options?.buildRoot, 'isolation build root'),
	];
	if (toolchain !== null) {
		args.push('-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release');
		if (target.startsWith('win-')) args.push(
			'-DCMAKE_SYSTEM_NAME=Windows',
			`-DCMAKE_SYSTEM_PROCESSOR=${target === 'win-arm64' ? 'ARM64' : 'AMD64'}`,
		);
		args.push(
			`-DCMAKE_MAKE_PROGRAM=${toolchain.ninja}`,
			`-DCMAKE_C_COMPILER=${toolchain.cCompiler}`,
			`-DCMAKE_CXX_COMPILER=${toolchain.cxxCompiler}`,
		);
	} else if (target.startsWith('win-')) {
		args.push('-A', target === 'win-arm64' ? 'ARM64' : 'x64');
	} else args.push('-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release');
	args.push(`-DSOUNDSCAPER_NATIVE_TARGET=${target}`);
	if (target === 'mac-arm64') args.push('-DCMAKE_OSX_ARCHITECTURES=arm64');
	return Object.freeze(args);
}

function exactNinjaToolchain(options) {
	const fields = ['ninja', 'cCompiler', 'cxxCompiler'];
	const supplied = fields.filter((field) => options?.[field] !== undefined);
	if (supplied.length === 0) return null;
	if (supplied.length !== fields.length) {
		throw new TypeError('The isolation Ninja toolchain requires make, C, and C++ compilers.');
	}
	return Object.freeze({
		ninja: absolutePath(options.ninja, 'isolation Ninja executable'),
		cCompiler: absolutePath(options.cCompiler, 'isolation C compiler'),
		cxxCompiler: absolutePath(options.cxxCompiler, 'isolation C++ compiler'),
	});
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
