#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

// Runs before npm ci, so this bootstrap uses only Node's built-in modules.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { zstdDecompressSync } from 'node:zlib';

const run = promisify(execFile);

/** @typedef {{url: string, byteLength: number, sha256: string}} ArchivePin */
/** @typedef {(archive: string, destination: string) => Promise<void>} ExtractArchive */

// The 1.0.0 ARM64 bundle contained an x86 executable. Admit the fixed release
// by both its published digest and the executable's PE machine type.
/** @type {Readonly<ArchivePin>} */
export const WINDOWS_ARM64_SEVEN_ZIP = Object.freeze({
	url: 'https://github.com/electron-userland/electron-builder-binaries/releases/download/7zip%401.0.1/7zip-win-arm64.tar.gz',
	byteLength: 576262,
	sha256: '1b6273d377d5ef7e2a9bb7f9b64b5cb7678ba7d0e503aa5c93305012ffa299d2',
});

/** @type {Readonly<ArchivePin>} */
const RCEDIT_SOURCE = Object.freeze({
	url: 'https://codeload.github.com/electron/rcedit/tar.gz/28a13190599ed35f472fbaea1179116a29ff8f10',
	byteLength: 15260,
	sha256: '52089457dd471969c557f52b936178b74eeccb619608347773d032b141c922c7',
});

// Published MSYS2 clangarm64 package hashes. This is only the CI tool closure;
// no MSYS2 runtime or tool binaries enter the application package.
const WINDOWS_ARM64_MEDIA_TOOLS = Object.freeze([
	{
		url: 'https://mirror.msys2.org/mingw/clangarm64/mingw-w64-clang-aarch64-make-4.4.1-5-any.pkg.tar.zst',
		byteLength: 140601,
		sha256: 'bbb640ddba62b818b8ab182e63dd83a0771702452a3ecded9463f7a75a165be5',
		files: ['mingw32-make.exe'],
	},
	{
		url: 'https://mirror.msys2.org/mingw/clangarm64/mingw-w64-clang-aarch64-pkgconf-1~3.0.7-2-any.pkg.tar.zst',
		byteLength: 142532,
		sha256: '28d8dc8388f0521224f47dd87134a92905a9563b91dedc55c62a42f3d580cbe1',
		files: ['pkgconf.exe', 'libpkgconf-8.dll'],
	},
	{
		url: 'https://mirror.msys2.org/mingw/clangarm64/mingw-w64-clang-aarch64-gettext-runtime-1.0-1-any.pkg.tar.zst',
		byteLength: 395859,
		sha256: 'b5364a7c78cc4b73273a4a28e07e3c6d9cc8ec0ce269527409d944ab1c8f5a70',
		files: ['libintl-8.dll'],
	},
	{
		url: 'https://mirror.msys2.org/mingw/clangarm64/mingw-w64-clang-aarch64-libiconv-1.19-1-any.pkg.tar.zst',
		byteLength: 734170,
		sha256: '955499bc5cb73d86ea2850ece9bbdbbfd66b213e272e032f28147ecd42897e21',
		files: ['libiconv-2.dll'],
	},
]);

export function assertNativeWindowsExecutable(bytes, label) {
	const peOffset = bytes.length >= 64 ? bytes.readUInt32LE(60) : -1;
	if (bytes.toString('ascii', 0, 2) !== 'MZ' || peOffset < 64
		|| peOffset + 6 > bytes.length || bytes.readUInt32LE(peOffset) !== 0x4550
		|| bytes.readUInt16LE(peOffset + 4) !== 0xaa64) {
		throw new Error(`${label} must be a native Windows ARM64 executable.`);
	}
}

async function downloadPinnedArchive(pin, fetchImpl) {
	const response = await fetchImpl(pin.url, { signal: AbortSignal.timeout(60_000) });
	if (!response.ok) throw new Error(`Native tool archive download failed: HTTP ${response.status}.`);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.length !== pin.byteLength
		|| createHash('sha256').update(bytes).digest('hex') !== pin.sha256) {
		throw new Error('Native tool archive failed its byte length/SHA-256 check.');
	}
	return bytes;
}

async function extractWithTar(tar, archive, destination) {
	await run(tar, ['-xf', archive, '-C', destination], { timeout: 60_000, windowsHide: true });
}

