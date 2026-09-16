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
	createAup4EffectsNode,
	decodeAudacityRealtimeEffectParameters,
	readAup4EffectsNode,
} from '../src/common/editor/aup4-effects.js';

type XmlNode = ReturnType<typeof createAudacityXmlNode>;
type NativeParameter = readonly [name: string, value: string];
interface NativeFixture {
	type: string;
	id: string;
	parameters: readonly NativeParameter[];
	legacyNames: readonly (readonly [native: string, legacy: string])[];
	params: Record<string, number | string | boolean>;
	edit: readonly [model: string, native: string, value: number];
}
// The JavaScript helper accepts a tag name despite inferring its default as null.
const audacityXmlChildren = readXmlChildren as unknown as (node: unknown, name: string) => XmlNode[];
// Its opaque rack argument likewise accepts XML despite the null default.
const createNativeRack = createAup4EffectsNode as unknown as (effects: unknown[], opaqueRack: XmlNode) => XmlNode;

// Independent native fixtures from Audacity 4c177d436e48c1d20f231eada44035593cb26292:
// BassTrebleBase.{cpp,h}, DistortionBase.{cpp,h}, and
// builtin_collection/noisereduction/noisereductioneffect.{cpp,h}.
// CapturedParameters writes every declared field, and CommandParameters replaces
// spaces with underscores before RealtimeEffectState enumerates its XML entries.
const NATIVE_FIXTURES: readonly NativeFixture[] = [
	{
		type: 'audacity-bass-treble',
		id: 'Effect_Audacity_Audacity_Bass and Treble_Built-in Effect: Bass and Treble',
		parameters: [['Bass', '3'], ['Treble', '-2'], ['Gain', '1'], ['Link_Sliders', '1']],
		legacyNames: [['Link_Sliders', 'Link Sliders']],
		params: { bassDb: 3, trebleDb: -2, volumeDb: 1 },
		edit: ['bassDb', 'Bass', 6],
	},
	{
		type: 'audacity-distortion',
		id: 'Effect_Audacity_Audacity_Distortion_Built-in Effect: Distortion',
		parameters: [
			['Type', 'Even Harmonics'], ['DC_Block', '1'], ['Threshold_dB', '-9'],
			['Noise_Floor', '-65'], ['Parameter_1', '25'], ['Parameter_2', '75'], ['Repeats', '2'],
		],
		legacyNames: [
			['DC_Block', 'DC Block'], ['Threshold_dB', 'Threshold dB'], ['Noise_Floor', 'Noise Floor'],
			['Parameter_1', 'Parameter 1'], ['Parameter_2', 'Parameter 2'],
		],
		params: {
			mode: 'even-harmonics', dcBlock: true, thresholdDb: -9, noiseFloorDb: -65,
			parameter1: 25, parameter2: 75, repeats: 2,
		},
		edit: ['parameter1', 'Parameter_1', 35],
	},
	{
		type: 'audacity-noise-reduction',
		id: 'Effect_Audacity_Audacity_Noise reduction_Built-in Effect: Noise reduction',
		parameters: [
			['Sensitivity', '7'], ['Frequency_Smoothing_Bands', '4'],
			['Noise_Gain', '12'], ['Noise_Reduction_Choice', '1'],
		],
		legacyNames: [
			['Frequency_Smoothing_Bands', 'Frequency Smoothing Bands'],
			['Noise_Gain', 'Noise Gain'], ['Noise_Reduction_Choice', 'Noise Reduction Choice'],
		],
		params: { sensitivity: 7, frequencySmoothingBands: 4, reductionDb: 12, output: 'residue' },
		edit: ['reductionDb', 'Noise_Gain', 18],
	},
];

