/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	assertNativeWindowsExecutable,
	installWindowsArm64MediaTools,
	prepareCiNativeTooling,
	WINDOWS_ARM64_SEVEN_ZIP,
} from '../scripts/setup-ci-native-tooling.mjs';
import { zstdCompressSync } from 'node:zlib';

function pe(machine = 0xaa64): Buffer {
	const bytes = Buffer.alloc(128);
	bytes.write('MZ');
	bytes.writeUInt32LE(64, 60);
	bytes.write('PE\0\0', 64);
	bytes.writeUInt16LE(machine, 68);
	return bytes;
}

test('native executable admission rejects x86, x64, corrupt, and truncated PE files', () => {
	assert.doesNotThrow(() => assertNativeWindowsExecutable(pe(), '7-Zip'));
	for (const bytes of [pe(0x14c), pe(0x8664), Buffer.alloc(128), pe().subarray(0, 67)]) {
		assert.throws(() => assertNativeWindowsExecutable(bytes, '7-Zip'), /ARM64/u);
	}
});

test('an emulated Node process fails before any tools can be installed', async () => {
	await assert.rejects(prepareCiNativeTooling({
		platform: 'win32', arch: 'x64', env: { RUNNER_ARCH: 'ARM64' },
	}), /native Node/u);
});

test('other native runners need no Windows downloads or environment changes', async () => {
	for (const [platform, arch, runnerArch] of [
		['linux', 'arm64', 'ARM64'], ['darwin', 'arm64', 'ARM64'], ['win32', 'x64', 'X64'],
	] as const) {
		assert.deepEqual(await prepareCiNativeTooling({ platform, arch, env: { RUNNER_ARCH: runnerArch } }), []);
	}
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'scape-native-tools-'));
	const env = {
		RUNNER_ARCH: 'ARM64', RUNNER_TEMP: root,
		ProgramFiles: join(root, 'Program Files'),
		'ProgramFiles(x86)': join(root, 'Program Files (x86)'),
		SystemRoot: join(root, 'Windows'),
		GITHUB_ENV: join(root, 'github-env'), GITHUB_PATH: join(root, 'github-path'),
	};
	for (const relative of [
		'Program Files/CMake/bin/cmake.exe', 'Program Files/CMake/bin/ctest.exe',
		'Program Files/LLVM/bin/clang-cl.exe', 'Program Files/LLVM/bin/clang.exe',
		'Windows/System32/tar.exe', 'Tools/Ninja/ninja.exe',
		'Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/arm64/signtool.exe',
	]) {
		const path = join(root, relative);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, pe());
	}
	return { root, env };
}

test('verified tools are exported only after their bytes and native architecture pass', async () => {
	const { root, env } = await fixture();
	try {
		const archive = Buffer.from('authenticated test archive');
		const pin = { ...WINDOWS_ARM64_SEVEN_ZIP,
			byteLength: archive.length, sha256: createHash('sha256').update(archive).digest('hex') };
		const tools = await prepareCiNativeTooling({
			platform: 'win32', arch: 'arm64', env, ninjaRoot: join(root, 'Tools/Ninja'), sevenZip: pin,
			fetchImpl: () => Promise.resolve(new Response(archive)),
			extract: async (_archive: string, destination: string) => {
				await mkdir(join(destination, '7zip/bin'), { recursive: true });
				await writeFile(join(destination, '7zip/bin/7za.exe'), pe());
			},
		});
		assert.equal(tools.length, 5);
		assert.match(await readFile(env.GITHUB_ENV, 'utf8'), /ELECTRON_BUILDER_7ZIP_PATH=.*7za\.exe/u);
		assert.match(await readFile(env.GITHUB_ENV, 'utf8'), /LLVMInstallDir=/u);
		assert.match(await readFile(env.GITHUB_ENV, 'utf8'), /SIGNTOOL_PATH=.*arm64.*signtool\.exe/u);
		assert.match(await readFile(env.GITHUB_PATH, 'utf8'), /CMake\/bin/u);
		assert.match(await readFile(env.GITHUB_PATH, 'utf8'), /Tools\/Ninja/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('altered downloads and mislabeled binaries never become active tools', async () => {
	const { root, env } = await fixture();
	try {
		await assert.rejects(prepareCiNativeTooling({
			platform: 'win32', arch: 'arm64', env, ninjaRoot: join(root, 'Tools/Ninja'),
			fetchImpl: () => Promise.resolve(new Response(Buffer.from('tampered'))),
		}), /archive/u);
		await assert.rejects(readFile(env.GITHUB_ENV), /ENOENT/u);
		await writeFile(join(env.ProgramFiles, 'CMake/bin/cmake.exe'), pe(0x8664));
		await assert.rejects(prepareCiNativeTooling({
			platform: 'win32', arch: 'arm64', env, ninjaRoot: join(root, 'Tools/Ninja'),
		}), /ARM64/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('native media tooling authenticates each archive and its complete DLL closure', async () => {
	const { root, env } = await fixture();
	try {
		const archive = zstdCompressSync(Buffer.from('fixture tar archive'));
		const pins = [{ url: 'https://fixture.invalid/media-tools', byteLength: archive.length,
			sha256: createHash('sha256').update(archive).digest('hex'),
			files: ['mingw32-make.exe', 'pkgconf.exe', 'libpkgconf-8.dll', 'libintl-8.dll', 'libiconv-2.dll'] }];
		const options = {
			directory: root, tar: join(env.SystemRoot, 'System32/tar.exe'), pins,
			fetchImpl: () => Promise.resolve(new Response(archive)),
			extract: async (_archive: string, destination: string) => {
				await mkdir(join(destination, 'clangarm64/bin'), { recursive: true });
				for (const name of pins[0].files) await writeFile(join(destination, 'clangarm64/bin', name), pe());
			},
		};
		const bin = await installWindowsArm64MediaTools(options);
		assertNativeWindowsExecutable(await readFile(join(bin, 'make.exe')), 'GNU Make');
		assertNativeWindowsExecutable(await readFile(join(bin, 'pkg-config.exe')), 'pkg-config');
		await assert.rejects(installWindowsArm64MediaTools({ ...options,
			extract: async (_archive: string, destination: string) => {
				await options.extract(_archive, destination);
				await writeFile(join(destination, 'clangarm64/bin/libintl-8.dll'), pe(0x8664));
			},
		}), /ARM64/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});
