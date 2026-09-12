/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { extract, list } from 'tar';
import { desktopWhisperCppNotices } from './desktop-assistance-whisper-notices.mjs';

const runFile = promisify(execFile);
export const WHISPER_RUNTIME_VERSION = 'v1.9.3';
export const WHISPER_RUNTIME_BUILD_TARGETS = Object.freeze(['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64']);
const VERSION = WHISPER_RUNTIME_VERSION;
const COMMIT = '371b5a7561823ab2bb32142d2751e35e7534727b';
const SOURCE_ROOT = `whisper.cpp-${COMMIT}`;
const SOURCE_URL = `https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/${COMMIT}`;
const SOURCE_SHA256 = '89051d8fca516a3ad1f5c2f8f9d2fccb089afbaec338fca3f8731999babc6f81';
const MAXIMUM_SOURCE_BYTES = 16 * 1024 * 1024;
const CLI_SOURCE_SHA256 = '840f331f80a98c41fc21eb4cf109c4c6a5496b8f248e9bbce58dd733dece76b2';
const STDOUT_BEFORE = '#ifdef _WIN32\n                    fout = std::ofstream{"CON"};\n#else\n                    fout = std::ofstream{"/dev/stdout"};\n#endif';
const STDOUT_AFTER = '                    fout.basic_ios<char>::rdbuf(std::cout.rdbuf());';
const TARGETS = WHISPER_RUNTIME_BUILD_TARGETS;
const DISABLED_OPTIONS = [
	'BUILD_SHARED_LIBS', 'WHISPER_BUILD_IS_DEV', 'WHISPER_BUILD_TESTS', 'WHISPER_BUILD_SERVER', 'WHISPER_CURL',
	'WHISPER_SDL2', 'WHISPER_COMMON_FFMPEG', 'WHISPER_COREML', 'WHISPER_OPENVINO',
	'GGML_NATIVE', 'GGML_BACKEND_DL', 'GGML_OPENMP', 'GGML_METAL', 'GGML_ACCELERATE',
	'GGML_BLAS', 'GGML_LLAMAFILE', 'GGML_CCACHE', 'GGML_CPU_KLEIDIAI', 'GGML_CUDA',
	'GGML_HIP', 'GGML_MUSA', 'GGML_VULKAN', 'GGML_WEBGPU', 'GGML_SYCL', 'GGML_OPENCL',
	'GGML_AVX', 'GGML_AVX2', 'GGML_FMA', 'GGML_F16C', 'GGML_BMI2', 'GGML_SSE42',
];