/** @param {{directory: string, tar: string, fetchImpl?: typeof fetch, extract?: ExtractArchive, pins?: (ArchivePin & {files: string[]})[]}} options */
export async function installWindowsArm64MediaTools({
	directory, tar, fetchImpl = globalThis.fetch, extract,
	pins = WINDOWS_ARM64_MEDIA_TOOLS,
}) {
	const bin = join(directory, 'media', 'bin');
	await mkdir(bin, { recursive: true });
	for (const [index, pin] of pins.entries()) {
		const bytes = await downloadPinnedArchive(pin, fetchImpl);
		const packageRoot = await mkdtemp(join(directory, `media-package-${index}-`));
		const archive = join(packageRoot, 'package.tar');
		await writeFile(archive, zstdDecompressSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }));
		if (extract) await extract(archive, packageRoot);
		else await extractWithTar(tar, archive, packageRoot);
		for (const name of pin.files) {
			const path = join(packageRoot, 'clangarm64', 'bin', name);
			assertNativeWindowsExecutable(await readFile(path), name);
			await copyFile(path, join(bin, name));
		}
		// Keep each package's upstream license files with the downloaded tool.
		await rm(archive);
	}
	await copyFile(join(bin, 'mingw32-make.exe'), join(bin, 'make.exe'));
	await copyFile(join(bin, 'pkgconf.exe'), join(bin, 'pkg-config.exe'));
	return bin;
}

/**
 * @param {{env?: NodeJS.ProcessEnv, pin?: Readonly<ArchivePin>, fetchImpl?: typeof fetch,
 * runImpl?: (executable: string, args: string[], options: object) => Promise<{stdout: string, stderr: string}>}} [options]
 */
