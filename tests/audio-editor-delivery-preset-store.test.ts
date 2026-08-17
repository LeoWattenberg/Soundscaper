/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DELIVERY_PRESETS_SCHEMA_VERSION,
	applyDeliveryPreset,
	createDeliveryPresetState,
	deleteDeliveryPreset,
	exportDeliveryPreset,
	importDeliveryPresets,
	listDeliveryPresets,
	saveDeliveryPresetToState,
} from '../src/common/editor/delivery-preset-store.ts';

const NOW = '2026-08-17T10:00:00.000Z';
let counter = 0;
const idFactory = () => `preset-${++counter}`;

function stateWith(...saves: Array<Parameters<typeof saveDeliveryPresetToState>[1]>) {
	return saves.reduce(
		(state, options) => saveDeliveryPresetToState(state, { now: NOW, idFactory, ...options }).state,
		createDeliveryPresetState(),
	);
}

test('saving mints an id, stamps both timestamps, and lists back', () => {
	counter = 0;
	const { state, preset } = saveDeliveryPresetToState(createDeliveryPresetState(), {
		label: 'CD master', kind: 'audio', format: 'wav',
		settings: { sampleRate: 44_100, sampleFormat: 'int16' },
		now: NOW, idFactory,
	});
	assert.equal(preset.id, 'preset-1');
	assert.equal(preset.createdAt, NOW);
	assert.equal(preset.updatedAt, NOW);
	assert.deepEqual(listDeliveryPresets(state).map(({ id }) => id), ['preset-1']);
	assert.equal(state.schemaVersion, DELIVERY_PRESETS_SCHEMA_VERSION);
});

test('re-saving an existing id updates in place and keeps createdAt', () => {
	counter = 0;
	const first = saveDeliveryPresetToState(createDeliveryPresetState(), {
		label: 'CD master', kind: 'audio', format: 'wav', now: NOW, idFactory,
	});
	const later = '2026-08-18T10:00:00.000Z';
	const second = saveDeliveryPresetToState(first.state, {
		id: first.preset.id, label: 'CD master v2', kind: 'audio', format: 'wav',
		now: later, idFactory,
	});
	assert.equal(second.state.presets.length, 1, 'an update must not append a duplicate');
	assert.equal(second.preset.label, 'CD master v2');
	assert.equal(second.preset.createdAt, NOW, 'the original creation time survives an edit');
	assert.equal(second.preset.updatedAt, later);
});

test('a preset cannot change kind, and an unknown id cannot be updated', () => {
	counter = 0;
	const state = stateWith({ label: 'Audio', kind: 'audio', format: 'wav' });
	const id = state.presets[0].id;
	assert.throws(
		() => saveDeliveryPresetToState(state, { id, label: 'X', kind: 'video', format: 'mp4', idFactory }),
		/cannot change kind/u,
	);
	assert.throws(
		() => saveDeliveryPresetToState(state, { id: 'nope', label: 'X', kind: 'audio', format: 'wav', idFactory }),
		/does not exist/u,
	);
});

test('listing filters by kind and apply resolves one preset', () => {
	counter = 0;
	const state = stateWith(
		{ label: 'CD', kind: 'audio', format: 'wav' },
		{ label: 'Web', kind: 'video', format: 'mp4' },
	);
	assert.deepEqual(listDeliveryPresets(state, 'audio').map(({ label }) => label), ['CD']);
	assert.deepEqual(listDeliveryPresets(state, 'video').map(({ label }) => label), ['Web']);
	assert.equal(applyDeliveryPreset(state, state.presets[0].id).label, 'CD');
	assert.throws(() => applyDeliveryPreset(state, 'missing'), /does not exist/u);
});

test('deleting removes exactly one preset and refuses an unknown id', () => {
	counter = 0;
	const state = stateWith(
		{ label: 'CD', kind: 'audio', format: 'wav' },
		{ label: 'Web', kind: 'video', format: 'mp4' },
	);
	const remaining = deleteDeliveryPreset(state, state.presets[0].id);
	assert.deepEqual(remaining.presets.map(({ label }) => label), ['Web']);
	assert.throws(() => deleteDeliveryPreset(state, 'missing'), /does not exist/u);
});

test('export and import round-trip a preset', () => {
	counter = 0;
	const state = stateWith({ label: 'CD', kind: 'audio', format: 'wav', settings: { sampleRate: 44_100 } });
	const encoded = exportDeliveryPreset(state, state.presets[0].id);
	const reimported = importDeliveryPresets(createDeliveryPresetState(), encoded, { idFactory });
	assert.deepEqual(reimported.presets, state.presets, 'a round trip must be lossless');
});

test('importing a colliding id keeps both rather than overwriting the users copy', () => {
	counter = 0;
	const mine = stateWith({ label: 'Mine', kind: 'audio', format: 'wav' });
	const theirs = JSON.stringify({
		schemaVersion: 1,
		presets: [{
			schemaVersion: 1, id: mine.presets[0].id, label: 'Theirs',
			kind: 'audio', format: 'flac', settings: {},
			licensingRowId: null, fallbackPresetId: null,
		}],
	});
	const merged = importDeliveryPresets(mine, theirs, { idFactory });
	assert.equal(merged.presets.length, 2, 'a differing preset with the same id is re-minted, not merged over');
	assert.deepEqual(merged.presets.map(({ label }) => label).sort(), ['Mine', 'Theirs']);
});

test('importing an identical preset is idempotent', () => {
	counter = 0;
	const mine = stateWith({ label: 'Mine', kind: 'audio', format: 'wav' });
	const again = importDeliveryPresets(mine, exportDeliveryPreset(mine, mine.presets[0].id), { idFactory });
	assert.deepEqual(again.presets, mine.presets);
});

test('malformed input is refused with a useful reason', () => {
	assert.throws(() => importDeliveryPresets(createDeliveryPresetState(), '{'), /Invalid delivery preset JSON/u);
	assert.throws(
		() => importDeliveryPresets(createDeliveryPresetState(), '{"schemaVersion":1,"presets":[]}'),
		/file is empty/u,
	);
	assert.throws(() => createDeliveryPresetState({ schemaVersion: 2 }), /Unsupported delivery preset schema/u);
	assert.throws(
		() => createDeliveryPresetState({
			schemaVersion: 1,
			presets: [
				{ schemaVersion: 1, id: 'x', label: 'A', kind: 'audio', format: 'wav' },
				{ schemaVersion: 1, id: 'x', label: 'B', kind: 'audio', format: 'wav' },
			],
		}),
		/IDs must be unique/u,
	);
});

test('an imported preset carrying an unknown setting is refused, not silently accepted', () => {
	assert.throws(() => importDeliveryPresets(createDeliveryPresetState(), JSON.stringify({
		schemaVersion: 1,
		presets: [{
			schemaVersion: 1, id: 'x', label: 'Hostile', kind: 'audio', format: 'wav',
			settings: { arbitraryCommand: 'rm -rf' },
		}],
	})), /Unknown audio delivery setting/u);
});
