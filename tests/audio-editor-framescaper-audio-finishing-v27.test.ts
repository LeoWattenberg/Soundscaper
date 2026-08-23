/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { LOUDNESS_NORMALIZATION_TARGETS } from '../src/common/editor/loudness-normalization.ts';
import { MIXER_GRAPH_V21_SCHEMA_VERSION } from '../src/common/editor/mixer-graph-v21.ts';
import { assertEditorCommandCapabilities } from '../src/common/editor/controller/command-capability-policy.ts';
import {
	createDefaultFramescaperAudioFinishingV27,
	normalizeFramescaperAudioFinishingV27,
} from '../src/framescaper/editor-audio-finishing-v27.ts';
import {
	FRAMESCAPER_DEFAULT_LOUDNESS_TARGET_V27,
	FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_V27,
	FRAMESCAPER_DIALOGUE_NOISE_REDUCTION_PLACEMENT_V27,
	FRAMESCAPER_LOUDNESS_TARGET_PRESET_IDS_V27,
	createFramescaperDialogueChainAddCommandV27,
	createFramescaperDialogueChainV27,
	normalizeFramescaperDialogueChainV27,
	resolveFramescaperLoudnessTargetV27,
} from '../src/framescaper/editor-audio-dialogue-chain-v27.ts';

const PROJECT = Object.freeze({
	sampleRate: 48_000,
	masterChannels: 2,
	tracks: Object.freeze([
		Object.freeze({ id: 'dialogue', type: 'audio', effects: Object.freeze([]) }),
		Object.freeze({ id: 'picture', type: 'video', effects: Object.freeze([]) }),
	]),
	master: Object.freeze({ effects: Object.freeze([]) }),
});

test('Framescaper V27 audio state uses the shared V21 automation and mixer authorities', () => {
	const defaults = createDefaultFramescaperAudioFinishingV27(PROJECT);
	assert.deepEqual(defaults.automationLanes, []);
	assert.equal(defaults.mixer.schemaVersion, MIXER_GRAPH_V21_SCHEMA_VERSION);
	assert.deepEqual(defaults.mixer.edges.map(({ source }) => source), [
		{ kind: 'track', id: 'dialogue' },
		{ kind: 'master' },
	]);

	const lane = {
		id: 'dialogue-gain',
		address: { kind: 'strip', strip: { kind: 'track', id: 'dialogue' }, parameterId: 'gain' },
		timebase: 'absolute-samples',
		points: [{ id: 'gain-start', position: 0, value: 1 }],
		segments: [],
	};
	const normalized = normalizeFramescaperAudioFinishingV27(PROJECT, {
		automationLanes: [lane], mixer: defaults.mixer,
	});
	assert.equal(normalized.automationLanes[0]?.address.kind, 'strip');
	assert.ok(Object.isFrozen(normalized.automationLanes));
	assert.ok(Object.isFrozen(normalized.mixer));
});

test('the deterministic dialogue chain has exact required order and caller-independent IDs', () => {
	const first = createFramescaperDialogueChainV27({
		id: 'dialogue-main', sampleRate: 48_000,
	});
	const second = createFramescaperDialogueChainV27({
		id: 'dialogue-main', sampleRate: 48_000,
	});
	assert.deepEqual(first, second);
	assert.deepEqual(FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_V27, [
		'highpass', 'gate', 'eq', 'compressor', 'limiter',
	]);
	assert.deepEqual(first.effects.map(({ type }) => type), FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_V27);
	assert.deepEqual(first.effects.map(({ id }) => id), [
		'dialogue-main:highpass',
		'dialogue-main:gate',
		'dialogue-main:eq',
		'dialogue-main:compressor',
		'dialogue-main:limiter',
	]);
	assert.equal(first.noiseReductionPlacement, null);
	assert.equal(first.effects[0]?.params.frequency, 80);
	assert.equal(first.effects[4]?.params.ceiling, -1);
	assert.ok(Object.isFrozen(first));
	assert.ok(Object.isFrozen(first.effects));
	assert.ok(Object.isFrozen(first.effects[2]?.params));
	assert.deepEqual(normalizeFramescaperDialogueChainV27(first), first);
});

