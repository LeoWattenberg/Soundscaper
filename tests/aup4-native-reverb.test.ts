/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityXmlAttribute,
	audacityXmlChildren as readXmlChildren,
	createAudacityXmlNode,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from '../src/common/editor/audacity-binary-xml.js';
import {
	aup4NativeEffectId,
	canEncodeAup4NativeRealtimeEffect,
	createAup4EffectsNode,
	decodeAudacityRealtimeEffectParameters,
	encodeAudacityRealtimeEffectParameters,
	readAup4EffectsNode,
} from '../src/common/editor/aup4-effects.js';
import { createEffect } from '../src/common/editor/effects.js';

type XmlNode = ReturnType<typeof createAudacityXmlNode>;
type NativeParameter = readonly [name: string, value: string];
const audacityXmlChildren = readXmlChildren as unknown as (node: unknown, name: string) => XmlNode[];
const createNativeRack = createAup4EffectsNode as unknown as (effects: unknown[], opaqueRack: XmlNode) => XmlNode;

// Literal CapturedParameters keys and processing settings from Audacity
// 4c177d436e48c1d20f231eada44035593cb26292:
// src/effects/builtin_collection/reverb/reverbeffect.cpp:48-54 and
// src/effects/builtin_collection/reverb/reverbeffect.h:117-198.
// RealtimeEffectState writes this SaveSettings state, including WetOnly;
// these fixtures are independent of Soundscaper's parameter encoder.
const REVERB_ID = 'Effect_Audacity_Audacity_Reverb_Built-in Effect: Reverb';
const NATIVE_PARAMETERS: readonly NativeParameter[] = [
	['RoomSize', '81'], ['Delay', '99'], ['Reverberance', '23'],
	['HfDamping', '62'], ['ToneLow', '16'], ['ToneHigh', '19'],
	['WetGain', '-4'], ['DryGain', '-8'], ['StereoWidth', '64'], ['WetOnly', '1'],
];
const MODEL_PARAMETERS = {
	roomSize: 81, preDelay: 99, reverberance: 23, damping: 62,
	toneLow: 16, toneHigh: 19, wetGainDb: -4, dryGainDb: -8,
	stereoWidth: 64, wetOnly: true,
};

for (const enabled of [false, true]) {
	for (const wetOnly of [false, true]) {
		test(`AUP4 imports all ten native Reverb settings with active=${enabled} and WetOnly=${wetOnly}`, () => {
			const parameters = NATIVE_PARAMETERS.map<NativeParameter>(([name, value]) => [
				name, name === 'WetOnly' ? wetOnly ? '1' : '0' : value,
			]);
			const effectNode = nativeEffect(parameters, enabled);
			const encoded = encodeAudacityBinaryXml(nativeRack(effectNode));
			const rack = decodeAudacityBinaryXml(encoded.dictionary, encoded.document).root;
			let missingCount = 0;
			const [effect] = readAup4EffectsNode(rack, {
				idFactory: () => 'native-reverb',
				onMissingEffect: () => { missingCount += 1; },
			});
			assert.ok(effect);
			assert.equal(effect.type, 'audacity-reverb');
			assert.equal(effect.enabled, enabled);
			assert.equal(effect.bypassed, undefined);
			assert.equal(missingCount, 0);
			assert.deepEqual(effect.params, { ...MODEL_PARAMETERS, wetOnly });
			assert.deepEqual(effect.opaqueAudacityNode.node, effectNode);
			const rewritten = createAup4EffectsNode([effect]);
			const [rewrittenEffect] = audacityXmlChildren(rewritten, 'effect');
			assert.equal(audacityXmlAttribute(rewrittenEffect, 'id'), REVERB_ID);
			assert.equal(audacityXmlAttribute(rewrittenEffect, 'active'), enabled);
			assert.deepEqual(nativeParameters(rewrittenEffect), new Map(parameters));
		});
	}
}