/** Build pinned source on the package runner, then bind the actual shipped bytes. */
export async function stageDesktopWhisperCppRuntime({
	targetId, runtimeRoot, cacheRoot, platform = process.platform, architecture = process.arch,
}) {
	const plan = desktopWhisperCppBuildPlan({ targetId, platform, architecture });
	if (!isAbsolute(runtimeRoot) || !isAbsolute(cacheRoot)) {
		throw new TypeError('Whisper staging requires absolute runtime and cache roots.');
	}
	const cache = resolve(cacheRoot, 'whisper-cpp', COMMIT);
	await mkdir(cache, { recursive: true });
	const archiveBytes = await authenticatedArchive(cache);
	const work = await mkdtemp(join(cache, 'build-'));
	try {
		const archive = join(work, 'source.tar.gz');
		await writeFile(archive, archiveBytes, { flag: 'wx', mode: 0o400 });
		await extractSource(archive, work);
		const source = join(work, SOURCE_ROOT), build = join(work, 'build');
		const cliPath = join(source, 'examples', 'cli', 'cli.cpp');
		const cliSource = await readFile(cliPath, 'utf8');
		if (hash(cliSource) !== CLI_SOURCE_SHA256) throw new Error('Whisper CLI compatibility patch source changed.');
		const patchedCli = patchWhisperCppPipedStdout(cliSource);
		await writeFile(cliPath, patchedCli);
		const configureArgs = ['-S', source, '-B', build, ...plan.configureArgs];
		if (platform !== 'win32') {
			const reproducibleFlags = `-ffile-prefix-map=${work}=/usr/src/whisper-build -fno-ident`;
			configureArgs.push(`-DCMAKE_C_FLAGS=${reproducibleFlags}`, `-DCMAKE_CXX_FLAGS=${reproducibleFlags}`);
		}
		const environment = { ...process.env, SOURCE_DATE_EPOCH: '1787225940', TZ: 'UTC', LC_ALL: 'C' };
		const cmakeVersion = (await command('cmake', ['--version'], work, environment)).stdout.split('\n')[0].trim();
		await command('cmake', configureArgs, work, environment);
		await command('cmake', ['--build', build, '--config', 'Release', '--target', 'whisper-cli', '--parallel', '4'], work, environment);
		const binary = await builtExecutable(build, plan.executable);
		const compiler = await compilerIdentity(build);
		const notices = await desktopWhisperCppNotices({ sourceRoot: source, platform, compiler });
		const provenance = {
			schemaVersion: 1, recipeId: 'whisper-cpp-cpu-package-build-v1', targetId,
			source: { url: SOURCE_URL, commit: COMMIT, sha256: SOURCE_SHA256 },
			cmakeVersion, compiler, sourceDateEpoch: Number(environment.SOURCE_DATE_EPOCH), configureArgs: plan.configureArgs,
			notices: notices.map(({ path, bytes, sources }) => ({ path, sources,
				byteLength: bytes.byteLength, sha256: hash(bytes) })),
			patches: [{ id: 'piped-json-stdout-v1', file: 'examples/cli/cli.cpp',
				inputSha256: CLI_SOURCE_SHA256, outputSha256: hash(patchedCli),
				patchSha256: hash(JSON.stringify({ before: STDOUT_BEFORE, after: STDOUT_AFTER,
					include: '#include <iostream>' })) }],
			reproducibleFlags: platform === 'win32' ? ['/Brepro'] : ['-ffile-prefix-map=<work>=/usr/src/whisper-build', '-fno-ident'],
		};
		const targetRoot = join(runtimeRoot, 'assistance', 'whisper-cpp', VERSION, targetId);
		await mkdir(targetRoot, { recursive: true });
		if ((await readdir(targetRoot)).length !== 0) throw new Error('Whisper destination must be empty.');
		await copyFile(binary, join(targetRoot, plan.executable));
		await chmod(join(targetRoot, plan.executable), 0o755);
		if (platform === 'darwin') await command('codesign', ['--force', '--sign', '-',
			join(targetRoot, plan.executable)], work, environment);
		const version = await command(join(targetRoot, plan.executable), ['--version'], work, environment);
		if (version.stdout.trim() !== 'whisper.cpp version: 1.9.3') {
			throw new Error('Whisper built executable did not report the pinned runtime version.');
		}
		await copyFile(join(source, 'LICENSE'), join(targetRoot, 'LICENSE'));
		for (const notice of notices) await writeFile(join(targetRoot, notice.path), notice.bytes, { flag: 'wx' });
		await writeFile(join(targetRoot, 'build-provenance.json'), `${JSON.stringify(provenance, null, '\t')}\n`, { flag: 'wx' });
		const files = await Promise.all([plan.executable, 'LICENSE', 'build-provenance.json', ...notices.map(({ path }) => path)].map(async (path) => {
			const bytes = await readFile(join(targetRoot, path));
			return { path, byteLength: bytes.byteLength, sha256: hash(bytes), executable: path === plan.executable };
		}));
		const target = { id: targetId, status: 'authenticated', entrypoint: plan.executable, files };
		return {
			manifest: {
				schemaVersion: 1, familyId: 'whisper-cpp', runtimeVersion: VERSION,
				source: { url: `https://github.com/ggml-org/whisper.cpp/releases/tag/${VERSION}`, revision: VERSION },
				executionProvider: 'cpu', runtimePrefix: `assistance/whisper-cpp/${VERSION}`,
				targets: TARGETS.map((id) => id === targetId ? target : {
					id, status: 'pending-external', blockedBy: 'This package contains only the CPU runtime compiled for its own target.',
				}),
			},
			summary: { familyId: 'whisper-cpp', targetId, runtimeVersion: VERSION, provenance,
				files, installedBytes: files.reduce((total, file) => total + file.byteLength, 0) },
		};
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

/** Reopening CON or /dev/stdout bypasses or fails on the worker's stdout pipe. */
export function patchWhisperCppPipedStdout(source) {
	if (source.split(STDOUT_BEFORE).length !== 2 || source.split('#include <fstream>').length !== 2) {
		throw new Error('Whisper piped stdout patch does not match its exact source context.');
	}
	return source.replace('#include <fstream>', '#include <fstream>\n#include <iostream>')
		.replace(STDOUT_BEFORE, STDOUT_AFTER);
}

export function desktopWhisperCppBuildPlan({ targetId, platform, architecture }) {
	if (!TARGETS.includes(targetId)) throw new TypeError('Whisper target is unsupported.');
	const operatingSystem = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
	if (!targetId.startsWith(`${operatingSystem}-`)
		|| (platform !== 'win32' && targetId !== `${operatingSystem}-${architecture}`)) {
		throw new Error('Whisper requires a native package runner or the Windows ARM64 CMake target.');
	}
	const configureArgs = ['-DCMAKE_BUILD_TYPE=Release', '-DWHISPER_BUILD_EXAMPLES=ON',
		...DISABLED_OPTIONS.map((name) => `-D${name}=OFF`)];
	if (platform === 'win32') configureArgs.push('-A', targetId === 'win-arm64' ? 'ARM64' : 'x64',
		'-DCMAKE_POLICY_DEFAULT_CMP0091=NEW', '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded', '-DCMAKE_EXE_LINKER_FLAGS=/Brepro',
		'-DCMAKE_C_FLAGS=/Brepro', '-DCMAKE_CXX_FLAGS=/Brepro /EHsc');
	// ggml rejects MSVC on ARM; ClangCL uses the same Windows SDK and static CRT.
	if (targetId === 'win-arm64') configureArgs.push('-T', 'ClangCL');
	if (platform === 'darwin') configureArgs.push('-DCMAKE_OSX_ARCHITECTURES=arm64');
	if (platform === 'linux') configureArgs.push('-DCMAKE_EXE_LINKER_FLAGS=-static-libgcc -static-libstdc++');
	return { targetId, executable: platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli', configureArgs };
}

async function authenticatedArchive(cache) {
	const archive = join(cache, 'source.tar.gz');
	let bytes;
	try { bytes = await readFile(archive); }
	catch (error) { if (error.code !== 'ENOENT') throw error; }
	if (bytes !== undefined) {
		if (bytes.byteLength > MAXIMUM_SOURCE_BYTES || hash(bytes) !== SOURCE_SHA256) {
			throw new Error('Cached Whisper source archive failed its pinned digest.');
		}
		return bytes;
	}
	const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(120_000) });
	if (!response.ok || !response.body) throw new Error(`Whisper source download failed: ${response.status}`);
	const chunks = [];
	let length = 0;
	for await (const value of response.body) {
		length += value.byteLength;
		if (length > MAXIMUM_SOURCE_BYTES) throw new RangeError('Whisper source exceeds its download bound.');
		chunks.push(value);
	}
	bytes = Buffer.concat(chunks);
	if (hash(bytes) !== SOURCE_SHA256) throw new Error('Whisper source archive failed its pinned digest.');
	await writeFile(archive, bytes, { flag: 'wx' });
	return bytes;
}

async function extractSource(archive, destination) {
	await list({ file: archive, strict: true, onentry(entry) {
		const components = entry.path.split('/').filter(Boolean);
		if (components[0] !== SOURCE_ROOT || components.some((part) => part === '..' || part === '.')
			|| entry.path.includes('\\') || !['File', 'Directory'].includes(entry.type)) {
			throw new Error('Whisper archive contains an unexpected source entry.');
		}
	} });
	await extract({ file: archive, cwd: destination, strict: true, preservePaths: false });
}

async function builtExecutable(build, name) {
	for (const path of [join(build, 'bin', name), join(build, 'bin', 'Release', name)]) {
		try {
			const stat = await lstat(path);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) throw new Error('Whisper executable is invalid.');
			return path;
		} catch (error) { if (error.code !== 'ENOENT') throw error; }
	}
	throw new Error('Whisper CMake build did not produce its executable.');
}

async function compilerIdentity(build) {
	const versions = await readdir(join(build, 'CMakeFiles'));
	for (const version of versions.filter((name) => /^\d+\.\d+/u.test(name))) {
		const source = await readFile(join(build, 'CMakeFiles', version, 'CMakeCXXCompiler.cmake'), 'utf8');
		const compilerId = /set\(CMAKE_CXX_COMPILER_ID "([^"]+)"\)/u.exec(source)?.[1];
		const compilerVersion = /set\(CMAKE_CXX_COMPILER_VERSION "([^"]+)"\)/u.exec(source)?.[1];
		if (compilerId && compilerVersion) return { id: compilerId, version: compilerVersion };
	}
	throw new Error('Whisper compiler provenance could not be read.');
}

async function command(executable, args, cwd, env) {
	try { return await runFile(executable, args, { cwd, env, windowsHide: true,
		maxBuffer: 8 * 1024 * 1024, timeout: 15 * 60_000 }); }
	catch (error) { throw new Error(`Whisper build failed: ${executable} ${args.join(' ')}\n${error.stderr ?? ''}\n${error.stdout ?? ''}`, { cause: error }); }
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
