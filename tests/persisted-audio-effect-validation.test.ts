/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePersistedAudioEffects } from '../src/common/editor/persisted-audio-effect-validation.ts';

function parametricEq(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		id: 'eq-1',
		type: 'eq',
		enabled: true,
		params: {
			outputGain: 0,
			bands: [{
				id: 'eq-1-band-1',
				enabled: true,
				type: 'peaking',
				frequency: 1_000,
				gain: 0,
				q: 1,
				slope: 12,
			}],
		},
		...overrides,
	};
}

test('persisted audio effects accept canonical EQ aliases without mutating the rack', () => {
	for (const type of ['eq', 'parametric-eq', 'parametric_eq']) {
		const effects = [parametricEq({
			type,
			context: { channel: 1, labels: ['dialogue'] },
			state: null,
		})];
		const before = structuredClone(effects);

		assert.equal(validatePersistedAudioEffects(effects, 'track.effects'), true);
		assert.deepEqual(effects, before);
	}

	assert.equal(validatePersistedAudioEffects([parametricEq({ params: {} })], 'track.effects'), true);
	assert.equal(validatePersistedAudioEffects([parametricEq({
		params: {
			bands: [
				{ enabled: true, type: 'peaking', frequency: 100, gain: 0, q: 1, slope: 12 },
				{ id: 'eq-1-band-1', enabled: true, type: 'lowpass', frequency: 8_000, gain: 0, q: 1, slope: 24 },
			],
		},
	})], 'track.effects'), true);
});

test('persisted audio effects reject invalid parametric EQ state', () => {
	const invalid: readonly (readonly [Record<string, unknown>, RegExp])[] = [
		[parametricEq({ params: { bands: Array.from({ length: 13 }, () => ({})) } }),
			/supports between zero and 12 bands/iu],
		[parametricEq({ params: { bands: [
			{ id: 'duplicate', frequency: 100, gain: 0, q: 1 },
			{ id: ' duplicate ', frequency: 200, gain: 0, q: 1 },
		] } }), /Duplicate parametric EQ band ID: duplicate/iu],
		[parametricEq({ params: { outputGain: 25, bands: [] } }),
			/eq\.outputGain must be between -24 and 24/iu],
		[parametricEq({ params: { bands: [{ enabled: 'yes', frequency: 100, gain: 0, q: 1 }] } }),
			/eq\.bands\[0\]\.enabled must be a boolean/iu],
		[parametricEq({ params: { bands: [{ type: 'peak', frequency: 100, gain: 0, q: 1 }] } }),
			/eq\.bands\[0\]\.type must be one of peaking/iu],
		[parametricEq({ params: { bands: [{ frequency: 0, gain: 0, q: 1 }] } }),
			/eq\.bands\[0\]\.frequency must be between 10 and 24000/iu],
		[parametricEq({ params: { bands: [{ frequency: 100, gain: 25, q: 1 }] } }),
			/eq\.bands\[0\]\.gain must be between -24 and 24/iu],
		[parametricEq({ params: { bands: [{ frequency: 100, gain: 0, q: 0.01 }] } }),
			/eq\.bands\[0\]\.q must be between 0\.1 and 30/iu],
		[parametricEq({ params: { bands: [{ frequency: 100, gain: 0, q: 1, slope: 18 }] } }),
			/eq\.bands\[0\]\.slope must be one of 12, 24, 36, 48/iu],
		[parametricEq({ context: new Date('2026-01-01T00:00:00.000Z') }),
			/master\.effects\[0\]\.context must be a JSON-safe object or null/iu],
	];

	for (const [effect, expected] of invalid) {
		assert.throws(
			() => validatePersistedAudioEffects([effect], 'master.effects'),
			expected,
		);
	}
});

test('persisted audio effects validate missing-effect metadata and cloneable opaque state', () => {
	const effect = {
		id: 'missing-1',
		type: 'missing',
		enabled: false,
		params: {},
		missing: {
			name: 'Unavailable plug-in',
			nativeId: 'vendor.plugin',
			reason: 'Not installed',
			source: 'aup4',
		},
		opaqueAudacityNode: {
			bytes: new Uint8Array([1, 2, 3]),
		},
	};

	assert.equal(validatePersistedAudioEffects([effect], 'track.effects'), true);
	assert.throws(
		() => validatePersistedAudioEffects([{ ...effect, missing: null }], 'track.effects'),
		/missing effect.*metadata/iu,
	);
	assert.throws(
		() => validatePersistedAudioEffects([{
			...effect,
			missing: { ...effect.missing, nativeId: 'x'.repeat(65_537) },
		}], 'track.effects'),
		/size limit/iu,
	);
});

test('persisted audio effects retain opaque third-party payloads but reject non-cloneable state', () => {
	const opaqueEffect = {
		id: 'vendor-1',
		type: 'vendor.example.effect',
		enabled: true,
		params: {
			amount: 0.5,
			binaryState: new Uint8Array([4, 5, 6]),
			nested: { futureField: ['retained'] },
		},
		opaqueExtension: { revision: 42 },
	};
	assert.equal(validatePersistedAudioEffects([opaqueEffect], 'mixer.send.effects'), true);

	assert.throws(
		() => validatePersistedAudioEffects([{
			...opaqueEffect,
			opaqueExtension: { callback: () => undefined },
		}], 'mixer.send.effects'),
		/mixer\.send\.effects\[0\].*cloneable/iu,
	);
	assert.throws(
		() => validatePersistedAudioEffects([{ ...opaqueEffect, params: [] }], 'track.effects'),
		/track\.effects\[0\]\.params.*object/iu,
	);
});

test('persisted audio effect stacks require canonical unique identities', () => {
	assert.throws(
		() => validatePersistedAudioEffects({}, 'track.effects'),
		/track\.effects.*array/iu,
	);
	assert.throws(
		() => validatePersistedAudioEffects([{ id: ' ', type: 'effect', enabled: true, params: {} }], 'track.effects'),
		/track\.effects\[0\]\.id.*non-empty/iu,
	);
	assert.throws(
		() => validatePersistedAudioEffects([{ id: 'one', type: '', enabled: true, params: {} }], 'track.effects'),
		/track\.effects\[0\]\.type.*non-empty/iu,
	);
	assert.throws(
		() => validatePersistedAudioEffects([{ id: 'one', type: 'effect', enabled: 1, params: {} }], 'track.effects'),
		/track\.effects\[0\]\.enabled.*boolean/iu,
	);
	assert.throws(
		() => validatePersistedAudioEffects([
			{ id: 'one', type: 'effect', enabled: true, params: {} },
			{ id: 'one', type: 'other', enabled: false, params: {} },
		], 'track.effects'),
		/track\.effects.*duplicate.*one/iu,
	);
});
