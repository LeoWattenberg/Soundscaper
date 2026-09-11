/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { validateLocalModelRealTestCases } from '../scripts/lib/local-model-real-test-cases.mjs';
import { generateLocalModelTestDocuments, localModelRuntimeAvailability } from '../scripts/lib/local-model-test-docs.mjs';

const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(await readFile(resolve(root, 'config/local-model-catalog.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'config/local-model-real-test-cases.json'), 'utf8'));
const nativeRuntime = JSON.parse(await readFile(resolve(root, 'config/assistance-native-runtime-manifest.json'), 'utf8'));
const familySupply = JSON.parse(await readFile(resolve(root, 'config/assistance-runtime-family-supply-candidates.json'), 'utf8'));

test('real model cases cover every published model using its supported operation', () => {
	const cases = validateLocalModelRealTestCases(manifest, catalog);
	assert.equal(cases.length, 11);
	assert.equal(new Set(cases.flatMap(({ modelIds }) => modelIds)).size, catalog.entries.length);
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
	assert.throws(() => validateLocalModelRealTestCases(manifest, added), /new-vad.*case/u);
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
		assert.throws(() => validateLocalModelRealTestCases(changed, catalog), expected);
	}
});

test('every model handbook page stays derived from its real test and catalog', async () => {
	const result = await generateLocalModelTestDocuments(root, { write: false });
	assert.equal(result.documentCount, catalog.entries.length + 1);
	assert.deepEqual(result.stale, []);
});

test('model guides distinguish published weights from pending native engines', async () => {
	const availability = catalog.entries.map((entry) => ({ entry,
		...localModelRuntimeAvailability(entry, { nativeRuntime, familySupply }) }));
	const pending = availability.filter(({ availablePlatforms }) => availablePlatforms.length === 0);
	assert.equal(pending.length, 8);
	for (const { entry } of pending) {
		const page = await readFile(resolve(root,
			`handbook/src/content/docs/reference/local-models/${entry.modelId}.md`), 'utf8');
		assert.match(page, /weights are published.*native engine is not yet packaged/u);
		assert.match(page, /Once a compatible native runtime is packaged/u);
	}
	const silero = availability.find(({ entry }) => entry.modelId === 'silero-vad-v6');
	assert.deepEqual(silero.availablePlatforms.toSorted(),
		['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-x64']);
	assert.ok(silero.missingPlatforms.includes('darwin-x64'));
});

test('native availability documentation changes when a target becomes authenticated', () => {
	const changed = structuredClone(familySupply);
	const target = changed.manifests['onnxruntime-node'].targets.find(({ id }) => id === 'linux-x64');
	target.status = 'authenticated';
	const entry = catalog.entries.find(({ modelId }) => modelId === 'deepfilternet3');
	assert.deepEqual(localModelRuntimeAvailability(entry, { nativeRuntime, familySupply }).availablePlatforms, []);
	assert.deepEqual(localModelRuntimeAvailability(entry,
		{ nativeRuntime, familySupply: changed }).availablePlatforms, ['linux-x64']);
});