test('AUP4 encodes browser Reverb using the native ID and every canonical saved name', () => {
	const effect = createEffect('audacity-reverb', { id: 'browser-reverb', params: MODEL_PARAMETERS });
	assert.equal(aup4NativeEffectId('audacity-reverb'), REVERB_ID);
	assert.equal(canEncodeAup4NativeRealtimeEffect(effect), true);
	assert.deepEqual(encodeAudacityRealtimeEffectParameters('audacity-reverb', MODEL_PARAMETERS), NATIVE_PARAMETERS);
	assert.deepEqual(decodeAudacityRealtimeEffectParameters('audacity-reverb', NATIVE_PARAMETERS), MODEL_PARAMETERS);
	const [encoded] = audacityXmlChildren(createAup4EffectsNode([effect]), 'effect');
	assert.equal(audacityXmlAttribute(encoded, 'id'), REVERB_ID);
	assert.deepEqual(nativeParameters(encoded), new Map(NATIVE_PARAMETERS));
});

test('AUP4 edits every imported Reverb control and reopens the rewritten native state', () => {
	const rack = nativeRack(nativeEffect(NATIVE_PARAMETERS, true));
	const [effect] = readAup4EffectsNode(rack, { idFactory: () => 'editable-reverb' });
	assert.equal(effect.type, 'audacity-reverb');
	const params = {
		roomSize: 35, preDelay: 25, reverberance: 70, damping: 48,
		toneLow: 72, toneHigh: 85, wetGainDb: -2, dryGainDb: -1,
		stereoWidth: 90, wetOnly: false,
	};
	const rewritten = createNativeRack([{ ...effect, enabled: false, params }], rack);
	const [rewrittenEffect] = audacityXmlChildren(rewritten, 'effect');
	assert.equal(audacityXmlAttribute(rewrittenEffect, 'id'), REVERB_ID);
	assert.equal(audacityXmlAttribute(rewrittenEffect, 'active'), false);
	assert.deepEqual(nativeParameters(rewrittenEffect), new Map([
		['RoomSize', '35'], ['Delay', '25'], ['Reverberance', '70'],
		['HfDamping', '48'], ['ToneLow', '72'], ['ToneHigh', '85'],
		['WetGain', '-2'], ['DryGain', '-1'], ['StereoWidth', '90'], ['WetOnly', '0'],
	]));
	const encoded = encodeAudacityBinaryXml(rewritten);
	const decoded = decodeAudacityBinaryXml(encoded.dictionary, encoded.document).root;
	const [reopened] = readAup4EffectsNode(decoded, { idFactory: () => 'reopened-reverb' });
	assert.equal(reopened.type, 'audacity-reverb');
	assert.equal(reopened.enabled, false);
	assert.deepEqual(reopened.params, params);
});

test('AUP4 initializes absent native Reverb parameters with pinned Audacity defaults', () => {
	const [effect] = readAup4EffectsNode(nativeRack(nativeEffect([], true)), { idFactory: () => 'default-reverb' });
	assert.equal(effect.type, 'audacity-reverb');
	assert.deepEqual(effect.params, {
		roomSize: 75, preDelay: 10, reverberance: 50, damping: 50,
		toneLow: 100, toneHigh: 100, wetGainDb: -1, dryGainDb: -1,
		stereoWidth: 100, wetOnly: false,
	});
});

for (const wetGainDb of [-20, 10]) {
	for (const dryGainDb of [-20, 10]) {
		test(`AUP4 exports native Reverb gain boundaries wet=${wetGainDb}, dry=${dryGainDb}`, () => {
			const params = { ...MODEL_PARAMETERS, wetGainDb, dryGainDb };
			const effect = createEffect('audacity-reverb', { id: 'native-gain-boundaries', params });
			assert.equal(canEncodeAup4NativeRealtimeEffect(effect), true);
			const [encoded] = audacityXmlChildren(createAup4EffectsNode([effect]), 'effect');
			assert.equal(audacityXmlAttribute(encoded, 'id'), REVERB_ID);
			assert.equal(nativeParameters(encoded).get('WetGain'), String(wetGainDb));
			assert.equal(nativeParameters(encoded).get('DryGain'), String(dryGainDb));
			const [reopened] = readAup4EffectsNode(nativeRack(encoded), { idFactory: () => 'native-boundaries-reopened' });
			assert.deepEqual(reopened.params, params);
		});
	}
}

