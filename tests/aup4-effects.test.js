import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
} from '../src/common/editor/audacity-binary-xml.js';
import {
	AUP4_REALTIME_EFFECT_PROFILES,
	aup4NativeEffectId,
	createAup4EffectsNode,
	readAup4EffectsNode,
} from '../src/common/editor/aup4-effects.js';
import { createEffect } from '../src/common/editor/effects.js';

test('AUP4 realtime effect IDs use Audacity stable family, vendor, symbol, and path fields', () => {
	assert.equal(Object.keys(AUP4_REALTIME_EFFECT_PROFILES).length, 14);
	assert.equal(
		aup4NativeEffectId('audacity-compressor'),
		'Effect_Audacity_Audacity_Compressor_Built-in Effect: Compressor',
	);
	assert.equal(
		aup4NativeEffectId('audacity-filter-curve-eq'),
		'Effect_Audacity_Audacity_Filter Curve_Built-in Effect: Filter Curve',
	);
	assert.equal(aup4NativeEffectId('browser-only'), null);
});

test('AUP4 realtime racks round-trip native parameter names without translated UI labels', () => {
	const effects = [
		createEffect('audacity-compressor', {
			id: 'compressor-1',
			enabled: false,
			params: {
				thresholdDb: -18,
				makeupGainDb: 2,
				kneeWidthDb: 4,
				ratio: 6,
				lookaheadMs: 5,
				attackMs: 12,
				releaseMs: 240,
			},
		}),
		createEffect('audacity-distortion', {
			id: 'distortion-1',
			params: { mode: 'even-harmonics', dcBlock: true, thresholdDb: -9, noiseFloorDb: -65, parameter1: 25, parameter2: 75, repeats: 2 },
		}),
	];
	const node = createAup4EffectsNode(effects);
	const nativeEffects = audacityXmlChildren(node, 'effect');
	assert.equal(audacityXmlAttribute(nativeEffects[0], 'active'), false);
	const compressorParams = parameterMap(nativeEffects[0]);
	assert.equal(compressorParams.get('thresholdDb'), '-18');
	assert.equal(compressorParams.get('compressionRatio'), '6');
	assert.equal(compressorParams.has('ratio'), false);
	const distortionParams = parameterMap(nativeEffects[1]);
	assert.equal(distortionParams.get('Type'), 'Even Harmonics');
	assert.equal(distortionParams.get('DC Block'), '1');

	let id = 0;
	const decoded = readAup4EffectsNode(node, { idFactory: () => `opened-${++id}` });
	assert.deepEqual(decoded.map((effect) => effect.type), ['audacity-compressor', 'audacity-distortion']);
	assert.equal(decoded[0].enabled, false);
	assert.equal(decoded[0].params.ratio, 6);
	assert.equal(decoded[1].params.mode, 'even-harmonics');
	assert.equal(decoded[1].params.dcBlock, true);
	assert.equal(decoded[0].opaqueAudacityNode.node.name, 'effect');
});

test('AUP4 equalizer curves keep ordered f/v parameter pairs', () => {
	const effect = createEffect('audacity-filter-curve-eq', {
		id: 'curve-1',
		params: {
			filterLength: 4095,
			linearFrequencyScale: true,
			points: [{ frequency: 20, gain: -3 }, { frequency: 1_000, gain: 2.5 }, { frequency: 20_000, gain: 0 }],
		},
	});
	const node = createAup4EffectsNode([effect]);
	const parameters = parameterMap(audacityXmlChildren(node, 'effect')[0]);
	assert.deepEqual([...parameters].slice(-6), [
		['f0', '20'], ['v0', '-3'], ['f1', '1000'], ['v1', '2.5'], ['f2', '20000'], ['v2', '0'],
	]);
	const [decoded] = readAup4EffectsNode(node, { idFactory: () => 'curve-opened' });
	assert.deepEqual(decoded.params.points, effect.params.points);
});

