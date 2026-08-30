/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	assertSoundscaperNativeBinaryArchitecture,
	inspectSoundscaperNativeBinaryFile,
} from '../scripts/lib/soundscaper-native-binary-architecture.mjs';
import {
	createSoundscaperProfessionalNativeToolchainReceipt,
	soundscaperProfessionalNativeToolchainIdentity,
	validateSoundscaperProfessionalNativeToolchainReceipt,
} from '../scripts/lib/soundscaper-professional-native-toolchain.mjs';
import {
	soundscaperProfessionalNativeIsolationConfigureArguments,
} from '../scripts/lib/soundscaper-professional-native-target-build.mjs';
import {
	resolveSoundscaperNativeTestRuntime,
} from '../scripts/lib/soundscaper-native-test-runtime.mjs';
import {
	inspectSoundscaperProfessionalNativeDependencies,
} from '../scripts/lib/soundscaper-professional-native-dependency-inspection.mjs';
import {
	soundscaperProfessionalNativeCandidateArtifactPaths,
} from '../scripts/lib/soundscaper-professional-native-candidate-contract.mjs';

test('candidate executable paths retain the Windows PE suffix', () => {
	assert.deepEqual(soundscaperProfessionalNativeCandidateArtifactPaths('win-arm64'), {
		payload: 'payload/soundscaper_professional.node',
		osAudioCodec: 'payload/soundscaper_os_audio_codec.node',
		pluginPeer: 'payload/soundscaper_professional_peer.exe',
		deliveryFilesystem: 'payload/soundscaper_delivery_fs.exe',
		launcher: 'payload/milestone5-native-isolation-launcher.exe',
	});
	assert.equal(soundscaperProfessionalNativeCandidateArtifactPaths('linux-x64').pluginPeer,
		'payload/soundscaper_professional_peer');
});

test('binary architecture admission recognizes only exact target-native ELF, PE, and Mach-O', () => {
	assert.deepEqual(assertSoundscaperNativeBinaryArchitecture(elf(62), 'linux-x64'), {
		schemaVersion: 1, target: 'linux-x64', format: 'elf64-le',
		architecture: 'x64', machine: 'EM_X86_64',
	});
	assert.deepEqual(assertSoundscaperNativeBinaryArchitecture(elf(183), 'linux-arm64'), {
		schemaVersion: 1, target: 'linux-arm64', format: 'elf64-le',
		architecture: 'arm64', machine: 'EM_AARCH64',
	});
	assert.deepEqual(assertSoundscaperNativeBinaryArchitecture(pe(0x8664), 'win-x64'), {
		schemaVersion: 1, target: 'win-x64', format: 'pe32-plus',
		architecture: 'x64', machine: 'IMAGE_FILE_MACHINE_AMD64',
	});
	assert.deepEqual(assertSoundscaperNativeBinaryArchitecture(pe(0xaa64), 'win-arm64'), {
		schemaVersion: 1, target: 'win-arm64', format: 'pe32-plus',
		architecture: 'arm64', machine: 'IMAGE_FILE_MACHINE_ARM64',
	});
	assert.deepEqual(assertSoundscaperNativeBinaryArchitecture(machO(0x0100000c), 'mac-arm64'), {
		schemaVersion: 1, target: 'mac-arm64', format: 'mach-o-64-le',
		architecture: 'arm64', machine: 'CPU_TYPE_ARM64',
	});
});

test('binary architecture admission rejects cross-format, wrong-machine, fat, and malformed payloads', () => {
	for (const [bytes, target] of [
		[elf(62), 'linux-arm64'], [elf(183), 'linux-x64'],
		[pe(0x8664), 'win-arm64'], [pe(0xaa64), 'win-x64'],
		[machO(0x01000007), 'mac-arm64'], [pe(0xaa64), 'linux-arm64'],
	]) assert.throws(() => assertSoundscaperNativeBinaryArchitecture(bytes, target),
		/architecture|format|target-native/iu);
	assert.throws(() => assertSoundscaperNativeBinaryArchitecture(
		Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 1]), 'mac-arm64',
	), /fat|universal/iu);
	assert.throws(() => assertSoundscaperNativeBinaryArchitecture(Buffer.alloc(8), 'linux-x64'),
		/malformed|binary/iu);
	const pe32 = pe(0xaa64); pe32.writeUInt16LE(0x10b, 0x98);
	assert.throws(() => assertSoundscaperNativeBinaryArchitecture(pe32, 'win-arm64'), /PE32\+/iu);
});

