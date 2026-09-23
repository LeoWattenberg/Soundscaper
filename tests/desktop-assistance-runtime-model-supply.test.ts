/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import catalog from '../config/local-model-catalog.json' with { type: 'json' };
import { assistanceRuntimeFamiliesForModel } from '../desktop/assistance-runtime-model-supply.ts';

test('every reviewed local model has an exact runtime-family mapping', () => {
	const mapped = new Map(catalog.entries.map(({ modelId, task }) => [
		modelId, assistanceRuntimeFamiliesForModel(modelId, task),
	] as const));
	assert.equal(mapped.size, catalog.entries.length);
	assert.deepEqual(mapped.get('parakeet-tdt-0.6b-v3'), ['sherpa-onnx-node']);
	assert.deepEqual(mapped.get('whisper-large-v3-turbo-ggml'), ['whisper-cpp']);
	assert.deepEqual(mapped.get('kokoro-82m-v1.0'), ['onnxruntime-node', 'kokoro-g2p']);
	assert.deepEqual(mapped.get('qwen3-4b-q4-k-m'), ['llama-cpp']);
	assert.throws(() => assistanceRuntimeFamiliesForModel('foreign', 'foreign-task'), /mapping/u);
});
