/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityXmlAttribute as readXmlAttribute,
	audacityXmlChildren as readXmlChildren,
	createAudacityXmlNode,
} from '../src/common/editor/audacity-binary-xml.js';
import {
	createAup3ProjectDocument,
	type Aup3XmlNode,
} from '../src/common/editor/aup3-profile.ts';
import {
	AUP4_REALTIME_EFFECT_PROFILES,
	aup4NativeEffectId,
	createAup4EffectsNode,
} from '../src/common/editor/aup4-effects.js';
import { createEffect, createMissingEffect } from '../src/common/editor/effects.js';

const audacityXmlAttribute = readXmlAttribute as unknown as (
	node: unknown, name: string, fallback?: unknown,
) => unknown;
const audacityXmlChildren = readXmlChildren as unknown as (
	node: unknown, name: string,
) => Aup3XmlNode[];

test('AUP3 profile retains only the native effects Audacity 3.7 can run in real time', () => {
	const supportedTypes = [
		'audacity-bass-treble', 'audacity-compressor', 'audacity-distortion',
		'audacity-limiter', 'audacity-phaser', 'audacity-reverb', 'audacity-wahwah',
	];
	const unsupportedTypes = [
		'audacity-auto-duck', 'audacity-click-removal', 'audacity-echo',
		'audacity-filter-curve-eq', 'audacity-graphic-eq', 'audacity-invert',
		'audacity-noise-reduction', 'audacity-classic-filters',
	];
	assert.deepEqual(Object.keys(AUP4_REALTIME_EFFECT_PROFILES).sort(), [
		...supportedTypes, ...unsupportedTypes,
	].sort());
	const result = createAup3ProjectDocument(projectWithEffects(
		[...supportedTypes, ...unsupportedTypes].map((type) => createEffect(type, { id: type })),
	));
	assert.deepEqual(effectNodes(result.document).map((effect) => (
		audacityXmlAttribute(effect, 'id')
	)), [
		'Effect_Audacity_Audacity_Bass and Treble_Built-in Effect: Bass and Treble',
		'Effect_Audacity_Audacity_Compressor_Built-in Effect: Compressor',
		'Effect_Audacity_Audacity_Distortion_Built-in Effect: Distortion',
		'Effect_Audacity_Audacity_Limiter_Built-in Effect: Limiter',
		'Effect_Audacity_Audacity_Phaser_Built-in Effect: Phaser',
		'Effect_Audacity_Audacity_Reverb_Built-in Effect: Reverb',
		'Effect_Audacity_Audacity_Wahwah_Built-in Effect: Wahwah',
	]);
	assert.deepEqual(result.omissions.entries.filter((entry) => (
		entry.reason === 'unsupported-aup3-realtime-effect'
	)).map((entry) => entry.type), unsupportedTypes);
});

test('AUP3 profile omits opaque effects rather than stripping their binary state', () => {
	const nativeId = 'Effect_VST3_Acme_SuperVerb_Acme SuperVerb';
	const zeroStateId = 'Effect_VST3_Acme_ZeroState_Acme ZeroState';
	const reverbId = 'Effect_Audacity_Audacity_Reverb_Built-in Effect: Reverb';
	const opaqueEffect = missingEffectWithState('SuperVerb', nativeId, Uint8Array.of(1, 2, 3));
	const zeroStateEffect = missingEffectWithState('ZeroState', zeroStateId, new Uint8Array());
	const reverbWithOpaqueState = {
		...createEffect('audacity-reverb', { id: 'reverb-with-opaque-state' }),
		opaqueAudacityNode: {
			kind: 'node',
			node: createAudacityXmlNode('effect', [
				{ kind: 'attribute', name: 'active', type: 'bool', value: true },
				{ kind: 'attribute', name: 'id', type: 'string', value: reverbId },
			], [{
				kind: 'node',
				node: createAudacityXmlNode('parameters', [], [{
					kind: 'node',
					node: createAudacityXmlNode('parameter', [
						{ kind: 'attribute', name: 'name', type: 'string', value: 'RoomSize' },
						{ kind: 'attribute', name: 'value', type: 'string', value: '75' },
					], [{ kind: 'blob', name: 'future-state', value: Uint8Array.of(9) }]),
				}]),
			}]),
		},
	};
	const result = createAup3ProjectDocument(projectWithEffects([
		opaqueEffect, zeroStateEffect, reverbWithOpaqueState,
	]));
	assert.equal(effectNodes(result.document).length, 0);
	const binaryOmissions = result.omissions.entries.filter((entry) => (
		entry.reason === 'unsupported-aup3-effect-binary-state'
	));
	assert.deepEqual(binaryOmissions.map(({ name, nativeId: id, type, byteLength }) => ({
		name, nativeId: id, type, byteLength,
	})), [{
		name: 'SuperVerb', nativeId, type: undefined, byteLength: 3,
	}, {
		name: 'ZeroState', nativeId: zeroStateId, type: undefined, byteLength: 0,
	}, {
		name: 'Reverb', nativeId: reverbId, type: 'audacity-reverb', byteLength: 1,
	}]);
});

