/* SPDX-License-Identifier: AGPL-3.0-only */

/** Rebuild only the Node-API bridge; the reviewed ORT core remains unchanged. */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { extract } from 'tar';

import recipe from '../../config/assistance-onnx-node-api-build.json' with { type: 'json' };
import {
	authenticatedOnnxSource,
	prepareDesktopAssistanceOnnxNativeClosure,
} from './desktop-assistance-onnx-native-closure.mjs';

const runFile = promisify(execFile);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const SOURCE = recipe.sources.find(({ path }) => path.endsWith('/session_options_helper.cc'));
const TARGETS = ['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64'];

export function desktopOnnxWebGpuBindingBuildPlan({ targetId, platform = process.platform, architecture = process.arch }) {
	const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
	if (!TARGETS.includes(targetId) || !['darwin', 'linux', 'win32'].includes(platform)
		|| !['x64', 'arm64'].includes(architecture) || !targetId.startsWith(`${os}-`)
		|| platform !== 'win32' && targetId !== `${os}-${architecture}`) {
		throw new Error('The ONNX WebGPU bridge requires a matching native target runner.');
	}
	return {
		generatorArgs: platform === 'win32' ? ['-A', targetId === 'win-arm64' ? 'ARM64' : 'x64'] : [],
		targetId, configureArgs: ['-DCMAKE_BUILD_TYPE=Release',
			`-DORT_NODE_SOURCE_FILES=${recipe.sources.filter(({ path }) => path.endsWith('.cc')).map(({ path }) => basename(path)).join(';')}`],
		buildArgs: ['--config', 'Release', '--target', 'onnxruntime_binding', 'onnx_webgpu_probe',
			'onnx_webgpu_device_test', '--parallel', '4'],
	};
}

export function patchDesktopOnnxWebGpuSessionProvider(source) {
	if (typeof source !== 'string' || Buffer.byteLength(source) !== SOURCE.byteLength || hash(source) !== SOURCE.sha256) {
		throw new Error('The ONNX provider patch requires the exact pinned source.');
	}
	const patched = source.replace('#include "core/providers/webgpu/webgpu_provider_factory.h"', '#include "webgpu_plugin_provider.h"')
		.replace('#include "core/providers/coreml/coreml_provider_factory.h"', '#include "coreml_provider_factory.h"')
		.replace('sessionOptions.AppendExecutionProvider("WebGPU", webgpu_options);', 'ScapeAppendWebGpuPlugin(sessionOptions, webgpu_options);');
	if (hash(patched) !== recipe.patchedSessionOptionsSha256) throw new Error('The reviewed ONNX provider patch differs from its pinned result.');
	return patched;
}

