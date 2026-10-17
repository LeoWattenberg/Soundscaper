/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { desktopSherpaGpuBuildPlan } from '../scripts/lib/desktop-assistance-sherpa-gpu-runtime.mjs';

const runFile = promisify(execFile);

test('the root Sherpa build target includes the excluded upstream C++ library and every shipped binary', {
	skip: !['linux', 'win32'].includes(process.platform) ? 'Native fixture requires Linux or Windows.' : false,
}, async context => {
	const root = await mkdtemp(join(tmpdir(), 'sherpa cmake '));
	context.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
	const native = join(root, 'native/assistance-sherpa-gpu');
	const upstream = join(root, 'upstream');
	const build = join(root, 'build');
	const source = await readFile(new URL('../native/assistance-sherpa-gpu/CMakeLists.txt', import.meta.url), 'utf8');
	const write = async (path: string, text: string): Promise<void> => {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, text);
	};
	await mkdir(native, { recursive: true });
	await copyFile(new URL('../native/assistance-sherpa-gpu/CMakeLists.txt', import.meta.url), join(native, 'CMakeLists.txt'));
	await write(join(native, 'webgpu-provider.cc'), '');
	await write(join(root, 'native/assistance-onnx-webgpu-node-api/webgpu_probe_main.cc'), 'int main() { return 0; }\n');
	// Keep the real wrapper and upstream target layout; stand in for the model
	// implementation so this regression needs no downloads or AI runtime build.
	await write(join(upstream, 'CMakeLists.txt'), `
add_library(onnxruntime INTERFACE)
add_library(sherpa-onnx-core STATIC empty.cc)
add_subdirectory(sherpa-onnx/c-api)
`);
	await write(join(upstream, 'empty.cc'), '');
	await write(join(upstream, 'sherpa-onnx/c-api/CMakeLists.txt'), `
add_library(sherpa-onnx-c-api SHARED empty.cc)
target_link_libraries(sherpa-onnx-c-api PRIVATE sherpa-onnx-core)
add_library(sherpa-onnx-cxx-api SHARED empty.cc)
target_link_libraries(sherpa-onnx-cxx-api PRIVATE sherpa-onnx-c-api)
`);
	await write(join(upstream, 'sherpa-onnx/c-api/empty.cc'), `
#ifdef _WIN32
__declspec(dllexport)
#endif
void scape_fixture_export() {}
`);
	const addonSources = /set\(source_names\s+([^)]+)\)/u.exec(source)?.[1];
	assert.ok(addonSources);
	for (const name of addonSources.trim().split(/\s+/u)) {
		await write(join(upstream, 'harmony-os/SherpaOnnxHar/sherpa_onnx/src/main/cpp', name), '');
	}
	const plan = desktopSherpaGpuBuildPlan({ targetId: `${process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}` });
	await runFile('cmake', ['-S', native, '-B', build, ...plan.generatorArgs,
		`-DSHERPA_SOURCE=${upstream}`, `-DORT_INCLUDE=${root}`, `-DORT_LIBRARY=${join(upstream, 'empty.cc')}`,
		`-DNODE_HEADERS=${root}`, `-DNODE_ADDON_API=${root}`, `-DSCAPE_WORK_ROOT=${root}`,
		...(process.platform === 'win32' ? [`-DNODE_LIBRARY=${join(build, 'onnxruntime.lib')}`,
			`-DNODE_DELAY_HOOK=${join(upstream, 'empty.cc')}`] : []),
	], { timeout: 30_000 });
	const targetStart = plan.buildArgs.indexOf('--target') + 1;
	const targetEnd = plan.buildArgs.indexOf('--parallel');
	assert.deepEqual(plan.buildArgs.slice(targetStart, targetEnd), ['scape-sherpa-gpu']);
	const built = await runFile('cmake', ['--build', build, ...plan.buildArgs], { timeout: 30_000 });
	assert.doesNotMatch(`${built.stdout}\n${built.stderr}`, /D900[27]/u, 'MSVC must honor every reproducibility flag');
	const files: string[] = [];
	const collect = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (entry.isDirectory()) await collect(join(directory, entry.name));
			else files.push(entry.name);
		}
	};
	await collect(build);
	const prefix = process.platform === 'win32' ? '' : 'lib';
	const extension = process.platform === 'win32' ? 'dll' : 'so';
	for (const name of ['sherpa-onnx.node', `${prefix}sherpa-onnx-c-api.${extension}`,
		`${prefix}sherpa-onnx-cxx-api.${extension}`, `onnx-webgpu-device-probe${process.platform === 'win32' ? '.exe' : ''}`]) {
		assert.ok(files.includes(name), `The root target did not build ${name}.`);
	}
});
