/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { validateLocalModelRealTestCases } from '../scripts/lib/local-model-real-test-cases.mjs';
import { generateLocalModelTestDocuments, localModelRuntimeAvailability } from '../scripts/lib/local-model-test-docs.mjs';
import { WHISPER_RUNTIME_BUILD_TARGETS, WHISPER_RUNTIME_VERSION } from '../scripts/lib/desktop-assistance-whisper-runtime.mjs';
import { LLAMA_RUNTIME_BUILD_TARGETS, LLAMA_RUNTIME_VERSION } from '../scripts/lib/desktop-assistance-llama-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(await readFile(resolve(root, 'config/local-model-catalog.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'config/local-model-real-test-cases.json'), 'utf8'));
const candidateTasks = JSON.parse(await readFile(resolve(root, 'config/milestone-7-model-catalog-tasks.json'), 'utf8')).tasks;
const options = { candidateTasks };
const nativeRuntime = JSON.parse(await readFile(resolve(root, 'config/assistance-native-runtime-manifest.json'), 'utf8'));
const onnxRuntime = JSON.parse(await readFile(resolve(root, 'config/assistance-onnx-runtime-payloads.json'), 'utf8'));
const sherpaArm64Build = JSON.parse(await readFile(resolve(root, 'config/assistance-sherpa-win-arm64-build.json'), 'utf8'));
const runtimeSources = { nativeRuntime, onnxRuntime, sherpaArm64Build,
	whisperBuild: { version: WHISPER_RUNTIME_VERSION, targets: WHISPER_RUNTIME_BUILD_TARGETS },
	llamaBuild: { version: LLAMA_RUNTIME_VERSION, targets: LLAMA_RUNTIME_BUILD_TARGETS } };

test('real model cases cover every published and explicitly required candidate model', () => {
	const cases = validateLocalModelRealTestCases(manifest, catalog, options);
	assert.equal(cases.length, 19);
	assert.equal(new Set(cases.flatMap(({ modelIds }) => modelIds)).size, 21);
	assert.deepEqual(cases.find(({ operation }) => operation === 'speaker-diarization').modelIds,
		['pyannote-segmentation-3.0', 'speech-3d-speaker-eres2net']);
	assert.deepEqual(cases.find(({ operation }) => operation === 'subject-detection').modelIds,
		['yunet-face-detection-2026may', 'dfine-nano-coco']);
	assert.equal(cases.find(({ operation }) => operation === 'image-text-embedding').fixtureId,
		'visual-subject-frames');
});

test('adding a published model without a real execution case fails coverage', () => {
	const added = structuredClone(catalog);
	added.entries.push({ ...added.entries[0], modelId: 'new-vad' });
	assert.throws(() => validateLocalModelRealTestCases(manifest, added, options), /new-vad.*case/u);
});

test('real model cases reject duplicates, foreign models, and a mismatched fixture or output', () => {
	for (const [edit, expected] of [
		[(value) => value.cases.push(value.cases[0]), /duplicate/u],
		[(value) => { value.cases[0].modelIds = ['unknown-model']; }, /unknown-model/u],
		[(value) => { value.cases[0].fixtureId = 'transcript-text'; }, /fixture/u],
		[(value) => { value.cases[0].validation = 'changed-audio'; }, /validation/u],
		[(value) => { value.cases[0].operation = 'source-separation'; }, /operation/u],
		[(value) => { value.cases[0].documentation.modelTitles = {}; }, /title/u],
	]) {
		const changed = structuredClone(manifest);
		edit(changed);
		assert.throws(() => validateLocalModelRealTestCases(changed, catalog, options), expected);
	}
});

test('every model handbook page stays derived from its real test and catalog', async () => {
	const result = await generateLocalModelTestDocuments(root, { write: false });
	assert.equal(result.documentCount, 22);
	assert.deepEqual(result.stale, []);
});

test('every published model has packaged runtime support reflected in its guide', async () => {
	const availability = catalog.entries.map((entry) => ({ entry,
		...localModelRuntimeAvailability(entry, runtimeSources) }));
	for (const { entry, availablePlatforms } of availability) {
		assert.ok(availablePlatforms.includes('linux-x64'), `${entry.modelId} must be usable on Linux x64.`);
		const page = await readFile(resolve(root,
			`handbook/src/content/docs/reference/local-models/${entry.modelId}.md`), 'utf8');
		assert.match(page, /Desktop builds package the required/u);
		assert.doesNotMatch(page, /Once a compatible native runtime is packaged/u);
		if (!entry.modelId.startsWith('whisper-')) assert.match(page, /learn\.microsoft\.com\/en-us\/cpp\/windows\/latest-supported-vc-redist/u);
	}
	const silero = availability.find(({ entry }) => entry.modelId === 'silero-vad-v6');
	assert.deepEqual(silero.availablePlatforms.toSorted(),
		['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-x64']);
	assert.ok(silero.missingPlatforms.includes('darwin-x64'));
});

