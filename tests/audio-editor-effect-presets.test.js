import test from 'node:test';
import assert from 'node:assert/strict';

import {
	applyAudioEditorEffectPreset,
	createAudioEditorEffectPresets,
	deleteAudioEditorEffectPreset,
	exportAudioEditorEffectPreset,
	importAudioEditorEffectPresets,
	listAudioEditorEffectPresets,
	saveAudioEditorEffectPreset,
} from '../src/common/editor/effect-presets.js';

test('effect preset CRUD normalizes through the pinned effect registry', () => {
	const empty = createAudioEditorEffectPresets();
	const saved = saveAudioEditorEffectPreset(empty, {
		effectType: 'audacity-amplify',
		name: 'Speech lift',
		params: { gainDb: 3.25, allowClipping: false },
		idFactory: () => 'preset-speech',
		now: '2026-07-13T12:00:00.000Z',
	});
	assert.equal(saved.preset.id, 'preset-speech');
	assert.deepEqual(listAudioEditorEffectPresets(saved.state, 'audacity-amplify'), [saved.preset]);
	assert.deepEqual(applyAudioEditorEffectPreset(saved.state, saved.preset.id), saved.preset);

	const updated = saveAudioEditorEffectPreset(saved.state, {
		id: saved.preset.id,
		effectType: 'audacity-amplify',
		name: 'Speech lift +',
		params: { gainDb: 4, allowClipping: false },
		now: '2026-07-13T12:01:00.000Z',
	});
	assert.equal(updated.state.presets.length, 1);
	assert.equal(updated.preset.createdAt, saved.preset.createdAt);
	assert.equal(updated.preset.updatedAt, '2026-07-13T12:01:00.000Z');
	assert.equal(deleteAudioEditorEffectPreset(updated.state, saved.preset.id).presets.length, 0);
});

test('effect presets import/export atomically and reject collisions and invalid types', () => {
	const saved = saveAudioEditorEffectPreset(createAudioEditorEffectPresets(), {
		effectType: 'audacity-change-pitch', name: 'Up a fifth',
		params: { semitones: 7, preserveFormants: true },
		idFactory: () => 'preset-fifth', now: '2026-07-13T12:00:00.000Z',
	});
	const encoded = exportAudioEditorEffectPreset(saved.state, 'preset-fifth');
	const restored = importAudioEditorEffectPresets(createAudioEditorEffectPresets(), encoded);
	assert.equal(restored.presets[0].params.semitones, 7);
	assert.ok(Object.isFrozen(restored.presets[0].params));

	const conflict = importAudioEditorEffectPresets(saved.state, encoded.replace('Up a fifth', 'Different'), {
		idFactory: () => 'preset-fifth-imported',
	});
	assert.deepEqual(conflict.presets.map(({ id }) => id), ['preset-fifth', 'preset-fifth-imported']);
	assert.throws(() => importAudioEditorEffectPresets(saved.state, '{broken'), /Invalid effect preset JSON/);
	assert.throws(() => createAudioEditorEffectPresets({ schemaVersion: 2, presets: [] }), /Unsupported effect preset schema/);
	assert.throws(() => saveAudioEditorEffectPreset(saved.state, {
		effectType: 'external-plugin', name: 'No', params: {}, idFactory: () => 'no',
	}), /Unsupported effect preset type/);
	for (const effectType of ['constructor', '__proto__']) {
		const prototypeNamed = JSON.parse(encoded);
		prototypeNamed.presets[0].effectType = effectType;
		assert.throws(
			() => importAudioEditorEffectPresets(createAudioEditorEffectPresets(), prototypeNamed),
			/Unsupported effect preset type/,
		);
	}
});

test('parametric EQ presets migrate legacy bands and preserve stable node IDs', () => {
	const saved = saveAudioEditorEffectPreset(createAudioEditorEffectPresets(), {
		effectType: 'eq',
		name: 'Legacy presence',
		params: { bands: [{ frequency: 2_500, gain: 2.5, q: 1.2 }] },
		idFactory: () => 'preset-eq',
		now: '2026-07-13T12:00:00.000Z',
	});
	assert.deepEqual(saved.preset.params, {
		outputGain: 0,
		bands: [{
			id: 'band-1', enabled: true, type: 'peaking', frequency: 2_500,
			gain: 2.5, q: 1.2, slope: 12,
		}],
	});
	const updated = saveAudioEditorEffectPreset(saved.state, {
		id: 'preset-eq',
		effectType: 'eq',
		name: 'Legacy presence',
		params: {
			outputGain: -1,
			bands: [{ ...saved.preset.params.bands[0], id: 'presence-node', type: 'highshelf' }],
		},
		now: '2026-07-13T12:01:00.000Z',
	});
	assert.equal(updated.preset.params.outputGain, -1);
	assert.equal(updated.preset.params.bands[0].id, 'presence-node');
	assert.equal(updated.preset.params.bands[0].type, 'highshelf');
});

test('the presets Audacity ships sit behind a project\'s own and cannot be edited away', () => {
	const saved = saveAudioEditorEffectPreset(createAudioEditorEffectPresets(), {
		effectType: 'audacity-reverb',
		name: 'Booth',
		params: { roomSize: 12, wetGainDb: -9 },
		idFactory: () => 'preset-booth',
		now: '2026-07-13T12:00:00.000Z',
	});
	const listed = listAudioEditorEffectPresets(saved.state, 'audacity-reverb');
	assert.equal(listed.length, 19);
	assert.deepEqual(listed[0], saved.preset);
	assert.equal(listed[1].name, 'Acoustic');
	assert.ok(listed.slice(1).every((preset) => preset.custom === false));

	const cathedral = 'audacity-factory:audacity-reverb:cathedral';
	assert.equal(applyAudioEditorEffectPreset(saved.state, cathedral).params.roomSize, 90);
	assert.throws(
		() => saveAudioEditorEffectPreset(saved.state, {
			id: cathedral, effectType: 'audacity-reverb', name: 'Cathedral', params: {},
		}),
		/A factory effect preset cannot be overwritten/,
	);
	assert.throws(
		() => deleteAudioEditorEffectPreset(saved.state, cathedral),
		/A factory effect preset cannot be deleted/,
	);
});

test('an exported factory preset comes back as a preset of the project\'s own', () => {
	const cathedral = 'audacity-factory:audacity-reverb:cathedral';
	const encoded = exportAudioEditorEffectPreset(createAudioEditorEffectPresets(), cathedral);
	const written = JSON.parse(encoded).presets[0];
	assert.deepEqual(Object.keys(written), ['id', 'effectType', 'name', 'params']);

	const restored = importAudioEditorEffectPresets(createAudioEditorEffectPresets(), encoded, {
		idFactory: () => 'preset-cathedral',
	});
	assert.equal(restored.presets.length, 1);
	assert.equal(restored.presets[0].id, 'preset-cathedral');
	assert.equal(restored.presets[0].name, 'Cathedral');
	assert.equal(restored.presets[0].params.roomSize, 90);
	assert.equal(applyAudioEditorEffectPreset(restored, cathedral).id, cathedral);
});