test('unknown native effects and known effects with future state become ordered missing placeholders', () => {
	const futureParameter = createAudacityXmlNode('parameter', [
		{ kind: 'attribute', name: 'name', type: 'string', value: 'future-control' },
		{ kind: 'attribute', name: 'value', type: 'string', value: 'opaque-value' },
	]);
	const compressorNode = createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'future-before', type: 'long', value: 9 },
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
		{ kind: 'attribute', name: 'id', type: 'string', value: aup4NativeEffectId('audacity-compressor') },
	], [{ kind: 'node', node: createAudacityXmlNode('parameters', [], [
		parameter('thresholdDb', '-10'),
		{ kind: 'node', node: futureParameter },
	]) }]);
	const futureEffect = createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: false },
		{ kind: 'attribute', name: 'id', type: 'string', value: 'Effect_VST3_Future_vendor_Path' },
	], [{ kind: 'blob', name: 'state', value: Uint8Array.of(1, 2, 3) }]);
	const opaqueRack = createAudacityXmlNode('effects', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: false },
	], [{ kind: 'node', node: compressorNode }, { kind: 'node', node: futureEffect }]);
	let nextId = 0;
	const decoded = readAup4EffectsNode(opaqueRack, { idFactory: () => `opened-${++nextId}` });
	assert.deepEqual(decoded.map((effect) => ({
		type: effect.type,
		name: effect.missing.name,
		reason: effect.missing.reason,
		enabled: effect.enabled,
		bypassed: effect.bypassed,
	})), [
		{ type: 'missing', name: 'Compressor', reason: 'unsupported-state', enabled: true, bypassed: true },
		{ type: 'missing', name: 'vendor', reason: 'plugin-unavailable', enabled: false, bypassed: true },
	]);
	const rewritten = createAup4EffectsNode([
		{ ...decoded[1], enabled: true },
		{ ...decoded[0], enabled: false },
	], opaqueRack);
	assert.equal(audacityXmlAttribute(rewritten, 'active'), false);
	const rewrittenEffects = audacityXmlChildren(rewritten, 'effect');
	assert.equal(rewrittenEffects.length, 2);
	assert.equal(audacityXmlAttribute(rewrittenEffects[0], 'id'), 'Effect_VST3_Future_vendor_Path');
	assert.equal(audacityXmlAttribute(rewrittenEffects[0], 'active'), true);
	assert.deepEqual(rewrittenEffects[0].content.at(-1), futureEffect.content.at(-1));
	assert.equal(audacityXmlAttribute(rewrittenEffects[1], 'future-before'), 9);
	assert.equal(audacityXmlAttribute(rewrittenEffects[1], 'active'), false);
	assert.equal(parameterMap(rewrittenEffects[1]).get('thresholdDb'), '-10');
	assert.equal(parameterMap(rewrittenEffects[1]).get('future-control'), 'opaque-value');
});

test('supplemental browser effects survive AUP4 and native missing-effect rewrites through a bounded opaque ID', () => {
	const local = createEffect('highpass', {
		id: 'local-highpass',
		enabled: false,
		params: { frequency: 125, q: 0.9 },
		context: { routing: 'track' },
	});
	const rack = createAup4EffectsNode([local]);
	const nativeNode = audacityXmlChildren(rack, 'effect')[0];
	const nativeId = audacityXmlAttribute(nativeNode, 'id');
	assert.match(nativeId, /^Effect_kw\.media_kw\.media_High-pass filter_kw\.media Browser Effect: /);
	assert.equal(nativeId.split('_').length, 5);
	// RealtimeEffectState keeps active + id for an unavailable effect but drops
	// its parameters. The extension deliberately needs no parameter children.
	const nativeRewrite = createAudacityXmlNode('effects', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
	], [{ kind: 'node', node: createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: false },
		{ kind: 'attribute', name: 'id', type: 'string', value: nativeId },
	]) }]);
	const [decoded] = readAup4EffectsNode(nativeRewrite, { idFactory: () => 'unused' });
	assert.equal(decoded.id, local.id);
	assert.equal(decoded.type, local.type);
	assert.equal(decoded.enabled, false);
	assert.deepEqual(decoded.params, local.params);
	assert.deepEqual(decoded.context, local.context);

	const updatedRack = createAup4EffectsNode([{
		...decoded,
		enabled: true,
		params: { ...decoded.params, frequency: 250 },
		context: { routing: 'master' },
	}], nativeRewrite);
	const updatedNode = audacityXmlChildren(updatedRack, 'effect')[0];
	assert.notEqual(audacityXmlAttribute(updatedNode, 'id'), nativeId);
	const [updated] = readAup4EffectsNode(updatedRack, { idFactory: () => 'unused-again' });
	assert.equal(updated.id, local.id);
	assert.equal(updated.enabled, true);
	assert.equal(updated.params.frequency, 250);
	assert.deepEqual(updated.context, { routing: 'master' });
});