test('every real model case is admitted on the four currently published desktop targets', () => {
	const entries = new Map(catalog.entries.map((entry) => [entry.modelId, entry]));
	for (const { id, modelIds } of manifest.cases) for (const modelId of modelIds) {
		const entry = entries.get(modelId);
		if (!entry) continue;
		const availability = localModelRuntimeAvailability(entry, runtimeSources);
		for (const platform of ['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-x64']) {
			assert.ok(entry.platforms.includes(platform), `${id}: ${modelId} must not be skipped on ${platform}.`);
			assert.ok(availability.availablePlatforms.includes(platform), `${id}: ${modelId} must have native packaging support on ${platform}.`);
		}
	}
});

test('required candidates add test coverage without becoming published model authority', () => {
	assert.throws(() => validateLocalModelRealTestCases(manifest, catalog), /unpublished model/u);
	const missing = { ...manifest, cases: manifest.cases.filter(({ modelIds }) => !modelIds.includes('qwen3-4b-q4-k-m')) };
	assert.throws(() => validateLocalModelRealTestCases(missing, catalog, options), /qwen3.*no real execution case/u);
	const duplicate = [...candidateTasks, candidateTasks[0]];
	assert.throws(() => validateLocalModelRealTestCases(manifest, catalog, { candidateTasks: duplicate }), /duplicate candidate/u);
	const conflict = { ...candidateTasks[0], catalogModelId: catalog.entries[0].modelId };
	assert.throws(() => validateLocalModelRealTestCases(manifest, catalog, { candidateTasks: [conflict] }), /conflicting task/u);
	assert.equal(catalog.entries.some(({ modelId }) => modelId === 'qwen3-4b-q4-k-m'), false);
});

test('candidate guides distinguish required tests and packaged engines from signed publication', async () => {
	for (const task of candidateTasks) {
		const page = await readFile(resolve(root, `handbook/src/content/docs/reference/local-models/${task.catalogModelId}.md`), 'utf8');
		assert.match(page, /signed catalog publication is pending/u);
		assert.match(page, /cannot currently install/u);
		assert.match(page, /Required test coverage does not authorize/u);
		if (task.catalogModelId === 'qwen3-4b-q4-k-m') assert.match(page, /llama-cpp b10509/u);
		if (task.catalogModelId === 'dereverb-room') {
			assert.match(page, /GPL-3.0/u);
			assert.doesNotMatch(page, /license approval/u);
		}
	}
});

test('the Windows ARM64 build recipe cannot widen signed catalog platform admission', () => {
	const silero = catalog.entries.find(({ modelId }) => modelId === 'silero-vad-v6');
	assert.ok(!silero.platforms.includes('win32-arm64'));
	assert.ok(!localModelRuntimeAvailability(silero, runtimeSources).availablePlatforms.includes('win32-arm64'));
	const proposed = { ...silero, platforms: [...silero.platforms, 'win32-arm64'] };
	assert.ok(localModelRuntimeAvailability(proposed, runtimeSources).availablePlatforms.includes('win32-arm64'));
	assert.ok(localModelRuntimeAvailability(proposed,
		{ ...runtimeSources, sherpaArm64Build: undefined }).missingPlatforms.includes('win32-arm64'));
});

test('native availability follows packaged file inventories and build recipes', () => {
	const changed = structuredClone(onnxRuntime);
	delete changed.sources.find(({ id }) => id === 'onnxruntime-node').targetFiles['linux-x64'];
	const entry = catalog.entries.find(({ modelId }) => modelId === 'deepfilternet3');
	assert.ok(localModelRuntimeAvailability(entry, runtimeSources).availablePlatforms.includes('linux-x64'));
	assert.ok(localModelRuntimeAvailability(entry,
		{ ...runtimeSources, onnxRuntime: changed }).missingPlatforms.includes('linux-x64'));
	const whisper = catalog.entries.find(({ modelId }) => modelId.startsWith('whisper-'));
	assert.ok(localModelRuntimeAvailability(whisper, runtimeSources).availablePlatforms.includes('linux-x64'));
	assert.deepEqual(localModelRuntimeAvailability(whisper,
		{ ...runtimeSources, whisperBuild: { version: WHISPER_RUNTIME_VERSION, targets: [] } }).availablePlatforms, []);
});
