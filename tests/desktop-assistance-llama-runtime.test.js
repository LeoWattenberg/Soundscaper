/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import test from 'node:test';

import { createLlamaBuildWorkDirectory, desktopLlamaCppBuildPlan, llamaCompilerProvenance,
	patchLlamaCppCompletion, stageDesktopLlamaCppRuntime } from '../scripts/lib/desktop-assistance-llama-runtime.mjs';

test('Windows llama builds use one exclusive stable source path outside the product checkout', async (context) => {
	const cacheRoot = resolve(import.meta.dirname, '../.native-build/assistance-runtimes');
	const options = { cacheRoot, targetId: 'win-x64', platform: 'win32' };
	const work = await createLlamaBuildWorkDirectory(options);
	context.after(() => rm(work, { recursive: true, force: true }));
	const checkout = resolve(import.meta.dirname, '..');
	assert.equal(dirname(work), dirname(checkout));
	assert.ok(!work.startsWith(`${checkout}${sep}`));
	const source = join(work, 'source');
	await mkdir(source);
	const gitEnvironment = { ...process.env, GIT_CEILING_DIRECTORIES: '' };
	delete gitEnvironment.GIT_DIR;
	delete gitEnvironment.GIT_WORK_TREE;
	assert.throws(() => execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: source,
		env: gitEnvironment, stdio: 'pipe' }));
	await assert.rejects(createLlamaBuildWorkDirectory(options), { code: 'EEXIST' });
	await rm(work, { recursive: true, force: true });
	assert.equal(await createLlamaBuildWorkDirectory(options), work);
});

test('Windows MSVC patch drift does not change archived llama provenance', () => {
	const earlier = { id: 'MSVC', version: '19.51.36256.0' };
	const later = { id: 'MSVC', version: '19.51.36257.0' };
	assert.deepEqual(llamaCompilerProvenance(earlier, 'win32'), {
		archived: { id: 'MSVC', version: '19.51' }, buildReceipt: earlier,
	});
	assert.deepEqual(llamaCompilerProvenance(later, 'win32'), {
		archived: { id: 'MSVC', version: '19.51' }, buildReceipt: later,
	});
	assert.deepEqual(llamaCompilerProvenance(earlier, 'linux'), {
		archived: earlier, buildReceipt: earlier,
	});
	assert.throws(() => llamaCompilerProvenance({ id: 'MSVC', version: 'unexpected' }, 'win32'),
		/Llama MSVC compiler version/u);
});

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