test('future Soundscaper effects export as named missing plug-ins without blocking save', () => {
	const rack = createAup4EffectsNode([{
		id: 'future-local-effect',
		type: 'spectral-cloud-v2',
		enabled: true,
		params: { density: 0.75 },
		state: { revision: 2 },
	}]);
	const nativeId = audacityXmlAttribute(audacityXmlChildren(rack, 'effect')[0], 'id');
	assert.match(nativeId, /^Effect_kw\.media_kw\.media_spectral-cloud-v2_kw\.media Browser Effect: /);
	const [decoded] = readAup4EffectsNode(rack, { idFactory: () => 'unused' });
	assert.equal(decoded.id, 'future-local-effect');
	assert.equal(decoded.type, 'missing');
	assert.equal(decoded.missing.name, 'spectral-cloud-v2');
	assert.equal(decoded.missing.reason, 'unsupported-browser-effect');
});

test('mapped effects with local context, state, or future parameters use the browser extension intact', () => {
	const noiseReduction = createEffect('audacity-noise-reduction', {
		id: 'noise-profile',
		context: { noiseProfile: { bins: [0.1, 0.2] } },
	});
	const autoDuck = createEffect('audacity-auto-duck', {
		id: 'auto-duck-context',
		context: { controlTrackId: 'control-track' },
	});
	const echo = createEffect('audacity-echo', {
		id: 'future-echo',
		state: { revision: 7 },
	});
	echo.params.futureControl = 0.25;
	const rack = createAup4EffectsNode([noiseReduction, autoDuck, echo]);
	for (const native of audacityXmlChildren(rack, 'effect')) {
		assert.match(audacityXmlAttribute(native, 'id'), /^Effect_kw\.media_kw\.media_/);
	}
	const decoded = readAup4EffectsNode(rack, { idFactory: () => 'unused' });
	assert.deepEqual(decoded.map((effect) => effect.type), [
		'audacity-noise-reduction',
		'audacity-auto-duck',
		'audacity-echo',
	]);
	assert.deepEqual(decoded[0].context, noiseReduction.context);
	assert.deepEqual(decoded[1].context, autoDuck.context);
	assert.deepEqual(decoded[2].state, echo.state);
	assert.equal(decoded[2].params.futureControl, 0.25);
});

test('legacy fixed-name browser extension IDs remain readable', () => {
	const payload = Buffer.from(JSON.stringify({
		schemaVersion: 1,
		id: 'legacy-local-effect',
		type: 'highpass',
		params: { frequency: 80, q: 0.707 },
	})).toString('base64');
	const rack = createAudacityXmlNode('effects', [], [{ kind: 'node', node: createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
		{
			kind: 'attribute',
			name: 'id',
			type: 'string',
			value: `Effect_kw.media_kw.media_Browser Rack_kw.media Browser Effect: ${payload}`,
		},
	]) }]);
	const [decoded] = readAup4EffectsNode(rack);
	assert.equal(decoded.id, 'legacy-local-effect');
	assert.equal(decoded.type, 'highpass');
	assert.deepEqual(decoded.params, { frequency: 80, q: 0.707 });
});

test('Audacity symbolic enum identifiers round-trip and legacy browser indexes remain readable', () => {
	const effect = createEffect('audacity-classic-filters', {
		id: 'classic-filter',
		params: { family: 'chebyshev-ii', direction: 'highpass', order: 4, cutoffHz: 2_000 },
	});
	const rack = createAup4EffectsNode([effect]);
	const params = parameterMap(audacityXmlChildren(rack, 'effect')[0]);
	assert.equal(params.get('FilterType'), 'Chebyshev Type II');
	assert.equal(params.get('FilterSubtype'), 'Highpass');
	assert.deepEqual(readAup4EffectsNode(rack, { idFactory: () => 'opened' })[0].params, effect.params);

	const legacy = createAudacityXmlNode('effects', [], [{ kind: 'node', node: createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
		{ kind: 'attribute', name: 'id', type: 'string', value: aup4NativeEffectId('audacity-distortion') },
	], [{ kind: 'node', node: createAudacityXmlNode('parameters', [], [parameter('Type', '6')]) }]) }]);
	assert.equal(readAup4EffectsNode(legacy, { idFactory: () => 'legacy-opened' })[0].params.mode, 'even-harmonics');
});

