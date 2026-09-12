/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { extract, list } from 'tar';
import { desktopLlamaCppNotices } from './desktop-assistance-llama-notices.mjs';

const runFile = promisify(execFile);
export const LLAMA_RUNTIME_VERSION = 'b10509';
export const LLAMA_RUNTIME_BUILD_TARGETS = Object.freeze(['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64']);
const COMMIT = 'fe8156f789011f6ea0baf6917ea09f88b89d9554';
const SOURCE_ROOT = `llama.cpp-${COMMIT}`;
const SOURCE_URL = `https://codeload.github.com/ggml-org/llama.cpp/tar.gz/${COMMIT}`;
const SOURCE_SHA256 = 'e26beb2d3e45ea6fc3d611fa98b69159e1c3ca15473197375bd2af8b1cd281c1';
const SOURCE_BYTES = 36_871_166;
const SOURCE_DATE_EPOCH = '1787141097';
const COMPLETION_SOURCE_SHA256 = '290ae2ba7e3960fd6a7f7e066ba1d6726caec423188627a9740e1a47a4fd08db';
const COMPLETION_PATCHES = [
	{ before: '                inputs.force_pure_content = params.force_pure_content_parser;',
		after: '                inputs.force_pure_content = params.force_pure_content_parser;\n                inputs.enable_thinking = params.enable_reasoning != 0;' },
	{ before: '            LOG(" [end of text]\\n");', after: '            LOG_DBG(" [end of text]\\n");' },
];
const DISABLED_OPTIONS = [
	'BUILD_SHARED_LIBS', 'LLAMA_BUILD_TESTS', 'LLAMA_BUILD_EXAMPLES', 'LLAMA_BUILD_APP',
	'LLAMA_BUILD_SERVER', 'LLAMA_BUILD_UI', 'LLAMA_USE_PREBUILT_UI', 'LLAMA_OPENSSL',
	'LLAMA_SUBPROCESS', 'LLAMA_LLGUIDANCE', 'LLAMA_USE_SYSTEM_GGML',
	'GGML_NATIVE', 'GGML_BACKEND_DL', 'GGML_OPENMP', 'GGML_METAL', 'GGML_ACCELERATE', 'GGML_BLAS',
	'GGML_LLAMAFILE', 'GGML_CCACHE', 'GGML_CPU_KLEIDIAI', 'GGML_CUDA', 'GGML_HIP',
	'GGML_MUSA', 'GGML_VULKAN', 'GGML_WEBGPU', 'GGML_SYCL', 'GGML_OPENCL', 'GGML_RPC',
	'GGML_CANN', 'GGML_ZENDNN', 'GGML_AVX', 'GGML_AVX2', 'GGML_FMA', 'GGML_F16C',
	'GGML_BMI2', 'GGML_SSE42', 'GGML_CPU_HBM', 'GGML_CPU_ALL_VARIANTS',
];

export function desktopLlamaCppBuildPlan({ targetId, platform, architecture }) {
	if (!LLAMA_RUNTIME_BUILD_TARGETS.includes(targetId)) throw new TypeError('The llama.cpp target is unsupported.');
	const operatingSystem = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
	if (!targetId.startsWith(`${operatingSystem}-`)
		|| (platform !== 'win32' && targetId !== `${operatingSystem}-${architecture}`)) {
		throw new Error('llama.cpp requires a native package runner or the Windows ARM64 CMake target.');
	}
	const configureArgs = ['-DCMAKE_BUILD_TYPE=Release', '-DLLAMA_BUILD_COMMON=ON', '-DLLAMA_BUILD_TOOLS=ON',
		'-DLLAMA_BUILD_NUMBER=10509', `-DLLAMA_BUILD_COMMIT=${COMMIT}`,
		...DISABLED_OPTIONS.map((name) => `-D${name}=OFF`)];
	if (platform === 'win32') configureArgs.push('-A', targetId === 'win-arm64' ? 'ARM64' : 'x64',
		'-DCMAKE_POLICY_DEFAULT_CMP0091=NEW', '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded',
		'-DCMAKE_EXE_LINKER_FLAGS=/Brepro', '-DCMAKE_C_FLAGS=/Brepro', '-DCMAKE_CXX_FLAGS=/Brepro /EHsc');
	if (targetId === 'win-arm64') configureArgs.push('-T', 'ClangCL');
	if (platform === 'darwin') configureArgs.push('-DCMAKE_OSX_ARCHITECTURES=arm64');
	if (platform === 'linux') configureArgs.push('-DCMAKE_EXE_LINKER_FLAGS=-static-libgcc -static-libstdc++');
	return { targetId, target: 'llama-completion', executable: platform === 'win32' ? 'llama-completion.exe' : 'llama-completion', configureArgs };
}

