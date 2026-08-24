/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	OFX_INTERACT_SURFACE_BYTES_V1,
	applyFramescaperOpenFxInteractMutationsV1,
	framescaperOpenFxInteractEffectStateSha256V1,
	framescaperOpenFxInteractRequestV1,
	framescaperOpenFxInteractResultV1,
} from '../src/common/editor/native-ofx-interact-contract.ts';

const HANDLE = 'ab'.repeat(20);

test('the Interact wire is pathless, sequenced, normalized, and covers pointer keyboard and focus', () => {
	const request = framescaperOpenFxInteractRequestV1({
		protocolVersion: 1, project: { id: 'project-v28', revision: 4 },
		pluginHandle: HANDLE, effect: effect(),
		effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(effect()), context: 'filter',
		target: 'overlay', parameterName: null,
		events: [
			{ kind: 'focus', sequence: 1, focused: true },
			{ kind: 'pointer', phase: 'motion', sequence: 2, x: 0.25, y: 0.75,
				button: 0, modifiers: [] },
			{ kind: 'pointer', phase: 'down', sequence: 3, x: 0.25, y: 0.75,
				button: 1, modifiers: ['shift'] },
			{ kind: 'pointer', phase: 'up', sequence: 4, x: 0.5, y: 0.5,
				button: 1, modifiers: [] },
			{ kind: 'keyboard', phase: 'down', sequence: 5, key: 'Enter', code: 'Enter',
				modifiers: [] },
			{ kind: 'keyboard', phase: 'up', sequence: 6, key: 'Enter', code: 'Enter',
				modifiers: [] },
			{ kind: 'focus', sequence: 7, focused: false },
		],
	});
	assert.equal(JSON.stringify(request).includes('/'), false);
	assert.deepEqual(request.events.map(({ sequence }) => sequence), [1, 2, 3, 4, 5, 6, 7]);
	assert.throws(() => framescaperOpenFxInteractRequestV1({
		...request, events: [request.events[1], request.events[0]],
	}), /strictly increasing/iu);
	assert.throws(() => framescaperOpenFxInteractRequestV1({
		...request, pluginPath: '/tmp/vendor.ofx',
	}), /exactly/iu);
});

test('custom parameter identity and the 64 by 64 DrawSuite result are exact', () => {
	const request = framescaperOpenFxInteractRequestV1({
		protocolVersion: 1, project: { id: 'project-v28', revision: 4 },
		pluginHandle: HANDLE, effect: effect('general'),
		effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(effect('general')), context: 'general',
		target: 'custom-parameter', parameterName: 'parameter15', events: [],
	});
	assert.equal(request.parameterName, 'parameter15');
	assert.throws(() => framescaperOpenFxInteractRequestV1({
		...request, parameterName: '../vendor',
	}), /authored custom parameter/iu);
	const rgba = new Uint8Array(OFX_INTERACT_SURFACE_BYTES_V1);
	rgba[3] = 255;
	const result = framescaperOpenFxInteractResultV1({
		protocolVersion: 1, project: request.project, instanceId: request.effect.instanceId,
		effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(request.effect),
		width: 64, height: 64, rowBytes: 256,
		target: 'custom-parameter', parameterName: 'parameter15',
		acceptedSequences: [], redrawRequested: true, surfaceDisposition: 'drawn',
		parameterMutations: [{ parameter: {
			name: 'amount', type: 'double', value: [0.75], keyframes: [],
		} }], rgba,
	}, request);
	assert.notEqual(result.rgba, rgba);
	assert.equal(result.rgba.byteLength, 64 * 64 * 4);
	assert.throws(() => framescaperOpenFxInteractResultV1({ ...result, width: 63 }), /64 by 64/iu);
	assert.deepEqual(applyFramescaperOpenFxInteractMutationsV1(
		request.effect, result.parameterMutations,
	).parameters.find(({ name }) => name === 'amount')?.value, [0.75]);
	assert.throws(() => framescaperOpenFxInteractResultV1({
		...result, project: { ...result.project, revision: 5 },
	}, request), /exact authored request/iu);
});

test('ReplyDefault/no-draw retains a transparent surface and cannot mutate another instance', () => {
	const request = framescaperOpenFxInteractRequestV1({
		protocolVersion: 1, project: { id: 'project-v28', revision: 4 },
		pluginHandle: HANDLE, effect: effect(),
		effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(effect()), context: 'filter',
		target: 'overlay', parameterName: null, events: [],
	});
	const result = framescaperOpenFxInteractResultV1({
		protocolVersion: 1, project: request.project, instanceId: request.effect.instanceId,
		effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(request.effect),
		width: 64, height: 64, rowBytes: 256, target: 'overlay', parameterName: null,
		acceptedSequences: [], redrawRequested: false, surfaceDisposition: 'retained',
		parameterMutations: [], rgba: new Uint8Array(OFX_INTERACT_SURFACE_BYTES_V1),
	}, request);
	assert.equal(result.surfaceDisposition, 'retained');
	assert.throws(() => framescaperOpenFxInteractResultV1({
		...result, instanceId: 'another-effect',
	}, request), /exact authored request/iu);
});

function effect(context: 'filter' | 'general' = 'filter') {
	const digest = '11'.repeat(32);
	return {
		schemaVersion: 1 as const, instanceId: 'authored-effect', pluginId: 'net.example.Filter',
		binarySha256: '22'.repeat(32), context,
		attachment: { kind: context, targetId: 'video-clip' }, inputs: [],
		parameters: [
			{ name: 'amount', type: 'double' as const, value: [0.5], keyframes: [] },
			{ name: 'parameter15', type: 'custom' as const, value: 'vendor-state', keyframes: [] },
		],
		customEncodings: { parameter15: 'vendor-v1' }, enabled: true,
		freshness: {
			authoredStateSha256: digest, inputIdentitiesSha256: digest,
			renderPlanFingerprintSha256: digest, nativeEffectFingerprintSha256: digest,
		},
		frozenFallback: null,
	};
}