export async function prepareDesktopAssistanceOnnxWebGpuBinding({
	targetId, repositoryRoot, outputRoot, cacheRoot, fetchImpl = globalThis.fetch,
}) {
	const plan = desktopOnnxWebGpuBindingBuildPlan({ targetId });
	if (![repositoryRoot, outputRoot, cacheRoot].every((path) => typeof path === 'string' && isAbsolute(path))) {
		throw new TypeError('The ONNX bridge build requires absolute roots.');
	}
	const closure = await prepareDesktopAssistanceOnnxNativeClosure({ targetId, outputRoot, cacheRoot, fetchImpl });
	const work = await mkdtemp(join(cacheRoot, 'onnx-node-api-'));
	try {
		const sourceRoot = join(work, 'source');
		for (const source of recipe.sources) {
			const destination = join(sourceRoot, source.path);
			await mkdir(dirname(destination), { recursive: true });
			await copyFile(await authenticatedOnnxSource(source, cacheRoot, fetchImpl), destination);
		}
		const providerPath = join(sourceRoot, SOURCE.path);
		await writeFile(providerPath, patchDesktopOnnxWebGpuSessionProvider(await readFile(providerPath, 'utf8')));
		const headers = join(work, 'headers'), addonApi = join(work, 'node-addon-api');
		for (const [id, destination, include] of [
			['node-headers', headers, (path) => path.startsWith('include/node/') && path.endsWith('.h')],
			['node-addon-api', addonApi, (path) => /^(?:napi(?:-inl(?:\.deprecated)?)?\.h|LICENSE\.md)$/u.test(path)],
		]) {
			const source = recipe.dependencies.find((candidate) => candidate.id === id);
			await extractFiles(await authenticatedOnnxSource(source, cacheRoot, fetchImpl), destination, include);
		}
		const cmakeRoot = join(repositoryRoot, 'native/assistance-onnx-webgpu-node-api');
		for (const [name, expected] of Object.entries(recipe.recipeFiles)) {
			if (hash(await readFile(join(cmakeRoot, name))) !== expected) {
				throw new Error('The ONNX bridge build recipe differs from its reviewed digest.');
			}
		}
		const build = join(work, 'compiled');
		const configureArgs = ['-S', cmakeRoot, '-B', build, ...plan.generatorArgs, ...plan.configureArgs,
			`-DORT_NODE_SOURCE=${join(sourceRoot, 'js/node/src')}`, `-DORT_HEADERS=${closure.includeRoot}`,
			`-DORT_LIBRARY=${closure.libraryPath}`, `-DNODE_HEADERS=${headers}`, `-DNODE_ADDON_API=${addonApi}`,
			`-DSCAPE_WORK_ROOT=${work}`];
		if (targetId.startsWith('win-')) {
			const nodeLibrary = join(work, 'node.lib'), hook = join(work, 'win_delay_load_hook.cc');
			const source = recipe.dependencies.find(({ id }) => id === (targetId === 'win-arm64' ? 'node-arm64-lib' : 'node-x64-lib'));
			await copyFile(await authenticatedOnnxSource(source, cacheRoot, fetchImpl), nodeLibrary);
			await copyFile(await authenticatedOnnxSource(recipe.dependencies.find(({ id }) => id === 'node-delay-hook'), cacheRoot, fetchImpl), hook);
			configureArgs.push(`-DNODE_LIBRARY=${nodeLibrary}`, `-DNODE_DELAY_HOOK=${hook}`);
		}
		const cmakeVersion = (await command('cmake', ['--version'], work)).stdout.split('\n')[0].trim();
		await command('cmake', configureArgs, work);
		await command('cmake', ['--build', build, ...plan.buildArgs], work);
		const binaryRoot = targetId.startsWith('win-') ? join(build, 'Release') : build;
		if (targetId.endsWith(`-${process.arch}`)) {
			await command(join(binaryRoot, `onnx_webgpu_device_test${targetId.startsWith('win-') ? '.exe' : ''}`),
				['authenticated-plugin-fixture'], work);
		}
		const binary = join(binaryRoot, 'onnxruntime_binding.node');
		assertOnnxBinaryArchitecture(await readFile(binary), targetId);
		await copyFile(binary, join(outputRoot, 'onnxruntime_binding.node'));
		const probeName = `onnx-webgpu-device-probe${targetId.startsWith('win-') ? '.exe' : ''}`;
		const probe = join(binaryRoot, probeName);
		assertOnnxBinaryArchitecture(await readFile(probe), targetId);
		await copyFile(probe, join(outputRoot, probeName));
		await chmod(join(outputRoot, probeName), 0o755);
		await copyFile(join(addonApi, 'LICENSE.md'), join(outputRoot, 'NODE-ADDON-API-LICENSE'));
		const nodeLicense = recipe.dependencies.find(({ id }) => id === 'node-license');
		await copyFile(await authenticatedOnnxSource(nodeLicense, cacheRoot, fetchImpl), join(outputRoot, 'NODE-LICENSE'));
		if (targetId.startsWith('win-')) {
			const hookLicense = recipe.dependencies.find(({ id }) => id === 'node-gyp-license');
			await copyFile(await authenticatedOnnxSource(hookLicense, cacheRoot, fetchImpl), join(outputRoot, 'NODE-GYP-LICENSE'));
		}
		const provenance = {
			schemaVersion: 1, recipeId: recipe.recipeId, targetId, sourceRevision: recipe.sourceRevision,
			runtimeVersion: recipe.runtimeVersion, nodeHeadersVersion: recipe.nodeHeadersVersion,
			nodeAddonApiVersion: recipe.nodeAddonApiVersion, recipeFiles: recipe.recipeFiles,
			patchedSessionOptionsSha256: recipe.patchedSessionOptionsSha256,
			cmakeVersion, compiler: await compilerIdentity(build), configureArgs: [...plan.generatorArgs, ...plan.configureArgs],
			sources: [...closure.sourcePins, ...recipe.sources, ...recipe.dependencies]
				.map(({ id, url, byteLength, sha256 }) => ({ id, url, byteLength, sha256 })),
		};
		await writeFile(join(outputRoot, 'onnx-webgpu-build-provenance.json'), `${JSON.stringify(provenance, null, '\t')}\n`);
		const files = [...closure.files];
		for (const path of ['onnxruntime_binding.node', probeName, 'NODE-ADDON-API-LICENSE',
			'NODE-LICENSE', 'onnx-webgpu-build-provenance.json', ...(targetId.startsWith('win-') ? ['NODE-GYP-LICENSE'] : [])]) {
			const bytes = await readFile(join(outputRoot, path));
			files.push({ path, byteLength: bytes.byteLength, sha256: hash(bytes),
				...(path === probeName ? { executable: true } : {}) });
		}
		return { files, provenance };
	} finally { await rm(work, { recursive: true, force: true }); }
}

