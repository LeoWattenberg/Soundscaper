/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { desktopWhisperCppBuildPlan, patchWhisperCppPipedStdout, stageDesktopWhisperCppRuntime } from '../scripts/lib/desktop-assistance-whisper-runtime.mjs';

test('Whisper build plans retain CPU-only portable targets and static runtime libraries', () => {
	for (const [targetId, platform, architecture] of [
		['linux-x64', 'linux', 'x64'], ['linux-arm64', 'linux', 'arm64'],
		['mac-arm64', 'darwin', 'arm64'], ['win-x64', 'win32', 'x64'],
		['win-arm64', 'win32', 'x64'],
	]) {
		const plan = desktopWhisperCppBuildPlan({ targetId, platform, architecture });
		for (const option of ['BUILD_SHARED_LIBS', 'GGML_NATIVE', 'GGML_BACKEND_DL', 'GGML_OPENMP',
			'GGML_CUDA', 'GGML_METAL', 'GGML_BLAS', 'GGML_AVX2']) {
			assert.ok(plan.configureArgs.includes(`-D${option}=OFF`));
		}
		assert.equal(plan.executable, platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
		if (targetId === 'win-arm64') assert.equal(plan.configureArgs[plan.configureArgs.indexOf('-A') + 1], 'ARM64');
		if (platform === 'win32') assert.ok(plan.configureArgs.includes('-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded'));
	}
	assert.throws(() => desktopWhisperCppBuildPlan({ targetId: 'mac-x64', platform: 'darwin', architecture: 'x64' }), /unsupported/u);
	assert.throws(() => desktopWhisperCppBuildPlan({ targetId: 'linux-arm64', platform: 'linux', architecture: 'x64' }), /native/u);
});

test('Whisper Windows ARM64 selects ClangCL because ggml rejects the MSVC ARM compiler', () => {
	for (const architecture of ['x64', 'arm64']) {
		const plan = desktopWhisperCppBuildPlan({ targetId: 'win-arm64', platform: 'win32', architecture });
		assert.ok(plan.configureArgs.includes('-T'));
		assert.equal(plan.configureArgs[plan.configureArgs.indexOf('-T') + 1], 'ClangCL');
		assert.equal(plan.configureArgs[plan.configureArgs.indexOf('-A') + 1], 'ARM64');
		assert.ok(plan.configureArgs.includes('-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded'));
	}
	const x64 = desktopWhisperCppBuildPlan({ targetId: 'win-x64', platform: 'win32', architecture: 'x64' });
	assert.ok(!x64.configureArgs.includes('-T'));
});

test('Whisper Windows compilers retain exception support with reproducible object files', () => {
	for (const targetId of ['win-x64', 'win-arm64']) {
		const plan = desktopWhisperCppBuildPlan({ targetId, platform: 'win32', architecture: 'x64' });
		assert.ok(plan.configureArgs.includes('-DCMAKE_C_FLAGS=/Brepro'));
		assert.ok(plan.configureArgs.includes('-DCMAKE_CXX_FLAGS=/Brepro /EHsc'));
	}
});

test('Whisper JSON output uses its inherited stdout pipe on every platform and rejects patch drift', () => {
	const source = '#include <fstream>\n#ifdef _WIN32\n                    fout = std::ofstream{"CON"};\n#else\n                    fout = std::ofstream{"/dev/stdout"};\n#endif\n';
	const patched = patchWhisperCppPipedStdout(source);
	assert.match(patched, /#include <iostream>/u);
	assert.match(patched, /fout\.basic_ios<char>::rdbuf\(std::cout\.rdbuf\(\)\);/u);
	assert.doesNotMatch(patched, /CON|\/dev\/stdout|_WIN32/u);
	assert.throws(() => patchWhisperCppPipedStdout(patched), /exact source context/u);
});

test('Whisper staging rejects altered cached source before extraction or compilation', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'whisper-stage-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const cacheRoot = join(root, 'cache');
	const source = join(cacheRoot, 'whisper-cpp', '371b5a7561823ab2bb32142d2751e35e7534727b');
	await mkdir(source, { recursive: true });
	await writeFile(join(source, 'source.tar.gz'), 'untrusted replaced archive');
	await assert.rejects(stageDesktopWhisperCppRuntime({ targetId: 'linux-x64', platform: 'linux',
		architecture: 'x64', runtimeRoot: join(root, 'runtime'), cacheRoot }), /pinned digest/u);
});