test('removing modeled effects does not resurrect their opaque source nodes', () => {
	const known = createAup4EffectsNode([createEffect('audacity-compressor', { id: 'compressor' })]);
	const knownNode = audacityXmlChildren(known, 'effect')[0];
	const futureNode = createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
		{ kind: 'attribute', name: 'id', type: 'string', value: 'Effect_Future_Vendor_Name_Path' },
	]);
	const opaqueRack = createAudacityXmlNode('effects', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: false },
	], [{ kind: 'node', node: knownNode }, { kind: 'node', node: futureNode }]);
	let id = 0;
	const decoded = readAup4EffectsNode(opaqueRack, { idFactory: () => `opened-${++id}` });
	assert.deepEqual(decoded.map((effect) => effect.type), ['audacity-compressor', 'missing']);
	const rewritten = createAup4EffectsNode([], opaqueRack);
	assert.equal(audacityXmlAttribute(rewritten, 'active'), false);
	assert.deepEqual(audacityXmlChildren(rewritten, 'effect'), []);
});

test('unknown plug-in names, rack-wide activation, and opaque state round-trip safely', () => {
	const native = createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'vendor-state', type: 'long', value: 42 },
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
		{
			kind: 'attribute',
			name: 'id',
			type: 'string',
			value: 'Effect_VST3_Acme_Super\\_Verb_/plugins/super_verb.vst3',
		},
	], [{ kind: 'blob', name: 'state', value: Uint8Array.of(4, 5, 6) }]);
	const rack = createAudacityXmlNode('effects', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: false },
	], [{ kind: 'node', node: native }]);
	let rackActive = true;
	const [decoded] = readAup4EffectsNode(rack, {
		idFactory: () => 'missing-superverb',
		onRackActive: (active) => { rackActive = active; },
	});
	assert.equal(rackActive, false);
	assert.deepEqual(decoded.missing, {
		name: 'Super_Verb',
		nativeId: 'Effect_VST3_Acme_Super\\_Verb_/plugins/super_verb.vst3',
		reason: 'plugin-unavailable',
		source: 'aup4',
	});
	assert.deepEqual(decoded.params, {});
	assert.equal(decoded.bypassed, true);

	const rewritten = createAup4EffectsNode([{ ...decoded, enabled: false }], rack, { effectsActive: true });
	assert.equal(audacityXmlAttribute(rewritten, 'active'), true);
	const [rewrittenNative] = audacityXmlChildren(rewritten, 'effect');
	assert.equal(audacityXmlAttribute(rewrittenNative, 'active'), false);
	assert.equal(audacityXmlAttribute(rewrittenNative, 'vendor-state'), 42);
	assert.equal(audacityXmlAttribute(rewrittenNative, 'id'), decoded.missing.nativeId);
	assert.deepEqual(rewrittenNative.content.at(-1), native.content.at(-1));
});

test('future browser effect types become named missing placeholders instead of disappearing', () => {
	const payload = Buffer.from(JSON.stringify({
		schemaVersion: 1,
		id: 'future-browser-effect',
		type: 'spectral-cloud-v2',
		name: 'Spectral Cloud',
		params: { density: 0.75 },
		state: { revision: 2 },
	})).toString('base64');
	const nativeId = `Effect_kw.media_kw.media_Spectral Cloud_kw.media Browser Effect: ${payload}`;
	const rack = createAudacityXmlNode('effects', [], [{ kind: 'node', node: createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
		{ kind: 'attribute', name: 'id', type: 'string', value: nativeId },
	]) }]);
	const [decoded] = readAup4EffectsNode(rack, { idFactory: () => 'unused' });
	assert.equal(decoded.id, 'future-browser-effect');
	assert.equal(decoded.type, 'missing');
	assert.equal(decoded.missing.name, 'Spectral Cloud');
	assert.equal(decoded.missing.reason, 'unsupported-browser-effect');
	assert.equal(decoded.bypassed, true);
	assert.deepEqual(
		audacityXmlChildren(createAup4EffectsNode([decoded]), 'effect'),
		audacityXmlChildren(rack, 'effect'),
	);
});

