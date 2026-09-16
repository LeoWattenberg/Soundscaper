/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from '../src/common/editor/audacity-binary-xml.js';
import {
	createAup4EffectsNode,
	readAup4EffectsNode,
} from '../src/common/editor/aup4-effects.js';

type XmlNode = ReturnType<typeof createAudacityXmlNode>;
type NativeParameter = readonly [name: string, value: string];

// CapturedParameters at Audacity 4c177d436e48c1d20f231eada44035593cb26292
// includes these display settings in CompressorEffect and LimiterEffect state.
const DISPLAY_PARAMETERS: readonly NativeParameter[] = [
	['showInput', '0'], ['showOutput', '1'], ['showActual', '0'], ['showTarget', '1'],
];
const NATIVE_DYNAMICS = [
	{
		type: 'audacity-compressor',
		id: 'Effect_Audacity_Audacity_Compressor_Built-in Effect: Compressor',
		parameters: [
			['thresholdDb', '-18'], ['makeupGainDb', '2'], ['kneeWidthDb', '4'],
			['compressionRatio', '6'], ['lookaheadMs', '5'], ['attackMs', '12'], ['releaseMs', '240'],
		] satisfies readonly NativeParameter[],
		params: {
			thresholdDb: -18, makeupGainDb: 2, kneeWidthDb: 4, ratio: 6,
			lookaheadMs: 5, attackMs: 12, releaseMs: 240,
		},
	},
	{
		type: 'audacity-limiter',
		id: 'Effect_Audacity_Audacity_Limiter_Built-in Effect: Limiter',
		parameters: [
			['thresholdDb', '-4'], ['makeupTargetDb', '-1'], ['kneeWidthDb', '2'],
			['lookaheadMs', '3'], ['releaseMs', '150'],
		] satisfies readonly NativeParameter[],
		params: { thresholdDb: -4, makeupTargetDb: -1, kneeWidthDb: 2, lookaheadMs: 3, releaseMs: 150 },
	},
];

for (const fixture of NATIVE_DYNAMICS) {
	test(`AUP4 imports native ${fixture.type} with Audacity display state and keeps it through edits`, () => {
		const effectNode = nativeEffect(fixture.id, [...fixture.parameters, ...DISPLAY_PARAMETERS]);
		const encoded = encodeAudacityBinaryXml(nativeRack(effectNode));
		const rack = decodeAudacityBinaryXml(encoded.dictionary, encoded.document).root;
		let missingCount = 0;
		const [effect] = readAup4EffectsNode(rack, {
			idFactory: () => 'native-dynamics',
			onMissingEffect: () => { missingCount += 1; },
		});

		assert.ok(effect);
		assert.equal(effect.type, fixture.type);
		assert.equal(effect.enabled, true);
		assert.equal(effect.bypassed, undefined);
		assert.equal(missingCount, 0);
		assert.deepEqual(effect.params, fixture.params);
		assert.deepEqual(effect.opaqueAudacityNode.node, effectNode);

		const rewritten = createAup4EffectsNode([{
			...effect,
			enabled: false,
			params: { ...effect.params, thresholdDb: -12 },
		}], rack);
		const [rewrittenEffect] = audacityXmlChildren(rewritten, 'effect');
		assert.equal(audacityXmlAttribute(rewrittenEffect, 'id'), fixture.id);
		assert.equal(audacityXmlAttribute(rewrittenEffect, 'active'), false);
		const parameters = nativeParameters(rewrittenEffect);
		assert.equal(parameters.get('thresholdDb'), '-12');
		for (const [name, value] of DISPLAY_PARAMETERS) assert.equal(parameters.get(name), value);
		const [reopened] = readAup4EffectsNode(rewritten, { idFactory: () => 'reopened-dynamics' });
		assert.equal(reopened.type, fixture.type);
		assert.equal(reopened.enabled, false);
		assert.deepEqual(reopened.params, { ...fixture.params, thresholdDb: -12 });
	});

	test(`AUP4 ${fixture.type} still bypasses genuinely unsupported processing state`, () => {
		const effectNode = nativeEffect(fixture.id, [
			...fixture.parameters, ...DISPLAY_PARAMETERS, ['futureAudioControl', '1'],
		]);
		const [effect] = readAup4EffectsNode(nativeRack(effectNode), { idFactory: () => 'future-dynamics' });
		assert.equal(effect.type, 'missing');
		assert.equal(effect.missing.reason, 'unsupported-state');
		assert.equal(effect.bypassed, true);
		assert.deepEqual(audacityXmlChildren(createAup4EffectsNode([effect]), 'effect'), [effectNode]);
	});
}

function nativeRack(effect: XmlNode): XmlNode {
	return createAudacityXmlNode('effects', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
	], [{ kind: 'node', node: effect }]);
}

function nativeEffect(id: string, parameters: readonly NativeParameter[]): XmlNode {
	return createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'id', type: 'string', value: id },
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
	], [{
		kind: 'node',
		node: createAudacityXmlNode('parameters', [], parameters.map(([name, value]) => ({
			kind: 'node',
			node: createAudacityXmlNode('parameter', [
				{ kind: 'attribute', name: 'name', type: 'string', value: name },
				{ kind: 'attribute', name: 'value', type: 'string', value },
			]),
		}))),
	}]);
}

function nativeParameters(effect: XmlNode): Map<string, string> {
	const [container] = audacityXmlChildren(effect, 'parameters');
	return new Map(audacityXmlChildren(container, 'parameter').map((parameter: XmlNode) => [
		String(audacityXmlAttribute(parameter, 'name')),
		String(audacityXmlAttribute(parameter, 'value')),
	]));
}
