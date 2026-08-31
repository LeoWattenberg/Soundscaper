/* SPDX-License-Identifier: AGPL-3.0-only */

/** Structured, target-bound toolchain identity for professional native build results. */

import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

export const SOUNDSCAPER_PROFESSIONAL_TOOLCHAIN_NAME =
	'soundscaper-professional-toolchain.json';
export const SOUNDSCAPER_ISOLATION_TOOLCHAIN_NAME =
	'soundscaper-isolation-toolchain.json';

const TARGETS = new Set([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const WINDOWS_GENERATORS = new Set(['Visual Studio 17 2022', 'Visual Studio 18 2026']);
const TOOLCHAIN_FIELDS = [
	'cCompiler', 'cmakeVersion', 'cxxCompiler', 'generator', 'generatorPlatform',
	'osxArchitectures', 'systemName', 'systemProcessor',
];
const CODEC_FIELDS = [
	'cmake', 'cxxCompilerId', 'cxxCompilerVersion', 'generator', 'systemName', 'systemProcessor',
];

export function createSoundscaperProfessionalNativeToolchainReceipt(options) {
	const receipt = structuredClone({
		schemaVersion: 1,
		target: options?.target,
		professional: options?.professional,
		isolation: options?.isolation,
		osAudioCodec: options?.osAudioCodec,
	});
	return validateSoundscaperProfessionalNativeToolchainReceipt(receipt);
}

export async function readSoundscaperProfessionalNativeToolchainReceipt(options) {
	const [professional, isolation] = await Promise.all([
		readToolchain(resolve(options?.professionalBuildRoot,
			SOUNDSCAPER_PROFESSIONAL_TOOLCHAIN_NAME), 'professional'),
		readToolchain(resolve(options?.isolationBuildRoot,
			SOUNDSCAPER_ISOLATION_TOOLCHAIN_NAME), 'isolation'),
	]);
	return createSoundscaperProfessionalNativeToolchainReceipt({
		target: options?.target, professional, isolation,
		osAudioCodec: options?.osAudioCodec ?? null,
	});
}

export function validateSoundscaperProfessionalNativeToolchainReceipt(value) {
	if (!plainRecord(value) || exactKeys(value) !== [
		'isolation', 'osAudioCodec', 'professional', 'schemaVersion', 'target',
	].join(',') || value.schemaVersion !== 1 || !TARGETS.has(value.target)) {
		throw new TypeError('The professional native toolchain receipt is invalid.');
	}
	validateToolchain(value.professional, value.target, 'professional');
	validateToolchain(value.isolation, value.target, 'isolation');
	if (value.target.startsWith('linux-')) {
		if (value.osAudioCodec !== null) {
			throw new TypeError('A Linux professional toolchain receipt cannot carry an OS codec toolchain.');
		}
	} else validateCodecToolchain(value.osAudioCodec, value.target);
	return deepFreeze(value);
}

export function soundscaperProfessionalNativeToolchainIdentity(receipt) {
	validateSoundscaperProfessionalNativeToolchainReceipt(receipt);
	return `soundscaper-professional-toolchains-sha256:${createHash('sha256')
		.update(canonicalJson(receipt)).digest('hex')}`;
}

function validateToolchain(value, target, label) {
	if (!plainRecord(value) || exactKeys(value) !== [...TOOLCHAIN_FIELDS].sort().join(',')
		|| !version(value.cmakeVersion) || !compiler(value.cCompiler)
		|| !compiler(value.cxxCompiler)) {
		throw new TypeError(`The ${label} CMake toolchain identity is invalid.`);
	}
	const expected = targetExpectation(target);
	if (!expected.generators.has(value.generator)
		|| value.generatorPlatform !== expected.generatorPlatform
		|| value.systemName !== expected.systemName
		|| !expected.processors.has(value.systemProcessor)
		|| value.osxArchitectures !== expected.osxArchitectures) {
		throw new TypeError(`The ${label} CMake toolchain does not match ${target}.`);
	}
}

function validateCodecToolchain(value, target) {
	if (!plainRecord(value) || exactKeys(value) !== [...CODEC_FIELDS].sort().join(',')
		|| !version(value.cmake) || !token(value.cxxCompilerId)
		|| !version(value.cxxCompilerVersion)) {
		throw new TypeError('The OS codec CMake toolchain identity is invalid.');
	}
	const expected = targetExpectation(target);
	if (!expected.generators.has(value.generator) || value.systemName !== expected.systemName
		|| !expected.processors.has(value.systemProcessor)) {
		throw new TypeError(`The OS codec CMake toolchain does not match ${target}.`);
	}
}

function targetExpectation(target) {
	if (target === 'linux-x64') return {
		generators: new Set(['Ninja']), generatorPlatform: '', systemName: 'Linux',
		processors: new Set(['AMD64', 'x86_64', 'x64']), osxArchitectures: '',
	};
	if (target === 'linux-arm64') return {
		generators: new Set(['Ninja']), generatorPlatform: '', systemName: 'Linux',
		processors: new Set(['ARM64', 'aarch64', 'arm64']), osxArchitectures: '',
	};
	if (target === 'mac-arm64') return {
		generators: new Set(['Ninja']), generatorPlatform: '', systemName: 'Darwin',
		processors: new Set(['ARM64', 'aarch64', 'arm64']), osxArchitectures: 'arm64',
	};
	return {
		generators: WINDOWS_GENERATORS,
		generatorPlatform: target === 'win-arm64' ? 'ARM64' : 'x64',
		systemName: 'Windows',
		processors: target === 'win-arm64'
			? new Set(['ARM64', 'aarch64', 'arm64']) : new Set(['AMD64', 'x86_64', 'x64']),
		osxArchitectures: '',
	};
}

async function readToolchain(path, label) {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || await realpath(path) !== path
		|| before.size < 2 || before.size > 4_096) {
		throw new Error(`The ${label} toolchain receipt is not one bounded canonical file.`);
	}
	const bytes = await readFile(path);
	const after = await lstat(path);
	if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
		|| before.mtimeMs !== after.mtimeMs || bytes.byteLength !== before.size) {
		throw new Error(`The ${label} toolchain receipt changed while reading.`);
	}
	try { return JSON.parse(String(bytes)); }
	catch (error) { throw new Error(`The ${label} toolchain receipt is not JSON.`, { cause: error }); }
}

function compiler(value) {
	return plainRecord(value) && exactKeys(value) === 'id,version'
		&& token(value.id) && version(value.version);
}
function plainRecord(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value) { return Object.keys(value).sort().join(','); }
function token(value) { return typeof value === 'string' && /^[A-Za-z\d+_.-]{1,64}$/u.test(value); }
function version(value) {
	return typeof value === 'string' && /^\d+\.\d+(?:\.\d+)?(?:[-.][A-Za-z\d]+)*$/u.test(value);
}
function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`); }
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
