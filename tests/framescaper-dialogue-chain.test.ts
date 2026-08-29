/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_DEFAULT_LOUDNESS_TARGET_FINISHING as DEFAULT_TARGET,
	FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_FINISHING as EFFECT_TYPES,
	FRAMESCAPER_DIALOGUE_CHAIN_SCHEMA_VERSION_FINISHING as SCHEMA_VERSION,
	FRAMESCAPER_DIALOGUE_NOISE_REDUCTION_PLACEMENT_FINISHING as NOISE_PLACEMENT,
	FRAMESCAPER_LOUDNESS_TARGET_PRESET_IDS_FINISHING as PRESET_IDS,
	createFramescaperDialogueChain,
	createFramescaperDialogueChainAddCommand,
	createFramescaperDialogueChainAddCommandFinishing,
	createFramescaperDialogueChainFinishing as createChain,
	normalizeFramescaperDialogueChainFinishing as normalizeChain,
	resolveFramescaperLoudnessTargetFinishing as resolveTarget,
} from '../src/framescaper/editor-audio-dialogue-chain-finishing.ts';

type Data = Record<string, unknown>;

function chain(overrides: Data = {}): Data {
	return createChain({ id: 'chain-1', sampleRate: 48_000, ...overrides }) as unknown as Data;
}

function wire(value: Data): Data {
	return JSON.parse(JSON.stringify(value)) as Data;
}

test('a dialogue chain is built in its one canonical processor order', () => {
	const built = chain();

	assert.equal(built.schemaVersion, SCHEMA_VERSION);
	assert.equal(built.id, 'chain-1');
	assert.equal(built.sampleRate, 48_000);
	assert.equal(built.noiseReductionPlacement, null);
	assert.deepEqual(
		(built.effects as Data[]).map(({ type }) => type),
		[...EFFECT_TYPES],
	);
});

test('every chain effect carries an identity derived from its chain and type', () => {
	const built = chain();

	assert.deepEqual(
		(built.effects as Data[]).map(({ id }) => id),
		EFFECT_TYPES.map((type) => `chain-1:${type}`),
	);
});

test('a dialogue chain survives a JSON round trip unchanged', () => {
	const built = chain();

	assert.deepEqual(normalizeChain(wire(built)), built);
});

test('an alternate processor order is refused rather than reordered', () => {
	const built = wire(chain());

	assert.throws(
		() => normalizeChain({ ...built, effects: [...(built.effects as Data[])].reverse() }),
		/identity is not canonical/u,
	);
});

test('a chain from another schema generation is refused', () => {
	const built = wire(chain());

	assert.throws(
		() => normalizeChain({ ...built, schemaVersion: SCHEMA_VERSION + 1 }),
		/schema is unsupported/u,
	);
});

test('chain options are closed and require an identity and sample rate', () => {
	assert.throws(() => createChain({ sampleRate: 48_000 }), /id is required/u);
	assert.throws(() => createChain({ id: 'chain-1' }), /sampleRate is required/u);
	assert.throws(
		() => createChain({ id: 'chain-1', sampleRate: 48_000, extra: 1 }),
		/contains an unsupported field/u,
	);
});

test('a chain sample rate is bounded to the supported audio range', () => {
	assert.throws(() => createChain({ id: 'chain-1', sampleRate: 0 }), RangeError);
	assert.throws(() => createChain({ id: 'chain-1', sampleRate: 384_001 }), RangeError);
	assert.doesNotThrow(() => createChain({ id: 'chain-1', sampleRate: 8_000 }));
});

test('the noise reduction placement is published as a fixed position in the chain', () => {
	assert.equal(NOISE_PLACEMENT, 'after-highpass-before-gate');
	assert.equal(
		EFFECT_TYPES.indexOf('gate') - EFFECT_TYPES.indexOf('highpass'),
		1,
		'the published placement must name two adjacent core processors',
	);
});

test('a loudness target resolves from a preset identifier or from nothing', () => {
	assert.equal(resolveTarget(null), DEFAULT_TARGET);

	for (const preset of PRESET_IDS) {
		const resolved = resolveTarget(preset) as unknown as Data;
		assert.equal(typeof resolved.integratedLufs, 'number');
		assert.equal(typeof resolved.truePeakCeilingDb, 'number');
	}
});

test('an unrecognised loudness target shape is refused', () => {
	assert.throws(() => resolveTarget({ integratedLufs: -23, truePeakDbtp: -1 }), TypeError);
	assert.throws(() => resolveTarget('not-a-preset'), Error);
});

test('the shortened chain and command names are the same entry points', () => {
	assert.equal(createFramescaperDialogueChain, createChain);
	assert.equal(
		createFramescaperDialogueChainAddCommand,
		createFramescaperDialogueChainAddCommandFinishing,
	);
});