export function assertOnnxBinaryArchitecture(bytes, targetId) {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 64 || !TARGETS.includes(targetId)) {
		throw new Error('The ONNX Node-API bridge architecture is invalid.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let valid;
	if (targetId.startsWith('linux-')) valid = view.getUint32(0, false) === 0x7f454c46
		&& bytes[4] === 2 && bytes[5] === 1 && view.getUint16(18, true) === (targetId === 'linux-arm64' ? 183 : 62);
	else if (targetId.startsWith('win-')) {
		const offset = view.getUint32(0x3c, true);
		valid = view.getUint16(0, true) === 0x5a4d && offset <= bytes.byteLength - 24
			&& view.getUint32(offset, true) === 0x00004550
			&& view.getUint16(offset + 4, true) === (targetId === 'win-arm64' ? 0xaa64 : 0x8664);
	} else valid = view.getUint32(0, true) === 0xfeedfacf && view.getUint32(4, true) === 0x100000c;
	if (!valid) throw new Error('The ONNX Node-API bridge architecture does not match its target.');
}

async function extractFiles(archive, destination, include) {
	await mkdir(destination, { recursive: true });
	await extract({
		file: archive, cwd: destination, strip: 1, strict: true, preservePaths: false,
		filter(path, entry) {
			const relative = path.split('/').slice(1).join('/');
			if (!include(relative)) return false;
			if (entry.type !== 'File' || relative.includes('..') || relative.includes('\\') || entry.size > 16 * 1024 * 1024) {
				throw new Error('The ONNX build dependency archive has an invalid entry.');
			}
			return true;
		},
	});
}

async function compilerIdentity(build) {
	for (const name of await readdir(join(build, 'CMakeFiles'))) {
		if (!/^\d+\.\d+/u.test(name)) continue;
		const path = join(build, 'CMakeFiles', name, 'CMakeCXXCompiler.cmake');
		if (!(await lstat(path)).isFile()) continue;
		const source = await readFile(path, 'utf8');
		const id = /set\(CMAKE_CXX_COMPILER_ID "([^"]+)"\)/u.exec(source)?.[1];
		const version = /set\(CMAKE_CXX_COMPILER_VERSION "([^"]+)"\)/u.exec(source)?.[1];
		if (id && version) return { id, version };
	}
	throw new Error('The ONNX bridge compiler identity could not be read.');
}

async function command(executable, args, cwd) {
	try {
		return await runFile(executable, args, {
			cwd, env: { ...process.env, SOURCE_DATE_EPOCH: '1787225940' }, windowsHide: true,
			maxBuffer: 8 * 1024 * 1024, timeout: 15 * 60_000,
		});
	} catch (error) {
		throw new Error(`The ONNX bridge build failed: ${executable}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
	}
}
