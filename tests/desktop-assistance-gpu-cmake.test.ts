/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import onnxRecipe from '../config/assistance-onnx-node-api-build.json' with { type: 'json' };
import { desktopOnnxWebGpuBindingBuildPlan } from '../scripts/lib/desktop-assistance-onnx-webgpu-binding.mjs';
import { desktopKokoroG2pGpuBuildPlan } from '../scripts/lib/desktop-kokoro-g2p-gpu.mjs';

const runFile = promisify(execFile);

async function write(path: string, text: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, text);
}

async function find(root: string, name: string): Promise<string | undefined> {
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			const nested = await find(path, name);
			if (nested) return nested;
		} else if (entry.name === name) return path;
	}
	return undefined;
}

for (const engine of ['onnx', 'kokoro'] as const) test(`${engine} CMake builds every GPU bridge fixture from its explicit source inventory`, {
	skip: !['linux', 'win32'].includes(process.platform) ? 'Native fixture requires Linux or Windows.' : false,
}, async context => {
	const root = await mkdtemp(join(tmpdir(), `${engine} cmake ü `));
	context.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
	const targetId = `${process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`;
	const plan = engine === 'onnx' ? desktopOnnxWebGpuBindingBuildPlan({ targetId }) : desktopKokoroG2pGpuBuildPlan({ targetId });
	const librarySource = join(root, 'library');
	const libraryBuild = join(root, 'library-build');
	await write(join(librarySource, 'CMakeLists.txt'), `
cmake_minimum_required(VERSION 3.20)
cmake_policy(SET CMP0091 NEW)
project(fixture LANGUAGES CXX)
set(CMAKE_MSVC_RUNTIME_LIBRARY MultiThreaded)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
add_library(ort_fixture STATIC fixture.cc)
`);
	await write(join(librarySource, 'fixture.cc'), 'int scape_fixture() { return 0; }\n');
	await runFile('cmake', ['-S', librarySource, '-B', libraryBuild, ...plan.generatorArgs, '-DCMAKE_BUILD_TYPE=Release'], { timeout: 30_000 });
	await runFile('cmake', ['--build', libraryBuild, '--config', 'Release'], { timeout: 30_000 });
	const library = await find(libraryBuild, process.platform === 'win32' ? 'ort_fixture.lib' : 'libort_fixture.a');
	assert.ok(library);
	const directory = engine === 'onnx' ? 'assistance-onnx-webgpu-node-api' : 'assistance-kokoro-g2p-gpu';
	const native = join(root, directory);
	await mkdir(native);
	await copyFile(new URL(`../native/${directory}/CMakeLists.txt`, import.meta.url), join(native, 'CMakeLists.txt'));
	const upstream = join(root, 'source/js/node/src');
	const probe = join(root, 'probe');
	await write(join(probe, 'webgpu_probe_main.cc'), 'int main() { return 0; }\n');
	if (engine === 'onnx') {
		for (const source of onnxRecipe.sources) await write(join(root, 'source', source.path), '');
		// The source closure is locked. An extra file must never be compiled or
		// create a CONFIGURE_DEPENDS script containing unescaped Windows paths.
		await write(join(upstream, 'unreviewed.cc'), '#error Unreviewed source must not be compiled\n');
		await write(join(native, 'webgpu_plugin_provider.cc'), '');
		await write(join(native, 'webgpu_probe_main.cc'), 'int main() { return 0; }\n');
		await write(join(native, 'webgpu_device_test.cc'), 'int main() { return 0; }\n');
	} else await write(join(native, 'ort-gemm.cc'), '');
	const hook = join(root, 'win_delay_load_hook.cc');
	await write(hook, '');
	const build = join(root, 'build');
	await runFile('cmake', ['-S', native, '-B', build, ...plan.generatorArgs, ...plan.configureArgs,
		`-DORT_HEADERS=${root}`, `-DORT_LIBRARY=${library}`, `-DSCAPE_WORK_ROOT=${root}`,
		...(engine === 'onnx' ? [`-DORT_NODE_SOURCE=${upstream}`, `-DNODE_HEADERS=${root}`,
			`-DNODE_ADDON_API=${root}`, `-DNODE_LIBRARY=${library}`, `-DNODE_DELAY_HOOK=${hook}`]
			: [`-DPROBE_SOURCE=${probe}`]),
	], { timeout: 30_000 });
	const built = await runFile('cmake', ['--build', build, ...plan.buildArgs], { timeout: 30_000 });
	assert.doesNotMatch(`${built.stdout}\n${built.stderr}`, /D900[27]/u, 'MSVC must honor every reproducibility flag');
	await assert.rejects(access(join(build, 'CMakeFiles/VerifyGlobs.cmake')), { code: 'ENOENT' });
	const extension = process.platform === 'win32' ? '.exe' : '';
	const bridge = engine === 'onnx' ? 'onnxruntime_binding.node'
		: process.platform === 'win32' ? 'scape-g2p-gpu.dll' : 'libscape-g2p-gpu.so';
	assert.ok(await find(build, bridge), `Missing ${bridge}.`);
	const probePath = await find(build, `onnx-webgpu-device-probe${extension}`);
	assert.ok(probePath);
	await runFile(probePath, [], { timeout: 10_000 });
	if (engine === 'onnx') {
		const fixture = await find(build, `onnx_webgpu_device_test${extension}`);
		assert.ok(fixture);
		await runFile(fixture, ['authenticated-plugin-fixture'], { timeout: 10_000 });
	}
});