for (const gain of ['wetGainDb', 'dryGainDb'] as const) {
	for (const value of [-60, -20.1, 10.1, 12]) {
		for (const imported of [false, true]) {
			test(`AUP4 preserves ${imported ? 'edited native' : 'browser'} Reverb ${gain}=${value} in browser fallback`, () => {
				const source = nativeEffect(NATIVE_PARAMETERS, true);
				const rack = nativeRack(source);
				const [native] = readAup4EffectsNode(rack, { idFactory: () => 'native-edited-outside-gain-range' });
				const params = { ...MODEL_PARAMETERS, [gain]: value };
				const browser = createEffect('audacity-reverb', { id: 'browser-outside-gain-range', enabled: false, params });
				const effect = imported ? { ...native, enabled: false, params } : browser;
				assert.equal(canEncodeAup4NativeRealtimeEffect(effect), false);
				const rewritten = imported ? createNativeRack([effect], rack) : createAup4EffectsNode([effect]);
				const [encoded] = audacityXmlChildren(rewritten, 'effect');
				const id = String(audacityXmlAttribute(encoded, 'id'));
				assert.ok(id.startsWith('Effect_kw.media_kw.media_'), 'native Audacity must preserve an unavailable browser extension');
				assert.notEqual(id, REVERB_ID, 'the imported native ID must be replaced when its gains cannot load natively');
				assert.equal(audacityXmlAttribute(encoded, 'active'), false);
				if (imported) assert.deepEqual(audacityXmlChildren(encoded, 'parameters'), audacityXmlChildren(source, 'parameters'));
				const binary = encodeAudacityBinaryXml(rewritten);
				const decoded = decodeAudacityBinaryXml(binary.dictionary, binary.document).root;
				let missingCount = 0;
				const [reopened] = readAup4EffectsNode(decoded, {
					idFactory: () => 'unexpected-reopened-fallback-id',
					onMissingEffect: () => { missingCount += 1; },
				});
				assert.equal(missingCount, 0);
				assert.equal(reopened.type, 'audacity-reverb');
				assert.equal(reopened.id, effect.id);
				assert.equal(reopened.enabled, false);
				assert.deepEqual(reopened.params, params);
				assert.deepEqual(audacityXmlChildren(createAup4EffectsNode([reopened]), 'effect'), [encoded]);
			});
		}
	}
}

test('AUP4 keeps future native Reverb processing state visible and bypassed', () => {
	const effectNode = nativeEffect([...NATIVE_PARAMETERS, ['FutureReverbControl', '1']], true);
	const [effect] = readAup4EffectsNode(nativeRack(effectNode), { idFactory: () => 'future-reverb' });
	assert.equal(effect.type, 'missing');
	assert.ok(effect.missing);
	assert.equal(effect.missing.reason, 'unsupported-state');
	assert.equal(effect.bypassed, true);
	assert.deepEqual(audacityXmlChildren(createAup4EffectsNode([effect]), 'effect'), [effectNode]);
});

function nativeRack(effect: XmlNode): XmlNode {
	return createAudacityXmlNode('effects', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
	], [{ kind: 'node', node: effect }]);
}

function nativeEffect(parameters: readonly NativeParameter[], enabled: boolean): XmlNode {
	return createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'id', type: 'string', value: REVERB_ID },
		{ kind: 'attribute', name: 'active', type: 'bool', value: enabled },
	], [{ kind: 'node', node: createAudacityXmlNode('parameters', [], parameters.map(([name, value]) => ({
		kind: 'node', node: createAudacityXmlNode('parameter', [
			{ kind: 'attribute', name: 'name', type: 'string', value: name },
			{ kind: 'attribute', name: 'value', type: 'string', value },
		]),
	}))) }]);
}

function nativeParameters(effect: XmlNode): Map<string, string> {
	const [container] = audacityXmlChildren(effect, 'parameters');
	return new Map(audacityXmlChildren(container, 'parameter').map((parameter) => [
		String(audacityXmlAttribute(parameter, 'name')),
		String(audacityXmlAttribute(parameter, 'value')),
	]));
}
