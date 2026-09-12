/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { desktopLlamaCppBuildPlan, patchLlamaCppCompletion, stageDesktopLlamaCppRuntime } from '../scripts/lib/desktop-assistance-llama-runtime.mjs';

test('the completion patch honors disabled reasoning and keeps status text out of JSON stdout', () => {
	const source = '                inputs.force_pure_content = params.force_pure_content_parser;\n            LOG(" [end of text]\\n");';
	const patched = patchLlamaCppCompletion(source);
	assert.match(patched, /inputs\.enable_thinking = params\.enable_reasoning != 0;/u);
	assert.match(patched, /LOG_DBG\(" \[end of text\]/u);
	assert.doesNotMatch(patched, /\bLOG\(" \[end of text\]/u);
	assert.throws(() => patchLlamaCppCompletion(patched), /exact source/u);
	assert.throws(() => patchLlamaCppCompletion(`${source}\n${source}`), /exact source/u);
});

test('llama packaging builds a static CPU completion helper without optional downloads', () => {
	for (const [targetId, platform, architecture] of [
		['linux-x64', 'linux', 'x64'], ['linux-arm64', 'linux', 'arm64'],
		['mac-arm64', 'darwin', 'arm64'], ['win-x64', 'win32', 'x64'], ['win-arm64', 'win32', 'x64'],
	]) {
		const plan = desktopLlamaCppBuildPlan({ targetId, platform, architecture });
		assert.equal(plan.target, 'llama-completion');
		assert.equal(plan.executable, `llama-completion${platform === 'win32' ? '.exe' : ''}`);
		for (const flag of ['BUILD_SHARED_LIBS', 'GGML_NATIVE', 'GGML_BACKEND_DL', 'GGML_OPENMP',
			'GGML_CUDA', 'GGML_METAL', 'GGML_ACCELERATE', 'GGML_BLAS', 'GGML_CPU_HBM',
			'GGML_CPU_ALL_VARIANTS', 'LLAMA_OPENSSL', 'LLAMA_SUBPROCESS',
			'LLAMA_BUILD_SERVER', 'LLAMA_BUILD_UI', 'LLAMA_USE_PREBUILT_UI', 'LLAMA_LLGUIDANCE']) {
			assert.ok(plan.configureArgs.includes(`-D${flag}=OFF`), `${targetId}: ${flag}`);
		}
		if (platform === 'win32') {
			assert.ok(plan.configureArgs.includes('-DCMAKE_CXX_FLAGS=/Brepro /EHsc'));
			assert.ok(plan.configureArgs.includes('-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded'));
			assert.equal(plan.configureArgs.includes('ClangCL'), targetId === 'win-arm64');
		}
	}
	assert.throws(() => desktopLlamaCppBuildPlan({ targetId: 'linux-arm64', platform: 'linux', architecture: 'x64' }), /native/u);
	assert.throws(() => desktopLlamaCppBuildPlan({ targetId: 'mac-x64', platform: 'darwin', architecture: 'x64' }), /unsupported/u);
});

test('llama staging rejects changed source archives before compilation', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'llama-stage-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const cacheRoot = join(root, 'cache');
	const source = join(cacheRoot, 'llama-cpp', 'fe8156f789011f6ea0baf6917ea09f88b89d9554');
	await mkdir(source, { recursive: true });
	await writeFile(join(source, 'source.tar.gz'), 'altered source');
	await assert.rejects(stageDesktopLlamaCppRuntime({ targetId: 'linux-x64', platform: 'linux', architecture: 'x64',
		runtimeRoot: join(root, 'runtime'), cacheRoot }), /pinned/u);
});