export async function buildWindowsArm64Rcedit({
	env = process.env, pin = RCEDIT_SOURCE, fetchImpl = globalThis.fetch, runImpl = run,
} = {}) {
	const directory = await mkdtemp(join(env.RUNNER_TEMP, 'soundscaper-native-rcedit-'));
	try {
		const archive = join(directory, 'source.tar.gz');
		await writeFile(archive, await downloadPinnedArchive(pin, fetchImpl));
		const source = join(directory, 'source');
		const build = join(directory, 'build');
		const bin = join(directory, 'bin');
		await mkdir(source);
		const options = { encoding: 'utf8', timeout: 120_000, windowsHide: true };
		await runImpl(join(env.SystemRoot, 'System32', 'tar.exe'),
			['-xf', archive, '-C', source, '--strip-components=1'], options);
		const cmake = join(env.ProgramFiles, 'CMake', 'bin', 'cmake.exe');
		await runImpl(cmake, ['-S', source, '-B', build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
			'-DCMAKE_C_COMPILER=cl.exe', '-DCMAKE_CXX_COMPILER=cl.exe'], options);
		await runImpl(cmake, ['--build', build, '--parallel'], options);
		const executable = join(build, 'rcedit.exe');
		assertNativeWindowsExecutable(await readFile(executable), 'rcedit');
		await runImpl(executable, ['--help'], options);
		const canary = join(directory, 'canary.exe');
		await copyFile(executable, canary);
		const comment = 'Soundscaper native resource editor';
		await runImpl(executable, [canary, '--set-version-string', 'Comments', comment], options);
		const edited = await runImpl(executable, [canary, '--get-version-string', 'Comments'], options);
		if (edited.stdout.trim() !== comment) throw new Error('Native rcedit failed its resource editing canary.');
		await rm(canary);
		await mkdir(bin);
		// electron-builder 26 exposes only these host filenames. A native ARM64
		// editor can update resources in either target architecture's executable.
		await copyFile(executable, join(bin, 'rcedit-x64.exe'));
		await copyFile(executable, join(bin, 'rcedit-x86.exe'));
		await appendFile(env.GITHUB_ENV, `ELECTRON_BUILDER_RCEDIT_PATH=${bin}\n`);
		await rm(archive);
		return bin;
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

/**
 * @param {{platform?: NodeJS.Platform, arch?: NodeJS.Architecture, env?: NodeJS.ProcessEnv,
 * ninjaRoot?: string, sevenZip?: Readonly<ArchivePin>, fetchImpl?: typeof fetch,
 * extract?: ExtractArchive, windowsMediaTools?: boolean}} [options]
 */
export async function prepareCiNativeTooling({
	platform = process.platform,
	arch = process.arch,
	env = process.env,
	ninjaRoot = 'C:\\Tools\\Ninja',
	sevenZip = WINDOWS_ARM64_SEVEN_ZIP,
	fetchImpl = globalThis.fetch,
	extract,
	windowsMediaTools = false,
} = {}) {
	const runnerArch = env.RUNNER_ARCH?.toLowerCase();
	if (!runnerArch || runnerArch !== arch) {
		throw new Error(`CI requires native Node.js: runner=${String(runnerArch)}, node=${arch}.`);
	}
	if (platform !== 'win32' || arch !== 'arm64') return [];
	for (const name of ['ProgramFiles', 'ProgramFiles(x86)', 'SystemRoot', 'RUNNER_TEMP', 'GITHUB_ENV', 'GITHUB_PATH']) {
		if (!env[name] || /[\r\n]/u.test(env[name])) throw new Error(`CI native tooling requires ${name}.`);
	}
	// These ARM64 tools are supplied by the hosted ARM image. Select their real
// paths rather than Chocolatey's x64 shims or Visual Studio's bundled tools.
	const cmakeRoot = join(env.ProgramFiles, 'CMake', 'bin');
	const llvmRoot = join(env.ProgramFiles, 'LLVM', 'bin');
	const tar = join(env.SystemRoot, 'System32', 'tar.exe');
	const signtool = join(env['ProgramFiles(x86)'], 'Windows Kits', '10', 'bin', '10.0.26100.0', 'arm64', 'signtool.exe');
	for (const [label, path] of [
		['CMake', join(cmakeRoot, 'cmake.exe')], ['CTest', join(cmakeRoot, 'ctest.exe')],
		['Clang', join(llvmRoot, 'clang.exe')], ['ClangCL', join(llvmRoot, 'clang-cl.exe')],
		['Ninja', join(ninjaRoot, 'ninja.exe')], ['Windows tar', tar],
		['SignTool', signtool],
	]) assertNativeWindowsExecutable(await readFile(path), label);
	const directory = await mkdtemp(join(env.RUNNER_TEMP, 'soundscaper-native-tooling-'));
	try {
		const bytes = await downloadPinnedArchive(sevenZip, fetchImpl);
		const archive = join(directory, '7zip.tar.gz');
		await writeFile(archive, bytes);
		if (extract) await extract(archive, directory);
		else await extractWithTar(tar, archive, directory);
		const sevenZipPath = join(directory, '7zip', 'bin', '7za.exe');
		assertNativeWindowsExecutable(await readFile(sevenZipPath), '7-Zip');
		await rm(archive);
		const mediaRoot = windowsMediaTools
			? await installWindowsArm64MediaTools({ directory, tar, fetchImpl, extract }) : null;
		await appendFile(env.GITHUB_ENV,
			`ELECTRON_BUILDER_7ZIP_PATH=${sevenZipPath}\nSIGNTOOL_PATH=${signtool}\n`
			+ `LLVMInstallDir=${join(env.ProgramFiles, 'LLVM')}\\\n`
			+ (mediaRoot ? `FRAMESCAPER_MEDIA_MAKE=${join(mediaRoot, 'make.exe')}\n`
				+ `FRAMESCAPER_MEDIA_PKG_CONFIG=${join(mediaRoot, 'pkg-config.exe')}\n` : ''));
		await appendFile(env.GITHUB_PATH, `${cmakeRoot}\n${llvmRoot}\n${ninjaRoot}\n`
			+ (mediaRoot ? `${mediaRoot}\n` : ''));
		return [cmakeRoot, llvmRoot, ninjaRoot, sevenZipPath, signtool, ...(mediaRoot ? [mediaRoot] : [])];
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	if (process.argv.includes('--build-rcedit')) {
		if (process.platform !== 'win32' || process.arch !== 'arm64') throw new Error('rcedit requires native Windows ARM64 Node.');
		await buildWindowsArm64Rcedit();
		process.stdout.write('Built and verified native Windows ARM64 rcedit.\n');
	} else {
		const tools = await prepareCiNativeTooling({ windowsMediaTools: process.argv.includes('--windows-media-tools') });
		process.stdout.write(`Native Node.js ${process.arch}; ${tools.length ? 'verified Windows ARM64 tools' : 'using native runner tools'}.\n`);
	}
}