for (const fixture of NATIVE_FIXTURES) {
	test(`AUP4 imports full native ${fixture.type} settings without a missing effect`, () => {
		const effectNode = nativeEffect(fixture.id, fixture.parameters);
		const encoded = encodeAudacityBinaryXml(nativeRack(effectNode));
		const rack = decodeAudacityBinaryXml(encoded.dictionary, encoded.document).root;
		let missingCount = 0;
		const [effect] = readAup4EffectsNode(rack, {
			idFactory: () => 'native-parameters',
			onMissingEffect: () => { missingCount += 1; },
		});
		assert.ok(effect);
		assert.equal(effect.type, fixture.type);
		assert.equal(effect.enabled, true);
		assert.equal(effect.bypassed, undefined);
		assert.equal(missingCount, 0);
		assert.deepEqual(effect.params, fixture.params);
		assert.deepEqual(effect.opaqueAudacityNode.node, effectNode);
	});

	test(`Audacity ${fixture.type} normalized and older spaced parameter names decode equivalently`, () => {
		assert.deepEqual(decodeAudacityRealtimeEffectParameters(fixture.type, fixture.parameters), fixture.params);
		assert.deepEqual(decodeAudacityRealtimeEffectParameters(fixture.type, legacyParameters(fixture)), fixture.params);
		const [effect] = readAup4EffectsNode(nativeRack(nativeEffect(fixture.id, legacyParameters(fixture))), {
			idFactory: () => 'legacy-parameters',
		});
		assert.equal(effect.type, fixture.type);
		assert.deepEqual(effect.params, fixture.params);
	});

	for (const style of ['native', 'legacy'] as const) {
		test(`AUP4 edits ${fixture.type} ${style} settings and rewrites one canonical parameter per name`, () => {
			const original = style === 'native' ? fixture.parameters : legacyParameters(fixture);
			const rack = nativeRack(nativeEffect(fixture.id, original));
			const [effect] = readAup4EffectsNode(rack, { idFactory: () => 'editable-parameters' });
			assert.equal(effect.type, fixture.type);
			const [modelName, nativeName, value] = fixture.edit;
			const rewritten = createNativeRack([{
				...effect,
				enabled: false,
				params: { ...effect.params, [modelName]: value },
			}], rack);
			const [rewrittenEffect] = audacityXmlChildren(rewritten, 'effect');
			const entries = nativeParameters(rewrittenEffect);
			const expected = fixture.parameters.map<NativeParameter>(([name, originalValue]) => [
				name, name === nativeName ? String(value) : originalValue,
			]);
			assert.equal(audacityXmlAttribute(rewrittenEffect, 'id'), fixture.id);
			assert.equal(audacityXmlAttribute(rewrittenEffect, 'active'), false);
			assert.equal(entries.length, fixture.parameters.length);
			assert.deepEqual(new Map(entries), new Map(expected));
			for (const [, legacyName] of fixture.legacyNames) {
				assert.equal(new Map(entries).has(legacyName), false);
			}
			// Link_Sliders=1 is Audacity control behavior with no browser model field.
			if (fixture.type === 'audacity-bass-treble') assert.equal(new Map(entries).get('Link_Sliders'), '1');
			const [reopened] = readAup4EffectsNode(rewritten, { idFactory: () => 'reopened-parameters' });
			assert.equal(reopened.type, fixture.type);
			assert.equal(reopened.enabled, false);
			assert.deepEqual(reopened.params, { ...fixture.params, [modelName]: value });
		});
	}

	test(`AUP4 rejects colliding ${fixture.type} normalized and spaced parameter aliases`, () => {
		const [nativeName, legacyName] = fixture.legacyNames[0];
		const nativeValue = fixture.parameters.find(([name]) => name === nativeName)?.[1];
		assert.ok(nativeValue);
		const rack = nativeRack(nativeEffect(fixture.id, [...fixture.parameters, [legacyName, nativeValue]]));
		let opaqueCount = 0;
		const effects = readAup4EffectsNode(rack, {
			idFactory: () => 'ambiguous-parameters',
			onOpaqueEffect: () => { opaqueCount += 1; },
		});
		assert.deepEqual(effects, []);
		assert.equal(opaqueCount, 1);
	});
}

test('AUP4 emits the pinned Qt Click removal and Noise reduction IDs and reads older capitalized aliases', () => {
	const fixtures = [
		{
			type: 'audacity-click-removal',
			id: 'Effect_Audacity_Audacity_Click removal_Built-in Effect: Click removal',
			olderId: 'Effect_Audacity_Audacity_Click Removal_Built-in Effect: Click Removal',
			parameters: [['Threshold', '150'], ['Width', '30']] satisfies readonly NativeParameter[],
			params: { threshold: 150, maximumWidth: 30 },
		},
		{
			type: 'audacity-noise-reduction',
			id: 'Effect_Audacity_Audacity_Noise reduction_Built-in Effect: Noise reduction',
			olderId: 'Effect_Audacity_Audacity_Noise Reduction_Built-in Effect: Noise Reduction',
			parameters: [['Sensitivity', '7'], ['Frequency_Smoothing_Bands', '4'], ['Noise_Gain', '12'], ['Noise_Reduction_Choice', '1']] satisfies readonly NativeParameter[],
			params: { sensitivity: 7, frequencySmoothingBands: 4, reductionDb: 12, output: 'residue' },
		},
	];
	for (const fixture of fixtures) {
		assert.equal(aup4NativeEffectId(fixture.type), fixture.id);
		for (const id of [fixture.id, fixture.olderId]) {
			const rack = nativeRack(nativeEffect(id, fixture.parameters));
			const [effect] = readAup4EffectsNode(rack, {
				idFactory: () => 'native-symbol',
			});
			assert.equal(effect.type, fixture.type);
			assert.deepEqual(effect.params, fixture.params);
			const [rewritten] = audacityXmlChildren(createNativeRack([effect], rack), 'effect');
			assert.equal(audacityXmlAttribute(rewritten, 'id'), id);
		}
	}
});

function legacyParameters(fixture: NativeFixture): NativeParameter[] {
	const aliases = new Map(fixture.legacyNames);
	return fixture.parameters.map(([name, value]) => [aliases.get(name) ?? name, value]);
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

function nativeParameters(effect: XmlNode): NativeParameter[] {
	const [container] = audacityXmlChildren(effect, 'parameters');
	return audacityXmlChildren(container, 'parameter').map((parameter) => [
		String(audacityXmlAttribute(parameter, 'name')),
		String(audacityXmlAttribute(parameter, 'value')),
	]);
}
