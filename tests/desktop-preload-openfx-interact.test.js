/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';

test('OpenFX Interact crosses preload as exact normalized actions and copied 64 by 64 pixels', async () => {
	const sha = 'cd'.repeat(32);
	const effect = {
		schemaVersion: 1, instanceId: 'effect-1', pluginId: 'net.example.Filter',
		binarySha256: 'ab'.repeat(32), context: 'filter',
		attachment: { kind: 'filter', targetId: 'clip-1' },
		inputs: [{ name: 'Source', sourceRef: 'source-1' }],
		parameters: [{ name: 'parameter15', type: 'custom', value: 'before', keyframes: [] }],
		customEncodings: { parameter15: 'vendor-v1' }, enabled: true,
		freshness: {
			authoredStateSha256: sha, inputIdentitiesSha256: sha,
			renderPlanFingerprintSha256: sha, nativeEffectFingerprintSha256: sha,
		},
		frozenFallback: null,
	};
	const request = {
		protocolVersion: 1, project: { id: 'project-1', revision: 7 },
		pluginHandle: '8b'.repeat(20), effect, effectStateSha256: sha, context: 'filter',
		target: 'custom-parameter', parameterName: 'parameter15',
		events: [
			{ kind: 'focus', sequence: 0, focused: true },
			{ kind: 'pointer', phase: 'motion', sequence: 1, x: 0.25, y: 0.75,
				button: 0, modifiers: ['control', 'shift'] },
			{ kind: 'pointer', phase: 'down', sequence: 2, x: 0.25, y: 0.75,
				button: 0, modifiers: [] },
			{ kind: 'pointer', phase: 'up', sequence: 3, x: 0.25, y: 0.75,
				button: 0, modifiers: [] },
			{ kind: 'keyboard', phase: 'down', sequence: 4, key: 'Enter', code: 'Enter',
				modifiers: [] },
		],
	};
	const rgba = new Uint8Array(64 * 64 * 4).fill(17);
	const fixture = await loadPreload({
		protocolVersion: 1, project: request.project, instanceId: effect.instanceId,
		effectStateSha256: request.effectStateSha256, width: 64, height: 64, rowBytes: 256,
		target: request.target, parameterName: request.parameterName,
		acceptedSequences: [0, 1, 2, 3, 4], redrawRequested: true,
		surfaceDisposition: 'drawn', parameterMutations: [{ parameter: {
			name: 'parameter15', type: 'custom', value: 'after', keyframes: [],
		} }], rgba,
	});
	const result = await fixture.bridge.nativeServices.runOpenFxInteract(request);
	assert.equal(result.rgba.byteLength, 16_384);
	assert.notEqual(result.rgba, rgba);
	assert.notEqual(result.parameterMutations[0].parameter, effect.parameters[0]);
	assert.equal(result.parameterMutations[0].parameter.value, 'after');
	assert.deepEqual([...result.acceptedSequences], [0, 1, 2, 3, 4]);
	assert.deepEqual(fixture.invocations.map(([channel, value]) => [channel, value.target]), [
		['framescaper:v1:native-services:openfx:interact', 'custom-parameter'],
	]);
	assert.throws(() => fixture.bridge.nativeServices.runOpenFxInteract({
		...request, path: '/private/plugin.ofx',
	}), /fields|Interact request/iu);
	const hostile = await loadPreload({
		protocolVersion: 1, project: { ...request.project, revision: 8 },
		instanceId: effect.instanceId, effectStateSha256: request.effectStateSha256,
		width: 64, height: 64, rowBytes: 256,
		target: request.target, parameterName: request.parameterName,
		acceptedSequences: [0], redrawRequested: false, surfaceDisposition: 'drawn',
		parameterMutations: [], rgba,
		path: '/private/pixels.rgba',
	});
	await assert.rejects(
		() => hostile.bridge.nativeServices.runOpenFxInteract({ ...request, events: [request.events[0]] }),
		/fields|Interact result/iu,
	);
	const stale = await loadPreload({
		protocolVersion: 1, project: { ...request.project, revision: 8 },
		instanceId: effect.instanceId, effectStateSha256: request.effectStateSha256,
		width: 64, height: 64, rowBytes: 256, target: request.target,
		parameterName: request.parameterName, acceptedSequences: [], redrawRequested: false,
		surfaceDisposition: 'drawn', parameterMutations: [], rgba,
	});
	await assert.rejects(
		() => stale.bridge.nativeServices.runOpenFxInteract({ ...request, events: [] }),
		/authority/iu,
	);
	const retained = await loadPreload({
		protocolVersion: 1, project: request.project, instanceId: effect.instanceId,
		effectStateSha256: request.effectStateSha256, width: 64, height: 64, rowBytes: 256,
		target: request.target, parameterName: request.parameterName, acceptedSequences: [],
		redrawRequested: false, surfaceDisposition: 'retained', parameterMutations: [],
		rgba: new Uint8Array(64 * 64 * 4),
	});
	const noOp = await retained.bridge.nativeServices.runOpenFxInteract({ ...request, events: [] });
	assert.equal(noOp.surfaceDisposition, 'retained');
	assert.equal(noOp.rgba.some((byte) => byte !== 0), false);
});

async function loadPreload(result) {
	let bridge;
	const invocations = [];
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AggregateError, Array, ArrayBuffer, JSON, Number, Object, Promise, RangeError, String,
		TypeError, Uint8Array, URL, Blob, MessageChannel, setTimeout, clearTimeout,
		crypto: webcrypto, structuredClone,
		require: () => ({
			contextBridge: { exposeInMainWorld(name, value) {
				if (name === 'framescaperDesktop') bridge = value.v1;
			} },
			ipcRenderer: {
				invoke(channel, value) { invocations.push([channel, value]); return Promise.resolve(result); },
				postMessage: () => undefined, send: () => undefined,
				on: () => undefined, removeListener: () => undefined,
			},
		}),
	});
	return { bridge, invocations };
}
