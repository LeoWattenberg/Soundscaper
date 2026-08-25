#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Target-native build entry point.
 *
 * Required external inputs are the exact archive and extracted source tree for
 * `electron-node-api-headers` in config/milestone-5-native-source-acquisitions.json.
 * No professional-host or third-party SDK source cache is accepted.
 */

import {
	closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
	realpathSync, writeSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
	OS_AUDIO_CODEC_HOST_TARGETS,
	createOsAudioCodecHostBuildPlan,
	executeOsAudioCodecHostBuild,
} from './lib/os-audio-codec-host-build.mjs';

const allowedArguments = new Set([
	'root', 'target', 'headers-archive', 'headers-root', 'output', 'result', 'macos-sdk',
]);
const argumentsByName = parseArguments(process.argv.slice(2));
for (const required of ['target', 'headers-archive', 'headers-root', 'output', 'result']) {
	if (!argumentsByName[required]) throw new TypeError(`--${required}=... is required.`);
}
if (!OS_AUDIO_CODEC_HOST_TARGETS.includes(argumentsByName.target)) {
	throw new TypeError('The build target must be mac-arm64, win-x64, or win-arm64.');
}
if (argumentsByName.target === 'mac-arm64' && !argumentsByName['macos-sdk']) {
	throw new TypeError('--macos-sdk=... is required for mac-arm64.');
}
const repositoryRoot = resolve(argumentsByName.root || process.cwd());
const outputRoot = exclusiveDirectory(absolutePath(argumentsByName.output, 'Build output root'));
const resultPath = absolutePath(argumentsByName.result, 'Build result path');
const sourceSnapshotRoot = resolve(outputRoot, 'authenticated-sources');
mkdirSync(sourceSnapshotRoot, { mode: 0o700 });
const plan = createOsAudioCodecHostBuildPlan({
	repositoryRoot,
	target: argumentsByName.target,
	electronHeadersArchivePath: resolve(argumentsByName['headers-archive']),
	electronHeadersRoot: resolve(argumentsByName['headers-root']),
	sourceSnapshotRoot,
	buildRoot: resolve(outputRoot, 'build'),
	installRoot: resolve(outputRoot, 'artifact'),
	...(argumentsByName['macos-sdk']
		? { macosSdkPath: resolve(argumentsByName['macos-sdk']) } : {}),
});
const build = executeOsAudioCodecHostBuild(plan, {
	onStepOutput(step, stdout, stderr) {
		const output = `${stdout}${stderr}`;
		if (output.length > 0) process.stderr.write(`[${step.command}]\n${output}`);
	},
});
writeExclusiveJson(resultPath, build);
process.stdout.write(`Built ${build.target} OS audio codec addon; result: ${resultPath}\n`);

function parseArguments(values) {
	const result = {};
	for (const value of values) {
		if (!value.startsWith('--') || !value.includes('=')) {
			throw new TypeError('Build arguments must use --name=value.');
		}
		const separator = value.indexOf('=');
		const name = value.slice(2, separator);
		const argument = value.slice(separator + 1);
		if (!allowedArguments.has(name) || argument.length === 0 || result[name] !== undefined) {
			throw new TypeError(`Unsupported or duplicate build argument --${name}.`);
		}
		result[name] = argument;
	}
	return result;
}

function exclusiveDirectory(path) {
	canonicalDirectory(dirname(path), 'Build output parent');
	mkdirSync(path, { recursive: false, mode: 0o700 });
	return canonicalDirectory(path, 'Build output root');
}

function writeExclusiveJson(path, value) {
	canonicalDirectory(dirname(path), 'Build result parent');
	const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
	if (bytes.byteLength > 64 * 1024) throw new Error('Build result exceeds its byte budget.');
	const handle = openSync(path,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
		0o600);
	try {
		const metadata = fstatSync(handle);
		if (!metadata.isFile() || metadata.size !== 0) {
			throw new Error('Build result output is not one new regular file.');
		}
		let offset = 0;
		while (offset < bytes.byteLength) {
			const written = writeSync(handle, bytes, offset, bytes.byteLength - offset, null);
			if (written < 1) throw new Error('Build result write made no progress.');
			offset += written;
		}
		fsyncSync(handle);
	} finally {
		closeSync(handle);
	}
}

function canonicalDirectory(value, label) {
	const path = absolutePath(value, label);
	const metadata = lstatSync(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(path) !== path) {
		throw new Error(`${label} must be one canonical non-symbolic directory.`);
	}
	return path;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`${label} must be an absolute normalized path.`);
	}
	return value;
}