/** Compile authenticated CPU source, then bind the actual executable and notices. */
export async function stageDesktopLlamaCppRuntime({
	targetId, runtimeRoot, cacheRoot, platform = process.platform, architecture = process.arch,
}) {
	const plan = desktopLlamaCppBuildPlan({ targetId, platform, architecture });
	if (!isAbsolute(runtimeRoot) || !isAbsolute(cacheRoot)) throw new TypeError('llama.cpp staging requires absolute runtime and cache roots.');
	const cache = resolve(cacheRoot, 'llama-cpp', COMMIT);
	await mkdir(cache, { recursive: true });
	const archive = await authenticatedArchive(cache);
	const work = await mkdtemp(join(cache, 'build-'));
	try {
		await extractSource(archive, work);
		const source = join(work, SOURCE_ROOT), build = join(work, 'build');
		const completionPath = join(source, 'tools', 'completion', 'completion.cpp');
		const completionSource = await readFile(completionPath, 'utf8');
		if (hash(completionSource) !== COMPLETION_SOURCE_SHA256) throw new Error('The llama.cpp completion patch source changed.');
		const patchedCompletion = patchLlamaCppCompletion(completionSource);
		await writeFile(completionPath, patchedCompletion);
		const configureArgs = ['-S', source, '-B', build, ...plan.configureArgs];
		if (platform !== 'win32') {
			const flags = `-ffile-prefix-map=${work}=/usr/src/llama-build -fno-ident`;
			configureArgs.push(`-DCMAKE_C_FLAGS=${flags}`, `-DCMAKE_CXX_FLAGS=${flags}`);
		}
		const environment = { ...process.env, SOURCE_DATE_EPOCH, TZ: 'UTC', LC_ALL: 'C', GIT_CEILING_DIRECTORIES: work };
		const cmakeVersion = (await command('cmake', ['--version'], work, environment)).stdout.split('\n')[0].trim();
		await command('cmake', configureArgs, work, environment);
		await command('cmake', ['--build', build, '--config', 'Release', '--target', plan.target, '--parallel', '4'], work, environment);
		const binary = await builtExecutable(build, plan.executable);
		const compiler = await compilerIdentity(build);
		const notices = await desktopLlamaCppNotices({ sourceRoot: source, platform, compiler });
		const provenance = {
			schemaVersion: 1, recipeId: 'llama-cpp-cpu-package-build-v1', targetId,
			source: { url: SOURCE_URL, commit: COMMIT, sha256: SOURCE_SHA256, byteLength: SOURCE_BYTES },
			cmakeVersion, compiler, sourceDateEpoch: Number(SOURCE_DATE_EPOCH), configureArgs: plan.configureArgs,
			notices: notices.map(({ path, bytes, sources }) => ({ path, sources, byteLength: bytes.byteLength, sha256: hash(bytes) })),
			patches: [{ id: 'completion-reasoning-and-json-stdout-v1', file: 'tools/completion/completion.cpp',
				inputSha256: COMPLETION_SOURCE_SHA256, outputSha256: hash(patchedCompletion),
				patchSha256: hash(JSON.stringify(COMPLETION_PATCHES)) }],
			reproducibleFlags: platform === 'win32' ? ['/Brepro'] : ['-ffile-prefix-map=<work>=/usr/src/llama-build', '-fno-ident'],
		};
		const targetRoot = join(runtimeRoot, 'assistance', 'llama-cpp', LLAMA_RUNTIME_VERSION, targetId);
		await mkdir(targetRoot, { recursive: true });
		if ((await readdir(targetRoot)).length !== 0) throw new Error('The llama.cpp destination must be empty.');
		await copyFile(binary, join(targetRoot, plan.executable));
		await chmod(join(targetRoot, plan.executable), 0o755);
		if (platform === 'darwin') await command('codesign', ['--force', '--sign', '-', join(targetRoot, plan.executable)], work, environment);
		const version = await command(join(targetRoot, plan.executable), ['--version'], work, environment);
		if (!`${version.stdout}\n${version.stderr}`.includes(`build 10509, commit ${COMMIT}`)) {
			throw new Error('The llama.cpp executable did not report its pinned build identity.');
		}
		await copyFile(join(source, 'LICENSE'), join(targetRoot, 'LICENSE'));
		for (const notice of notices) await writeFile(join(targetRoot, notice.path), notice.bytes, { flag: 'wx' });
		await writeFile(join(targetRoot, 'build-provenance.json'), `${JSON.stringify(provenance, null, '\t')}\n`, { flag: 'wx' });
		const files = await Promise.all([plan.executable, 'LICENSE', 'build-provenance.json', ...notices.map(({ path }) => path)].map(async (path) => {
			const bytes = await readFile(join(targetRoot, path));
			return { path, byteLength: bytes.byteLength, sha256: hash(bytes), executable: path === plan.executable };
		}));
		return {
			manifest: {
				schemaVersion: 1, familyId: 'llama-cpp', runtimeVersion: LLAMA_RUNTIME_VERSION,
				source: { url: 'https://github.com/ggml-org/llama.cpp', revision: LLAMA_RUNTIME_VERSION },
				executionProvider: 'cpu', runtimePrefix: `assistance/llama-cpp/${LLAMA_RUNTIME_VERSION}`,
				targets: LLAMA_RUNTIME_BUILD_TARGETS.map((id) => id === targetId
					? { id, status: 'authenticated', entrypoint: plan.executable, files }
					: { id, status: 'pending-external', blockedBy: 'This package contains only the CPU runtime compiled for its own target.' }),
			},
			summary: { familyId: 'llama-cpp', targetId, runtimeVersion: LLAMA_RUNTIME_VERSION, provenance,
				files, installedBytes: files.reduce((total, file) => total + file.byteLength, 0) },
		};
	} finally { await rm(work, { recursive: true, force: true }); }
}