for (const rackScope of ['track', 'master'] as const) {
	test(`AUP3 profile keeps opaque rack positions when omitting ${rackScope} binary state`, () => {
		const reverbId = aup4NativeEffectId('audacity-reverb');
		const phaserId = aup4NativeEffectId('audacity-phaser');
		const compressorId = aup4NativeEffectId('audacity-compressor');
		const [generatedReverb] = audacityXmlChildren(createAup4EffectsNode([
			createEffect('audacity-reverb', { id: 'reverb' }),
		]), 'effect');
		const reverbWithBlob = createAudacityXmlNode(
			'effect',
			generatedReverb.content.filter((entry) => entry.kind === 'attribute'),
			[
				...generatedReverb.content.filter((entry) => entry.kind !== 'attribute'),
				{ kind: 'blob', name: 'future-state', value: Uint8Array.of(7, 8, 9) },
			],
		);
		const malformedPhaser = createAudacityXmlNode('effect', [
			{ kind: 'attribute', name: 'active', type: 'bool', value: true },
			{ kind: 'attribute', name: 'id', type: 'string', value: phaserId },
			{ kind: 'attribute', name: 'vendor-state', type: 'long', value: 42 },
		], [{
			kind: 'node',
			node: createAudacityXmlNode('parameters', [], [
				parameterNode('Stages', '2'), parameterNode('Stages', '3'),
			]),
		}]);
		const [compressor] = audacityXmlChildren(createAup4EffectsNode([
			createEffect('audacity-compressor', { id: 'compressor' }),
		]), 'effect');
		const opaqueRack = {
			kind: 'node' as const,
			node: createAudacityXmlNode('effects', [], [
				{ kind: 'node', node: reverbWithBlob },
				{ kind: 'node', node: malformedPhaser },
				{ kind: 'node', node: compressor },
			]),
		};
		const modeledEffects = [{
			...createEffect('audacity-reverb', { id: 'reverb' }),
			opaqueAudacityNode: { kind: 'node', node: reverbWithBlob },
		}, createEffect('audacity-compressor', { id: 'compressor' })];
		const project = projectWithEffects(rackScope === 'track' ? modeledEffects : []);
		if (rackScope === 'track') {
			(project.tracks[0] as Record<string, unknown>).opaqueExtensions = { effects: [opaqueRack] };
		} else {
			project.master = { effects: modeledEffects };
			(project as Record<string, unknown>).opaqueExtensions = { aup4MasterEffects: opaqueRack };
		}

		const result = createAup3ProjectDocument(project);
		const retained = scopedEffectNodes(result.document, rackScope);
		assert.deepEqual(retained.map((effect) => audacityXmlAttribute(effect, 'id')), [
			phaserId, compressorId,
		]);
		assert.equal(audacityXmlAttribute(retained[0], 'vendor-state'), 42);
		assert.equal(countBlobs(result.document.roots), 0);
		const omissions = result.omissions.entries.filter((entry) => (
			entry.reason === 'unsupported-aup3-effect-binary-state'
		));
		assert.deepEqual(omissions.map(({ name, nativeId, type, byteLength, active }) => ({
			name, nativeId, type, byteLength, active,
		})), [{
			name: 'Reverb', nativeId: reverbId, type: 'audacity-reverb', byteLength: 3, active: true,
		}]);
	});
}