test('malformed native and browser extension state remains opaque and non-executable', () => {
	const malformedNative = createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'active', type: 'string', value: 'false' },
		{ kind: 'attribute', name: 'id', type: 'string', value: aup4NativeEffectId('audacity-compressor') },
	], [{ kind: 'node', node: createAudacityXmlNode('parameters', [], [parameter('thresholdDb', '')]) }]);
	const malformedPayload = Buffer.from(JSON.stringify({
		schemaVersion: 1,
		id: 42,
		type: 'highpass',
		params: { frequency: 80, q: 0.707 },
	})).toString('base64');
	const malformedBrowser = createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
		{ kind: 'attribute', name: 'id', type: 'string', value: `Effect_kw.media_kw.media_Browser Rack_kw.media Browser Effect: ${malformedPayload}` },
	]);
	const duplicateParameter = createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
		{ kind: 'attribute', name: 'id', type: 'string', value: aup4NativeEffectId('audacity-echo') },
	], [{ kind: 'node', node: createAudacityXmlNode('parameters', [], [
		parameter('Delay', '1'),
		parameter('Delay', '2'),
	]) }]);
	const rack = createAudacityXmlNode('effects', [], [
		{ kind: 'node', node: malformedNative },
		{ kind: 'node', node: malformedBrowser },
		{ kind: 'node', node: duplicateParameter },
	]);
	const opaqueRecords = [];
	assert.deepEqual(readAup4EffectsNode(rack, {
		idFactory: () => 'unused',
		onOpaqueEffect(node, index, reason) {
			opaqueRecords.push({ node, index, reason });
		},
	}), []);
	assert.deepEqual(opaqueRecords, [
		{ node: malformedNative, index: 0, reason: 'malformed-or-over-limit-state' },
		{ node: malformedBrowser, index: 1, reason: 'malformed-or-over-limit-state' },
		{ node: duplicateParameter, index: 2, reason: 'malformed-or-over-limit-state' },
	]);
	assert.deepEqual(
		audacityXmlChildren(createAup4EffectsNode([], rack), 'effect'),
		[malformedNative, malformedBrowser, duplicateParameter],
	);
});

test('browser extension encoding rejects deeply nested metadata before recursive normalization', () => {
	let context = {};
	for (let index = 0; index < 40; index += 1) context = { child: context };
	assert.throws(() => createAup4EffectsNode([{
		id: 'deep-effect',
		type: 'highpass',
		enabled: true,
		params: { frequency: 80, q: 0.707 },
		context,
	}]), /complexity limit/);
});

test('legacy id-less browser rack effects receive deterministic per-rack stable IDs', () => {
	const legacy = {
		type: 'highpass',
		enabled: true,
		params: { frequency: 80, q: 0.707 },
	};
	const first = createAup4EffectsNode([legacy, legacy]);
	const second = createAup4EffectsNode([legacy, legacy]);
	const firstIds = readAup4EffectsNode(first).map((effect) => effect.id);
	const secondIds = readAup4EffectsNode(second).map((effect) => effect.id);
	assert.deepEqual(firstIds, secondIds);
	assert.equal(new Set(firstIds).size, 2);
	assert.match(firstIds[0], /^legacy-highpass-0-[0-9a-f]{8}$/);
});

test('legacy opaque-only rack items stay non-executable and byte-structurally intact', () => {
	const native = createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: false },
		{ kind: 'attribute', name: 'id', type: 'string', value: 'Effect_VST3_Missing_Name_Path' },
	], [{ kind: 'blob', name: 'state', value: Uint8Array.of(7, 8, 9) }]);
	const rack = createAudacityXmlNode('effects', [], [{ kind: 'node', node: native }]);
	const rewritten = createAup4EffectsNode([{ opaqueAudacityNode: { kind: 'node', node: native } }], rack);
	assert.deepEqual(audacityXmlChildren(rewritten, 'effect'), [native]);
});

function parameterMap(effectNode) {
	return new Map(audacityXmlChildren(audacityXmlChildren(effectNode, 'parameters')[0], 'parameter')
		.map((node) => [audacityXmlAttribute(node, 'name'), audacityXmlAttribute(node, 'value')]));
}

function parameter(name, value) {
	return { kind: 'node', node: createAudacityXmlNode('parameter', [
		{ kind: 'attribute', name: 'name', type: 'string', value: name },
		{ kind: 'attribute', name: 'value', type: 'string', value },
	]) };
}
