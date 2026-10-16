/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import recipe from '../config/assistance-onnx-node-api-build.json' with { type: 'json' };
import {
	desktopOnnxWebGpuBindingBuildPlan,
	patchDesktopOnnxWebGpuSessionProvider,
	assertOnnxBinaryArchitecture,
} from '../scripts/lib/desktop-assistance-onnx-webgpu-binding.mjs';

test('every ONNX plugin bridge uses a matching target runner and builds an isolated GPU device probe', () => {
	const plan = desktopOnnxWebGpuBindingBuildPlan({ targetId: 'linux-arm64', platform: 'linux', architecture: 'arm64' });
	assert.deepEqual(plan.configureArgs, ['-DCMAKE_BUILD_TYPE=Release']);
	assert.ok(plan.buildArgs.includes('onnxruntime_binding'));
	assert.throws(() => desktopOnnxWebGpuBindingBuildPlan({ targetId: 'linux-arm64', platform: 'linux', architecture: 'x64' }), /matching native/u);
	for (const [targetId, platform, architecture] of [
		['mac-arm64', 'darwin', 'arm64'], ['linux-x64', 'linux', 'x64'],
		['win-x64', 'win32', 'x64'], ['win-arm64', 'win32', 'x64'],
	]) {
		const selected = desktopOnnxWebGpuBindingBuildPlan({ targetId, platform, architecture });
		assert.ok(selected.buildArgs.includes('onnx_webgpu_probe'));
		assert.deepEqual(selected.generatorArgs, targetId.startsWith('win-')
			? ['-A', targetId === 'win-arm64' ? 'ARM64' : 'x64'] : []);
	}
	assert.throws(() => desktopOnnxWebGpuBindingBuildPlan({ targetId: 'mac-arm64', platform: 'linux', architecture: 'arm64' }), /matching native/u);
});

test('binary architecture checks reject a host binary emitted for another target', () => {
	const bytes = Buffer.alloc(64);
	bytes.writeUInt32BE(0x7f454c46); bytes[4] = 2; bytes[5] = 1; bytes.writeUInt16LE(62, 18);
	assert.doesNotThrow(() => assertOnnxBinaryArchitecture(bytes, 'linux-x64'));
	assert.throws(() => assertOnnxBinaryArchitecture(bytes, 'linux-arm64'), /architecture/u);
	assert.throws(() => assertOnnxBinaryArchitecture(bytes, 'win-x64'), /architecture/u);
	assert.throws(() => assertOnnxBinaryArchitecture(Buffer.alloc(4), 'mac-arm64'), /architecture/u);
});

test('the plugin bridge recipe pins all upstream sources and local build instructions', async () => {
	assert.equal(recipe.sourceRevision, '2e2543fbe9fae542f921d47a72d21d5a4ef0b710');
	assert.equal(recipe.sources.length, 14);
	for (const source of recipe.sources) {
		assert.ok(source.url.includes(`/${recipe.sourceRevision}/js/node/src/`));
		assert.match(source.sha256, /^[a-f\d]{64}$/u);
	}
	for (const [name, expected] of Object.entries(recipe.recipeFiles)) {
		const bytes = await readFile(new URL(`../native/assistance-onnx-webgpu-node-api/${name}`, import.meta.url));
		assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
	}
});

test('the provider patch rejects upstream drift before changing any build source', () => {
	assert.throws(() => patchDesktopOnnxWebGpuSessionProvider('altered upstream source'), /pinned source/u);
});
