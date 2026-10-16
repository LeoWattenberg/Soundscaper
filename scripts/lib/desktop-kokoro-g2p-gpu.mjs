/* SPDX-License-Identifier: AGPL-3.0-only */

/** GPU numeric backend for the unchanged learned English G2P models. */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

import recipe from '../../config/assistance-kokoro-g2p-gpu-build.json' with { type: 'json' };
import { prepareDesktopAssistanceOnnxNativeClosure } from './desktop-assistance-onnx-native-closure.mjs';

const runFile = promisify(execFile);
const TARGETS = ['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64'];
const RECIPE_FILES = [
	'native/assistance-kokoro-g2p-gpu/CMakeLists.txt',
	'native/assistance-kokoro-g2p-gpu/ort-gemm.cc',
	'desktop/assistance_kokoro_g2p_gpu.py',
	'native/assistance-onnx-webgpu-node-api/webgpu_probe.h',
	'native/assistance-onnx-webgpu-node-api/webgpu_probe_main.cc',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validateKokoroG2pGpuRecipe(value) {
	if (!value || value.schemaVersion !== 1 || value.recipeId !== 'kokoro-g2p-ort-gemm-gpu-build-v1'
		|| value.runtimeVersion !== '1.29.0' || JSON.stringify(value.executionProviders) !== '["webgpu","cpu"]'
		|| !value.recipeFiles || Object.keys(value.recipeFiles).length !== RECIPE_FILES.length
		|| Object.entries(value.recipeFiles).some(([path, sha256]) => !RECIPE_FILES.includes(path)
			|| !/^[a-f\d]{64}$/u.test(sha256))) {
		throw new TypeError('The Kokoro G2P GPU recipe or provider inventory is invalid.');
	}
	return value;
}

/** PyInstaller must copy these data files without substituting or adding native bytes. */
export async function verifyFrozenKokoroG2pGpu(root, files) {
	const entries = await readdir(root, { withFileTypes: true });
	if (entries.length !== files.length || entries.some((entry) => !entry.isFile()
		|| !files.some((file) => file.path === entry.name))) {
		throw new Error('PyInstaller changed the authenticated G2P GPU native inventory.');
	}
	for (const file of files) {
		const bytes = await readFile(join(root, file.path));
		if (bytes.byteLength !== file.byteLength || hash(bytes) !== file.sha256) {
			throw new Error('PyInstaller changed the authenticated G2P GPU native closure.');
		}
	}
}

export function desktopKokoroG2pGpuBuildPlan({ targetId, platform = process.platform, arch = process.arch }) {
	const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
	if (!TARGETS.includes(targetId) || !['darwin', 'linux', 'win32'].includes(platform)
		|| !['x64', 'arm64'].includes(arch) || !targetId.startsWith(`${os}-`)
		|| platform !== 'win32' && targetId !== `${os}-${arch}`) {
		throw new Error('Kokoro G2P GPU builds require a matching native runner.');
	}
	// The frozen Windows ARM64 Python helper already uses x64 process emulation.
	const payloadTargetId = platform === 'win32' ? 'win-x64' : targetId;
	return {
		targetId, payloadTargetId, executionProviders: ['webgpu', 'cpu'],
		generatorArgs: platform === 'win32' ? ['-A', 'x64'] : [],
		sharedLibrary: platform === 'win32' ? 'scape-g2p-gpu.dll'
			: platform === 'darwin' ? 'libscape-g2p-gpu.dylib' : 'libscape-g2p-gpu.so',
		probe: `onnx-webgpu-device-probe${platform === 'win32' ? '.exe' : ''}`,
		configureArgs: ['-DCMAKE_BUILD_TYPE=Release'],
		buildArgs: ['--config', 'Release', '--target', 'scape_g2p_gpu', 'onnx_webgpu_probe', '--parallel', '4'],
	};
}

export async function prepareDesktopKokoroG2pGpu({
	targetId, repositoryRoot, outputRoot, cacheRoot, fetchImpl = globalThis.fetch,
	platform = process.platform, arch = process.arch,
}) {
	validateKokoroG2pGpuRecipe(recipe);
	const plan = desktopKokoroG2pGpuBuildPlan({ targetId, platform, arch });
	if (![repositoryRoot, outputRoot, cacheRoot].every((path) => typeof path === 'string' && isAbsolute(path))) {
		throw new TypeError('Kokoro G2P GPU build roots must be absolute.');
	}
	for (const [path, expected] of Object.entries(recipe.recipeFiles)) {
		if (hash(await readFile(join(repositoryRoot, path))) !== expected) throw new Error(`The pinned Kokoro GPU source changed: ${path}.`);
	}
	const closure = await prepareDesktopAssistanceOnnxNativeClosure({
		targetId: plan.payloadTargetId, outputRoot, cacheRoot, fetchImpl,
	});
	const work = await mkdtemp(join(cacheRoot, 'kokoro-g2p-gpu-'));
	try {
		const build = join(work, 'compiled');
		const configure = ['-S', join(repositoryRoot, 'native/assistance-kokoro-g2p-gpu'), '-B', build,
			...plan.generatorArgs, ...plan.configureArgs,
			`-DORT_HEADERS=${closure.includeRoot}`, `-DORT_LIBRARY=${closure.libraryPath}`,
			`-DPROBE_SOURCE=${join(repositoryRoot, 'native/assistance-onnx-webgpu-node-api')}`,
			`-DSCAPE_WORK_ROOT=${work}`];
		const env = { ...process.env, SOURCE_DATE_EPOCH: '1787225940', TZ: 'UTC', LC_ALL: 'C', GIT_CEILING_DIRECTORIES: work };
		const cmakeVersion = (await command('cmake', ['--version'], work, env)).stdout.split('\n')[0].trim();
		await command('cmake', configure, work, env);
		await command('cmake', ['--build', build, ...plan.buildArgs], work, env);
		const files = [...closure.files];
		for (const path of [plan.sharedLibrary, plan.probe]) {
			const built = join(build, platform === 'win32' ? 'Release' : '', path);
			const bytes = await readFile(built);
			assertTargetBinary(bytes, plan.payloadTargetId);
			await copyFile(built, join(outputRoot, path));
			if (path === plan.probe) await chmod(join(outputRoot, path), 0o755);
			files.push({ path, byteLength: bytes.byteLength, sha256: hash(bytes), ...(path === plan.probe ? { executable: true } : {}) });
		}
		const provenance = {
			schemaVersion: 1, recipeId: recipe.recipeId, targetId, payloadTargetId: plan.payloadTargetId,
			executionProviders: plan.executionProviders, runtimeVersion: recipe.runtimeVersion,
			recipeFiles: recipe.recipeFiles, sourcePins: closure.sourcePins, sourceDateEpoch: 1787225940,
			cmakeVersion, configureArgs: plan.configureArgs, buildArgs: plan.buildArgs,
		};
		const bytes = Buffer.from(`${JSON.stringify(provenance, null, '\t')}\n`);
		await writeFile(join(outputRoot, 'g2p-gpu-build-provenance.json'), bytes);
		files.push({ path: 'g2p-gpu-build-provenance.json', byteLength: bytes.byteLength, sha256: hash(bytes) });
		return { files, provenance };
	} finally { await rm(work, { recursive: true, force: true }); }
}

function assertTargetBinary(bytes, targetId) {
	let valid = false;
	if (bytes.byteLength >= 64 && targetId.startsWith('linux-')) {
		valid = bytes.readUInt32BE(0) === 0x7f454c46 && bytes[4] === 2 && bytes[5] === 1
			&& bytes.readUInt16LE(18) === (targetId.endsWith('arm64') ? 183 : 62);
	} else if (bytes.byteLength >= 64 && targetId === 'win-x64') {
		const pe = bytes.readUInt32LE(0x3c);
		valid = bytes.readUInt16LE(0) === 0x5a4d && pe + 6 <= bytes.byteLength
			&& bytes.readUInt32LE(pe) === 0x4550 && bytes.readUInt16LE(pe + 4) === 0x8664;
	} else if (bytes.byteLength >= 32 && targetId === 'mac-arm64') {
		valid = bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === 0x100000c;
	}
	if (!valid) throw new Error('The Kokoro G2P GPU native file has a foreign binary architecture.');
}

async function command(file, args, cwd, env) {
	try { return await runFile(file, args, { cwd, env, maxBuffer: 64 * 1024 * 1024 }); }
	catch (cause) { throw new Error(`Kokoro GPU ${file} failed: ${cause.stderr || cause.stdout || cause.message}`, { cause }); }
}