test('file architecture admission refuses aliases and bounded-file substitution', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-native-architecture-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const binary = join(root, 'payload.node');
	await writeFile(binary, elf(62));
	assert.equal((await inspectSoundscaperNativeBinaryFile({
		path: binary, target: 'linux-x64',
	})).machine, 'EM_X86_64');
	const alias = join(root, 'alias.node');
	await symlink(binary, alias);
	await assert.rejects(inspectSoundscaperNativeBinaryFile({
		path: alias, target: 'linux-x64',
	}), /canonical|symbolic/iu);
	const oversized = join(root, 'oversized.node');
	await writeFile(oversized, Buffer.alloc(65));
	await assert.rejects(inspectSoundscaperNativeBinaryFile({
		path: oversized, target: 'linux-x64', maximumBytes: 64,
	}), /byte budget|bounded/iu);
});

test('Windows dependency inspection parses target PE imports without an ambient SDK command', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-native-pe-imports-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const binary = join(root, 'soundscaper_professional.node');
	await writeFile(binary, peWithImports(0xaa64, ['KERNEL32.dll', 'USER32.dll']));
	const inspected = await inspectSoundscaperProfessionalNativeDependencies({
		target: 'win-arm64', path: binary,
	});
	assert.deepEqual(inspected.imports, ['KERNEL32.dll', 'USER32.dll']);
	assert.deepEqual(inspected.rpaths, []);
	assert.equal(inspected.architecture.machine, 'IMAGE_FILE_MACHINE_ARM64');
});

test('structured toolchain receipts bind professional, isolation, and applicable codec targets', () => {
	const windows = createSoundscaperProfessionalNativeToolchainReceipt({
		target: 'win-arm64',
		professional: toolchain('Windows', 'ARM64', 'Visual Studio 17 2022', 'ARM64'),
		isolation: toolchain('Windows', 'ARM64', 'Visual Studio 17 2022', 'ARM64'),
		osAudioCodec: codecToolchain('Windows', 'ARM64', 'Visual Studio 17 2022'),
	});
	assert.equal(validateSoundscaperProfessionalNativeToolchainReceipt(windows), windows);
	assert.match(soundscaperProfessionalNativeToolchainIdentity(windows),
		/^soundscaper-professional-toolchains-sha256:[a-f\d]{64}$/u);
	assert.equal(soundscaperProfessionalNativeToolchainIdentity(structuredClone(windows)),
		soundscaperProfessionalNativeToolchainIdentity(windows));

	const linux = createSoundscaperProfessionalNativeToolchainReceipt({
		target: 'linux-x64',
		professional: toolchain('Linux', 'x86_64', 'Ninja', ''),
		isolation: toolchain('Linux', 'x86_64', 'Ninja', ''),
		osAudioCodec: null,
	});
	assert.equal(linux.osAudioCodec, null);
	assert.equal(validateSoundscaperProfessionalNativeToolchainReceipt(linux), linux);
});

test('toolchain receipts refuse wrong generators, platforms, processors, and codec applicability', () => {
	const base = {
		target: 'win-arm64',
		professional: toolchain('Windows', 'ARM64', 'Visual Studio 17 2022', 'ARM64'),
		isolation: toolchain('Windows', 'ARM64', 'Visual Studio 17 2022', 'ARM64'),
		osAudioCodec: codecToolchain('Windows', 'ARM64', 'Visual Studio 17 2022'),
	};
	for (const changed of [
		{ ...base, professional: toolchain('Windows', 'AMD64', 'Visual Studio 17 2022', 'ARM64') },
		{ ...base, isolation: toolchain('Windows', 'ARM64', 'Visual Studio 17 2022', 'x64') },
		{ ...base, professional: toolchain('Windows', 'ARM64', 'Ninja', '') },
		{ ...base, osAudioCodec: null },
	]) assert.throws(() => createSoundscaperProfessionalNativeToolchainReceipt(changed),
		/toolchain|target|codec/iu);
	assert.throws(() => createSoundscaperProfessionalNativeToolchainReceipt({
		target: 'linux-arm64',
		professional: toolchain('Linux', 'aarch64', 'Ninja', ''),
		isolation: toolchain('Linux', 'aarch64', 'Ninja', ''),
		osAudioCodec: codecToolchain('Linux', 'aarch64', 'Ninja'),
	}), /codec/iu);
});