/** The upstream completion tool omits reasoning settings and adds a human stdout trailer. */
export function patchLlamaCppCompletion(source) {
	for (const { before, after } of COMPLETION_PATCHES) {
		if (source.split(before).length !== 2 || source.includes(after)) {
			throw new Error('The llama.cpp completion patch does not match its exact source context.');
		}
		source = source.replace(before, after);
	}
	return source;
}

async function authenticatedArchive(cache) {
	const path = join(cache, 'source.tar.gz');
	let bytes;
	try { bytes = await readFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
	if (bytes !== undefined) { verifyArchive(bytes); return path; }
	const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(120_000) });
	if (!response.ok || !response.body) throw new Error(`llama.cpp source download failed: ${response.status}`);
	const chunks = []; let length = 0;
	for await (const chunk of response.body) {
		length += chunk.byteLength;
		if (length > SOURCE_BYTES) throw new RangeError('llama.cpp source exceeds its pinned length.');
		chunks.push(chunk);
	}
	bytes = Buffer.concat(chunks); verifyArchive(bytes);
	await writeFile(path, bytes, { flag: 'wx' });
	return path;
}

function verifyArchive(bytes) {
	if (bytes.byteLength !== SOURCE_BYTES || hash(bytes) !== SOURCE_SHA256) throw new Error('llama.cpp source archive failed its pinned integrity.');
}

async function extractSource(archive, destination) {
	await list({ file: archive, strict: true, onentry(entry) {
		const components = entry.path.split('/').filter(Boolean);
		if (components[0] !== SOURCE_ROOT || components.some((part) => part === '..' || part === '.')
			|| entry.path.includes('\\') || !['File', 'Directory'].includes(entry.type)) throw new Error('llama.cpp source archive contains an unexpected entry.');
	} });
	await extract({ file: archive, cwd: destination, strict: true, preservePaths: false });
}

async function builtExecutable(build, name) {
	for (const path of [join(build, 'bin', name), join(build, 'bin', 'Release', name)]) {
		try {
			const stat = await lstat(path);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) throw new Error('The llama.cpp executable is invalid.');
			return path;
		} catch (error) { if (error.code !== 'ENOENT') throw error; }
	}
	throw new Error('The llama.cpp build produced no completion executable.');
}

async function compilerIdentity(build) {
	for (const version of (await readdir(join(build, 'CMakeFiles'))).filter((name) => /^\d+\.\d+/u.test(name))) {
		const source = await readFile(join(build, 'CMakeFiles', version, 'CMakeCXXCompiler.cmake'), 'utf8');
		const id = /set\(CMAKE_CXX_COMPILER_ID "([^"]+)"\)/u.exec(source)?.[1];
		const versionNumber = /set\(CMAKE_CXX_COMPILER_VERSION "([^"]+)"\)/u.exec(source)?.[1];
		if (id && versionNumber) return { id, version: versionNumber };
	}
	throw new Error('The llama.cpp compiler identity could not be read.');
}

async function command(executable, args, cwd, env) {
	try { return await runFile(executable, args, { cwd, env, windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 30 * 60_000 }); }
	catch (error) { throw new Error(`llama.cpp build failed: ${executable} ${args.join(' ')}\n${error.stderr ?? ''}\n${error.stdout ?? ''}`, { cause: error }); }
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
