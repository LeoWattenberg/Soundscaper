/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAssistanceExecutionProviders } from '../desktop/assistance-execution-providers.ts';

const TARGETS = ['mac-arm64', 'win-x64', 'win-arm64', 'linux-x64', 'linux-arm64'] as const;

test('every neural runtime admits a GPU option on every maintained desktop target', () => {
	for (const family of ['sherpa-onnx-node', 'onnxruntime-node', 'whisper-cpp', 'llama-cpp']) {
		for (const target of TARGETS) {
			const gpu = family === 'whisper-cpp' || family === 'llama-cpp'
				? target === 'mac-arm64' ? 'metal' : 'vulkan' : 'webgpu';
			assert.deepEqual(validateAssistanceExecutionProviders([gpu, 'cpu'], family, target),
				[gpu, 'cpu'], `${family}/${target} must offer GPU execution`);
		}
	}
});

test('macOS ONNX and Sherpa can prefer CoreML and retain WebGPU and CPU fallbacks', () => {
	for (const family of ['sherpa-onnx-node', 'onnxruntime-node']) {
		assert.deepEqual(validateAssistanceExecutionProviders(['coreml', 'webgpu', 'cpu'], family, 'mac-arm64'),
			['coreml', 'webgpu', 'cpu']);
	}
});

test('legacy CPU archives remain usable without granting unbuilt or foreign GPU providers', () => {
	for (const family of ['sherpa-onnx-node', 'onnxruntime-node', 'whisper-cpp', 'llama-cpp']) {
		for (const target of TARGETS) {
			assert.deepEqual(validateAssistanceExecutionProviders(['cpu'], family, target), ['cpu']);
			assert.throws(() => validateAssistanceExecutionProviders(['cuda', 'cpu'], family, target), /reviewed/u);
		}
	}
});