test('AUP3 effect capability checks use the last duplicate native ID', () => {
	const supportedId = 'Effect_Audacity_Audacity_Reverb_Built-in Effect: Reverb';
	const unsupportedId = 'Effect_Audacity_Audacity_Invert_Built-in Effect: Invert';
	const duplicateIdEffect = createMissingEffect({
		id: 'duplicate-native-id', enabled: true,
		missing: {
			name: 'Invert', nativeId: unsupportedId, reason: 'plugin-unavailable', source: 'aup3',
		},
		opaqueAudacityNode: {
			kind: 'node',
			node: createAudacityXmlNode('effect', [
				{ kind: 'attribute', name: 'active', type: 'bool', value: true },
				{ kind: 'attribute', name: 'id', type: 'string', value: supportedId },
				{ kind: 'attribute', name: 'id', type: 'string', value: unsupportedId },
			]),
		},
	});
	const result = createAup3ProjectDocument(projectWithEffects([duplicateIdEffect]));
	assert.equal(effectNodes(result.document).length, 0);
	assert.ok(result.omissions.entries.some((entry) => (
		entry.reason === 'unsupported-aup3-realtime-effect'
			&& entry.type === 'audacity-invert'
			&& entry.nativeId === unsupportedId
	)));
});

function missingEffectWithState(name: string, nativeId: string, state: Uint8Array) {
	return createMissingEffect({
		id: `missing-${name.toLowerCase()}`, enabled: true,
		missing: { name, nativeId, reason: 'plugin-unavailable', source: 'aup4' },
		opaqueAudacityNode: {
			kind: 'node',
			node: createAudacityXmlNode('effect', [
				{ kind: 'attribute', name: 'active', type: 'bool', value: true },
				{ kind: 'attribute', name: 'id', type: 'string', value: nativeId },
			], [{ kind: 'blob', name: 'state', value: state }]),
		},
	});
}

function projectWithEffects(effects: unknown[]): Record<string, unknown> & {
	tracks: Record<string, unknown>[];
	master: Record<string, unknown>;
} {
	return {
		id: 'project', title: 'AUP3 effects', sampleRate: 48_000,
		selection: {}, metadata: {}, clips: [], sources: [],
		tracks: [{ id: 'track', type: 'audio', name: 'Audio', clipIds: [], effects }],
		master: { effects: [] },
	};
}

function effectNodes(document: ReturnType<typeof createAup3ProjectDocument>['document']) {
	const root = document.roots.find((entry) => entry.kind === 'node')?.node;
	const waveTrack = root && audacityXmlChildren(root, 'wavetrack')[0];
	const effects = waveTrack && audacityXmlChildren(waveTrack, 'effects')[0];
	assert.ok(effects);
	return audacityXmlChildren(effects, 'effect');
}

function scopedEffectNodes(
	document: ReturnType<typeof createAup3ProjectDocument>['document'],
	scope: 'track' | 'master',
) {
	const root = document.roots.find((entry) => entry.kind === 'node')?.node;
	assert.ok(root);
	const effects = scope === 'track'
		? audacityXmlChildren(audacityXmlChildren(root, 'wavetrack')[0], 'effects')[0]
		: audacityXmlChildren(root, 'effects')[0];
	assert.ok(effects);
	return audacityXmlChildren(effects, 'effect');
}

function parameterNode(name: string, value: string) {
	return {
		kind: 'node' as const,
		node: createAudacityXmlNode('parameter', [
			{ kind: 'attribute', name: 'name', type: 'string', value: name },
			{ kind: 'attribute', name: 'value', type: 'string', value },
		]),
	};
}

function countBlobs(entries: readonly unknown[]): number {
	let count = 0;
	for (const value of entries) {
		const entry = value as { kind?: string; node?: { content?: readonly unknown[] } };
		if (entry.kind === 'blob') count += 1;
		if (entry.kind === 'node') count += countBlobs(entry.node?.content ?? []);
	}
	return count;
}