test('profiled noise reduction has one explicit validated position in the dialogue chain', () => {
	const profile = noiseProfile();
	const chain = createFramescaperDialogueChainV27({
		id: 'dialogue-main',
		sampleRate: 48_000,
		parameters: { highpass: { frequency: 100 }, compressor: { ratio: 3 } },
		noiseReduction: { profile, params: { reductionDb: 9 } },
	});
	profile.meanPowers[0] = 99;
	assert.equal(chain.noiseReductionPlacement, FRAMESCAPER_DIALOGUE_NOISE_REDUCTION_PLACEMENT_V27);
	assert.deepEqual(chain.effects.map(({ type }) => type), [
		'highpass', 'audacity-noise-reduction', 'gate', 'eq', 'compressor', 'limiter',
	]);
	assert.equal(chain.effects[1]?.id, 'dialogue-main:profiled-noise-reduction');
	assert.equal(chain.effects[1]?.params.reductionDb, 9);
	assert.equal(chain.effects[1]?.context?.noiseProfile.meanPowers[0], 0.000001);
	assert.equal(chain.effects[0]?.params.frequency, 100);
	assert.equal(chain.effects[4]?.params.ratio, 3);
	assert.ok(Object.isFrozen(chain.effects[1]?.context?.noiseProfile.meanPowers));

	assert.throws(() => createFramescaperDialogueChainV27({
		id: 'dialogue-main', sampleRate: 44_100,
		noiseReduction: { profile: noiseProfile() },
	}), /sample rate.*match|match.*sample rate/iu);
	assert.throws(() => createFramescaperDialogueChainV27({
		id: 'dialogue-main', sampleRate: 48_000,
		noiseReduction: { profile: { ...noiseProfile(), meanPowers: [] } },
	}), /profile spectrum/iu);

	const misplaced = structuredClone(chain) as unknown as Record<string, unknown>;
	const effects = misplaced.effects as Record<string, unknown>[];
	[effects[0], effects[1]] = [effects[1]!, effects[0]!];
	assert.throws(() => normalizeFramescaperDialogueChainV27(misplaced), /order|highpass/iu);
	const unprofiled = structuredClone(chain) as unknown as Record<string, unknown>;
	delete ((unprofiled.effects as Record<string, unknown>[])[1]!).context;
	assert.throws(() => normalizeFramescaperDialogueChainV27(unprofiled), /noise-reduction.*context|noise profile/iu);
});

test('dialogue-chain normalization rejects incomplete, disabled, foreign, and noncanonical state', () => {
	const chain = createFramescaperDialogueChainV27({ id: 'dialogue-main', sampleRate: 48_000 });
	const incomplete = structuredClone(chain) as unknown as Record<string, unknown>;
	(incomplete.effects as unknown[]).splice(2, 1);
	assert.throws(() => normalizeFramescaperDialogueChainV27(incomplete), /5 through 6|five|effect count|order/iu);
	const disabled = structuredClone(chain) as unknown as Record<string, unknown>;
	((disabled.effects as Record<string, unknown>[])[1]!).enabled = false;
	assert.throws(() => normalizeFramescaperDialogueChainV27(disabled), /enabled/iu);
	const foreign = structuredClone(chain) as unknown as Record<string, unknown>;
	foreign.provider = 'soundscaper';
	assert.throws(() => normalizeFramescaperDialogueChainV27(foreign), /unsupported field/iu);
	const randomIdentity = structuredClone(chain) as unknown as Record<string, unknown>;
	((randomIdentity.effects as Record<string, unknown>[])[0]!).id = 'random-effect';
	assert.throws(() => normalizeFramescaperDialogueChainV27(randomIdentity), /identity/iu);
});