test('isolation configuration selects one exact native generator architecture', () => {
	const request = { sourceRoot: '/source', buildRoot: '/build' };
	assert.deepEqual(soundscaperProfessionalNativeIsolationConfigureArguments({
		...request, target: 'win-arm64',
	}), [
		'-S', '/source', '-B', '/build', '-A', 'ARM64',
		'-DSOUNDSCAPER_NATIVE_TARGET=win-arm64',
	]);
	assert.deepEqual(soundscaperProfessionalNativeIsolationConfigureArguments({
		...request, target: 'win-x64',
	}).slice(4, 6), ['-A', 'x64']);
	assert.deepEqual(soundscaperProfessionalNativeIsolationConfigureArguments({
		...request, target: 'mac-arm64',
	}).slice(4), [
		'-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
		'-DSOUNDSCAPER_NATIVE_TARGET=mac-arm64', '-DCMAKE_OSX_ARCHITECTURES=arm64',
	]);
	assert.deepEqual(soundscaperProfessionalNativeIsolationConfigureArguments({
		...request, target: 'linux-arm64',
	}).slice(4), [
		'-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
		'-DSOUNDSCAPER_NATIVE_TARGET=linux-arm64',
	]);
});

test('test orchestration permits only native Node or Windows x64 on its ARM64 OS target', () => {
	assert.deepEqual(resolveSoundscaperNativeTestRuntime({
		requestedTarget: 'linux-arm64', platform: 'linux', architecture: 'arm64',
	}), { target: 'linux-arm64', orchestration: 'target-native-node' });
	assert.deepEqual(resolveSoundscaperNativeTestRuntime({
		requestedTarget: 'win-arm64', platform: 'win32', architecture: 'x64',
	}), { target: 'win-arm64', orchestration: 'windows-x64-node-on-arm64-runner' });
	for (const request of [
		{ requestedTarget: 'linux-arm64', platform: 'linux', architecture: 'x64' },
		{ requestedTarget: 'mac-arm64', platform: 'darwin', architecture: 'x64' },
		{ requestedTarget: 'win-x64', platform: 'win32', architecture: 'arm64' },
	]) assert.throws(() => resolveSoundscaperNativeTestRuntime(request), /cannot orchestrate|runtime/iu);
});

function elf(machine) {
	const bytes = Buffer.alloc(64);
	bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
	bytes.writeUInt16LE(machine, 18);
	return bytes;
}

function pe(machine) {
	const bytes = Buffer.alloc(256);
	bytes.write('MZ', 0, 'ascii');
	bytes.writeUInt32LE(0x80, 0x3c);
	bytes.write('PE\0\0', 0x80, 'binary');
	bytes.writeUInt16LE(machine, 0x84);
	bytes.writeUInt16LE(0x20b, 0x98);
	return bytes;
}

function peWithImports(machine, imports) {
	const bytes = Buffer.alloc(1024);
	bytes.write('MZ', 0, 'ascii');
	bytes.writeUInt32LE(0x80, 0x3c);
	bytes.write('PE\0\0', 0x80, 'binary');
	bytes.writeUInt16LE(machine, 0x84);
	bytes.writeUInt16LE(1, 0x86);
	bytes.writeUInt16LE(0xf0, 0x94);
	bytes.writeUInt16LE(0x20b, 0x98);
	bytes.writeUInt32LE(0x200, 0x98 + 60);
	bytes.writeUInt32LE(16, 0x98 + 108);
	bytes.writeUInt32LE(0x1000, 0x98 + 120);
	bytes.writeUInt32LE((imports.length + 1) * 20, 0x98 + 124);
	const section = 0x98 + 0xf0;
	bytes.write('.rdata', section, 'ascii');
	bytes.writeUInt32LE(0x200, section + 8);
	bytes.writeUInt32LE(0x1000, section + 12);
	bytes.writeUInt32LE(0x200, section + 16);
	bytes.writeUInt32LE(0x200, section + 20);
	let nameRva = 0x1100;
	for (const [index, name] of imports.entries()) {
		bytes.writeUInt32LE(nameRva, 0x200 + index * 20 + 12);
		bytes.write(`${name}\0`, 0x200 + (nameRva - 0x1000), 'ascii');
		nameRva += Buffer.byteLength(name) + 1;
	}
	return bytes;
}

function machO(cpuType) {
	const bytes = Buffer.alloc(32);
	bytes.writeUInt32LE(0xfeedfacf, 0);
	bytes.writeInt32LE(cpuType, 4);
	return bytes;
}

function toolchain(systemName, systemProcessor, generator, generatorPlatform) {
	return {
		cmakeVersion: '4.2.1', generator, generatorPlatform, systemName, systemProcessor,
		osxArchitectures: systemName === 'Darwin' ? 'arm64' : '',
		cCompiler: { id: systemName === 'Windows' ? 'MSVC' : 'Clang', version: '19.44.1' },
		cxxCompiler: { id: systemName === 'Windows' ? 'MSVC' : 'Clang', version: '19.44.1' },
	};
}

function codecToolchain(systemName, systemProcessor, generator) {
	return {
		cmake: '4.2.1', cxxCompilerId: systemName === 'Windows' ? 'MSVC' : 'Clang',
		cxxCompilerVersion: '19.44.1', generator, systemName, systemProcessor,
	};
}
