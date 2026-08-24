/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { engineRenderingMethods } from '../src/common/editor/engine/rendering.ts';
import {
	acceptNativePluginPortOffer,
	closeNativePluginRuntimeVendorUi,
	createNativePluginEffectNode,
	openNativePluginRuntimeVendorUi,
	prepareNativePluginOfflineRuntimes,
	registerNativePluginOfflineRuntimeProvider,
	registerNativePluginRuntimeIdentity,
	releaseNativePluginRuntime,
} from '../src/common/editor/native-plugin-realtime-node.js';

const PROJECT = Object.freeze({
	sampleRate: 48_000,
	masterChannels: 2,
	tracks: [{ id: 'track-1', type: 'audio', effects: [{
		id: 'effect-1', type: 'native-plugin', enabled: true, bypassed: false,
		params: { instanceId: 'authored-1', latencyFrames: 512 },
	}] }],
	master: { effects: [] },
	mixer: { groups: [], sends: [] },
	nativePluginStates: [{
		instanceId: 'authored-1', format: 'clap', stablePluginId: 'org.example.effect',
		binarySha256: 'a'.repeat(64), enabled: true, bypassed: false, continuity: 'live',
		stateBody: { kind: 'native-plugin-state', bodyId: 'b'.repeat(64), byteLength: 3, sha256: 'c'.repeat(64) },
	}],
});

test('offline graph aliases a fresh helper, restores its state, and releases only that runtime', async (context) => {
	const original = globalThis.AudioWorkletNode;
	const messages: unknown[] = [];
	class FakeNode {
		readonly port = {
			onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
			start() {},
			postMessage: (message: Record<string, unknown>) => {
				messages.push(message);
				if (message.type === 'native-plugin-attach') queueMicrotask(() => this.port.onmessage?.({
					data: { type: 'native-plugin-attached', generation: 1 },
				}));
				if (message.type === 'native-plugin-load-state') queueMicrotask(() => this.port.onmessage?.({
					data: { type: 'native-plugin-state-loaded', requestId: message.requestId },
				}));
			},
		};
		disconnect() { messages.push('disconnect'); }
	}
	globalThis.AudioWorkletNode = FakeNode as unknown as typeof AudioWorkletNode;
	context.after(() => { globalThis.AudioWorkletNode = original; });
	let disposed = 0;
	const unregister = registerNativePluginOfflineRuntimeProvider(async () => {
		registerNativePluginRuntimeIdentity('offline-1', 'clap');
		return Object.freeze({
			runtimeInstanceId: 'offline-1', stateBytes: new Uint8Array([1, 2, 3]),
			dispose: async () => { disposed += 1; },
		});
	});
	context.after(unregister);
	const audioContext = { sampleRate: 48_000 } as BaseAudioContext;
	const runtimes = await prepareNativePluginOfflineRuntimes(audioContext, PROJECT, {
		trackId: 'track-1', includeMaster: false,
	});
	assert.equal(acceptNativePluginPortOffer({
		instanceId: 'offline-1', purpose: 'plugin-rpc', transport: 'message-port',
		portContractVersion: 1, generation: 1, reportedLatencyFrames: 0,
	}, [{ postMessage() {}, close() {} }]), true);
	createNativePluginEffectNode(audioContext, PROJECT.tracks[0].effects[0], 2);
	await runtimes.activate();
	assert.equal(messages.some((value) => (value as { type?: string }).type === 'native-plugin-load-state'), true);
	await runtimes.dispose();
	assert.equal(disposed, 1);
	assert.equal(messages.includes('disconnect'), true);
});

test('ordinary renderMix sends an active native rack through bounded realtime PCM capture', async (context) => {
	const unregister = registerNativePluginOfflineRuntimeProvider(async () => {
		throw new Error('The delegated test render owns its lower runtime seam.');
	});
	context.after(unregister);
	const calls: unknown[] = [];
	const host = {
		project: PROJECT,
		durationFrames: 4,
		sampleRate: 48_000,
		async renderMixRealtime(options: Readonly<Record<string, unknown>>) {
			calls.push(options);
			const write = options.onChunk as (channels: readonly Float32Array[], metadata: Record<string, unknown>) => void;
			write([new Float32Array([1, 2]), new Float32Array([3, 4])], { frameOffset: 0, sampleRate: 48_000 });
			write([new Float32Array([5, 6]), new Float32Array([7, 8])], { frameOffset: 2, sampleRate: 48_000 });
			return { sampleRate: 48_000, channelCount: 2, frameCount: 4, chunkCount: 2 };
		},
	};
	const rendered = await engineRenderingMethods.renderMix.call(host as never, {
		trackId: 'track-1', includeMaster: false, outputFrames: 4,
	});
	assert.ok('channels' in rendered);
	assert.deepEqual(Array.from(rendered.channels[0]), [1, 2, 5, 6]);
	assert.deepEqual(Array.from(rendered.channels[1]), [3, 4, 7, 8]);
	assert.equal(calls.length, 1);
});

test('the renderer routes opaque vendor-window controls over the bound helper port', async (context) => {
	const original = globalThis.AudioWorkletNode;
	const helperMessages: Record<string, unknown>[] = [];
	const helperPort = {
		onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
		postMessage(message: Record<string, unknown>) {
			helperMessages.push(message);
			queueMicrotask(() => this.onmessage?.({ data: {
				protocolVersion: 1, kind: 'vendor-ui', requestId: message.requestId,
				status: message.kind === 'open-vendor-ui' ? 'opened' : 'closed',
			} }));
		},
		start() {}, close() {},
	};
	class FakeNode {
		readonly port = {
			onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
			start() {},
			postMessage: (message: Record<string, unknown>, ports: unknown[] = []) => {
				if (message.type === 'native-plugin-attach') {
					const port = ports[0] as typeof helperPort;
					port.onmessage = (event) => this.port.onmessage?.({ data: {
						type: 'native-plugin-vendor-ui', ...event.data,
					} });
					queueMicrotask(() => this.port.onmessage?.({ data: {
						type: 'native-plugin-attached', generation: 1,
					} }));
				} else if (String(message.type).includes('vendor-ui')) {
					helperPort.postMessage({
						protocolVersion: 1,
						kind: message.type === 'native-plugin-open-vendor-ui' ? 'open-vendor-ui' : 'close-vendor-ui',
						requestId: message.requestId,
						windowHandleId: message.windowHandleId,
					});
				}
			},
		};
		disconnect() {}
	}
	globalThis.AudioWorkletNode = FakeNode as unknown as typeof AudioWorkletNode;
	context.after(() => { globalThis.AudioWorkletNode = original; releaseNativePluginRuntime('vendor-1'); });
	registerNativePluginRuntimeIdentity('vendor-1', 'clap');
	assert.equal(acceptNativePluginPortOffer({
		instanceId: 'vendor-1', purpose: 'plugin-rpc', transport: 'message-port',
		portContractVersion: 1, generation: 1, reportedLatencyFrames: 0,
	}, [helperPort]), true);
	createNativePluginEffectNode({ sampleRate: 48_000 } as BaseAudioContext, {
		type: 'native-plugin', bypassed: false, params: { instanceId: 'vendor-1' },
	}, 2);
	assert.equal(await openNativePluginRuntimeVendorUi('vendor-1', 'window_1'), 'opened');
	assert.equal(await closeNativePluginRuntimeVendorUi('vendor-1', 'window_1'), 'closed');
	assert.deepEqual(helperMessages.map(({ kind, windowHandleId }) => [kind, windowHandleId]), [
		['open-vendor-ui', 'window_1'], ['close-vendor-ui', 'window_1'],
	]);
});