test('the menu adapter emits one bounded V27 command without generic effect authoring', () => {
	const chain = createFramescaperDialogueChainV27({ id: 'dialogue-main', sampleRate: 48_000 });
	const command = createFramescaperDialogueChainAddCommandV27(
		{ scope: 'track', trackId: 'dialogue' }, chain, 2,
	);
	assert.equal(command.type, 'framescaper/audio-dialogue-chain-add');
	assert.equal(command.trackId, 'dialogue');
	assert.equal(command.startIndex, 2);
	assert.deepEqual(command.chain, chain);
	assert.equal(JSON.stringify(command).includes('effect/add'), false);
	assert.throws(() => createFramescaperDialogueChainAddCommandV27(
		{ scope: 'track', trackId: '' }, chain,
	), /track.*ID/iu);
	assert.throws(() => createFramescaperDialogueChainAddCommandV27(
		{ scope: 'group' }, chain,
	), /restricted.*audio track|audio track/iu);
});

test('the V27-owned chain command remains admitted while generic audio authoring stays fenced', () => {
	const chain = createFramescaperDialogueChainV27({ id: 'dialogue-main', sampleRate: 48_000 });
	const command = createFramescaperDialogueChainAddCommandV27(
		{ scope: 'track', trackId: 'dialogue' }, chain,
	);
	const capabilities = {
		audioEffects: false, audioAutomation: true, audioMixerGraph: true,
		audioRecording: false, audioSpectralEditing: false, audioWarp: false,
		takeComp: false, timelineAnnotations: false, trackFolders: false,
		videoEffects: true, videoGeometry: true, videoKeyframes: true,
	};
	assert.doesNotThrow(() => assertEditorCommandCapabilities(
		command as never, capabilities, 'Framescaper',
	));
	assert.throws(() => assertEditorCommandCapabilities({
		type: 'effect/add', scope: 'track', trackId: 'dialogue', effect: chain.effects[0]!,
	} as never, capabilities, 'Framescaper'), /does not support audioEffects/iu);
	assert.throws(() => assertEditorCommandCapabilities({
		type: 'clip/update', clipId: 'dialogue-clip', changes: { speedRatio: 0.5 },
	} as never, capabilities, 'Framescaper'), /does not support audioEffects/iu);
});

test('Framescaper reuses the existing loudness targets and deliberately has no default', () => {
	assert.equal(FRAMESCAPER_DEFAULT_LOUDNESS_TARGET_V27, null);
	assert.deepEqual(FRAMESCAPER_LOUDNESS_TARGET_PRESET_IDS_V27, [
		'ebu-r128', 'atsc-a85', 'streaming-14',
	]);
	for (const id of FRAMESCAPER_LOUDNESS_TARGET_PRESET_IDS_V27) {
		assert.strictEqual(resolveFramescaperLoudnessTargetV27(id), LOUDNESS_NORMALIZATION_TARGETS[id]);
	}
	assert.equal(resolveFramescaperLoudnessTargetV27(undefined), null);
	assert.equal(resolveFramescaperLoudnessTargetV27(null), null);
	assert.deepEqual(resolveFramescaperLoudnessTargetV27({
		integratedLufs: -16, truePeakCeilingDb: -1.5,
	}), { integratedLufs: -16, truePeakCeilingDb: -1.5 });
	assert.throws(() => resolveFramescaperLoudnessTargetV27('framescaper-default'), /Unknown loudness/iu);
});

function noiseProfile(): {
	type: string;
	version: number;
	sampleRate: number;
	windowSize: number;
	stepsPerWindow: number;
	windowType: string;
	channelCount: number;
	windowCount: number;
	meanPowers: number[];
} {
	return {
		type: 'audacity-noise-profile',
		version: 1,
		sampleRate: 48_000,
		windowSize: 2_048,
		stepsPerWindow: 4,
		windowType: 'hann-hann',
		channelCount: 1,
		windowCount: 8,
		meanPowers: Array.from({ length: 1_025 }, (_unused, index) => (index + 1) / 1_000_000),
	};
}
