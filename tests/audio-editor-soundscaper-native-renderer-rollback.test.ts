/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { EnginePublicApi } from '../src/common/editor/engine/public-api.ts';
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { prepareNativePluginOfflineRuntimes } from '../src/common/editor/native-plugin-realtime-node.js';
import type {
	NativeAudioSessionOpenRequestV1,
	SoundscaperNativeServicesBridge,
} from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import { createSoundscaperNativeRendererBridge } from '../src/common/editor/ui/soundscaper-native-renderer-bridge.ts';

test('a failed audio-open rollback remains owned for workspace teardown', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, false);
	fixture.failNextAudioClose();
	await assert.rejects(() => renderer.bridge.openNativeAudioSession({
		...audioRequest(), sampleRate: 44_100,
	}), /context rate/u);
	assert.equal(fixture.active().audio.length, 1, 'main still owns the session whose rollback failed');
	await renderer.dispose();
	assert.deepEqual(fixture.active().audio, [], 'workspace teardown retries that session');
	assert.equal(fixture.audioCloses.length, 2);
});

test('a failed plug-in setup rollback remains owned for workspace teardown', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, false);
	fixture.refuseInitialPersistence();
	fixture.failNextPluginClose();
	await assert.rejects(() => renderer.bridge.instantiateNativePlugin({
		installationId: 'installation-1', instanceId: null,
	}), /initial native plug-in state/u);
	assert.equal(fixture.active().plugins.length, 1, 'main still owns the instance whose rollback failed');
	await renderer.dispose();
	assert.deepEqual(fixture.active().plugins, [], 'workspace teardown retries that instance');
	assert.equal(fixture.pluginCloses.length, 2);
});

test('a failed reconciliation close cannot orphan an active plug-in', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, true);
	await renderer.bridge.instantiateNativePlugin({ installationId: 'installation-1', instanceId: null });
	fixture.project.nativePluginStates = [];
	fixture.failNextPluginClose();
	assert.deepEqual(await renderer.restoreProjectNativePlugins(), []);
	assert.equal(fixture.active().plugins.length, 1, 'the refused main close leaves the helper live');
	await renderer.dispose();
	assert.deepEqual(fixture.active().plugins, [], 'workspace teardown retains and retries its ownership');
	assert.equal(fixture.pluginCloses.length, 2);
});

test('a failed offline-runtime close remains owned for workspace teardown', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture({ seeded: true });
	const renderer = createRenderer(fixture, false);
	const runtimes = await prepareNativePluginOfflineRuntimes(fixture.audioContext, fixture.project, {
		trackId: 'track-1', includeMaster: false,
	});
	fixture.failNextPluginClose();
	await runtimes.dispose();
	assert.equal(fixture.active().plugins.length, 1, 'main still owns the offline helper whose close failed');
	await renderer.dispose();
	assert.deepEqual(fixture.active().plugins, [], 'workspace teardown retries the offline helper');
	assert.equal(fixture.pluginCloses.length, 2);
});

test('workspace teardown reports failed closes and retries retained ownership', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, false);
	const opened = await renderer.bridge.openNativeAudioSession(audioRequest());
	assert.equal(opened.status, 'opened');
	if (opened.status !== 'opened') return;
	const instance = await renderer.bridge.instantiateNativePlugin({
		installationId: 'installation-1', instanceId: null,
	});
	fixture.failNextAudioClose();
	fixture.failNextPluginClose();
	await assert.rejects(renderer.dispose());
	assert.deepEqual(fixture.active(), {
		audio: [opened.sessionId], plugins: [instance.instanceId],
	}, 'rejected teardown closes remain renderer-owned');
	await renderer.dispose();
	assert.deepEqual(fixture.active(), { audio: [], plugins: [] });
	assert.equal(fixture.audioCloses.length, 2);
	assert.equal(fixture.pluginCloses.length, 2);
});

test('workspace teardown waits for an in-flight open before snapshotting ownership', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, false);
	const gate = fixture.deferNextAudioOpen();
	const opening = renderer.bridge.openNativeAudioSession(audioRequest());
	await gate.started;
	let disposalSettled = false;
	const disposal = renderer.dispose().then(() => { disposalSettled = true; });
	await new Promise<void>((resolve) => setImmediate(resolve));
	const settledBeforeOpen = disposalSettled;
	fixture.failNextAudioClose();
	gate.resolve();
	const settlements = await Promise.allSettled([opening, disposal]);
	assert.equal(settledBeforeOpen, false, 'teardown must wait for ownership-establishing operations');
	assert.equal(settlements[0]?.status, 'rejected');
	assert.equal(settlements[1]?.status, 'fulfilled');
	assert.deepEqual(fixture.active().audio, [], 'teardown retries the late failed rollback');
	assert.equal(fixture.audioCloses.length, 2);
});

let fixtureSequence = 0;

function rollbackFixture(options: Readonly<{ seeded?: boolean }> = {}) {
	const suffix = String(++fixtureSequence);
	const authoredInstanceId = `authored-${suffix}`;
	const pluginInstanceId = `plugin-${suffix}`;
	const audioSessionId = `audio-${suffix}`;
	const audio = new Set<string>();
	const plugins = new Set<string>();
	const audioCloses: string[] = [];
	const pluginCloses: string[] = [];
	const listeners = new Set<(event: Event) => void>();
	let audioCloseFailure = false;
	let pluginCloseFailure = false;
	let initialPersistenceRefused = false;
	let delayAudioOpen = false;
	const audioOpenStarted = deferred();
	const audioOpenGate = deferred();
	const state = pluginState(authoredInstanceId);
	const project = {
		sampleRate: 48_000,
		masterChannels: 2,
		tracks: [{
			id: 'track-1', type: 'audio', enabled: true, effectsActive: true,
			effects: options.seeded ? [rackEffect(authoredInstanceId)] : [] as Record<string, unknown>[],
		}],
		master: { effectsActive: true, effects: [] as Record<string, unknown>[] },
		mixer: createDefaultMixerGraphV21([{ id: 'track-1', channelCount: 2 }], 2),
		nativePluginStates: options.seeded ? [state] : [] as ReturnType<typeof pluginState>[],
	};
	const audioContext = {
		sampleRate: 48_000,
		destination: audioNode(),
		audioWorklet: { addModule: async () => undefined },
		createGain: () => ({ ...audioNode(), gain: { value: 1 } }),
	} as unknown as AudioContext;
	const bridge = {
		openNativeAudioSession: async (request: NativeAudioSessionOpenRequestV1) => {
			if (delayAudioOpen) {
				audioOpenStarted.resolve();
				await audioOpenGate.promise;
				delayAudioOpen = false;
			}
			audio.add(audioSessionId);
			return {
				status: 'opened' as const, sessionId: audioSessionId,
				backend: request.candidates[0]!.backend,
				deviceHandle: request.candidates[0]!.deviceHandle,
				format: request, attempts: [],
			};
		},
		closeNativeAudioSession: async ({ sessionId }: Readonly<{ sessionId: string }>) => {
			audioCloses.push(sessionId);
			if (audioCloseFailure) {
				audioCloseFailure = false;
				throw new Error('planned audio close failure');
			}
			return audio.delete(sessionId);
		},
		instantiateNativePlugin: async (request: Readonly<{ instanceId: string | null }>) => {
			const instanceId = request.instanceId ?? pluginInstanceId;
			plugins.add(instanceId);
			queueMicrotask(() => {
				for (const listener of listeners) listener(pluginPortOffer(instanceId));
			});
			return pluginProjection(instanceId);
		},
		persistNativePluginState: async ({ instanceId }: Readonly<{ instanceId: string }>) => ({
			outcome: { status: 'persisted' },
			projectState: initialPersistenceRefused ? null : pluginState(instanceId),
		}),
		restoreNativePluginState: async ({ instanceId }: Readonly<{ instanceId: string }>) => ({
			projectState: pluginState(instanceId), bytes: new Uint8Array([1]),
		}),
		closeNativePluginInstance: async ({ instanceId }: Readonly<{ instanceId: string }>) => {
			pluginCloses.push(instanceId);
			if (pluginCloseFailure) {
				pluginCloseFailure = false;
				throw new Error('planned plug-in close failure');
			}
			return plugins.delete(instanceId);
		},
	} as unknown as SoundscaperNativeServicesBridge;
	const engine = {
		sampleRate: 48_000,
		getAudioContext: async () => audioContext,
		getState: () => ({ state: 'stopped' }),
		getPositionFrames: () => 0,
		commitNativeEffectPdcRevision: () => ({ contextTime: null, publicationDelayMs: 0 }),
		pause() {},
		play: async () => undefined,
	} as unknown as EnginePublicApi;
	const controller = {
		project,
		getSnapshot: () => ({ selectedTrackId: 'track-1' }),
		actions: {
			effects: { update() {} },
			nativePlugins: {
				commitBinding(request: Readonly<{
					operation: 'author' | 'restore'; effect: Readonly<Record<string, unknown>>; state: unknown;
				}>) {
					const effectId = typeof request.effect.id === 'string' ? request.effect.id : `effect-${suffix}`;
					const effect = { id: effectId, type: 'native-plugin', ...request.effect };
					if (request.operation === 'author') project.tracks[0]!.effects.push(effect);
					project.nativePluginStates = [request.state as ReturnType<typeof pluginState>];
					return { effectId };
				},
				upsert(next: unknown) { project.nativePluginStates = [next as ReturnType<typeof pluginState>]; },
				setBypassed() {},
			},
		},
	};
	return {
		active: () => ({ audio: [...audio], plugins: [...plugins] }),
		audioCloses, audioContext, bridge, controller, engine, pluginCloses, project,
		windowValue: {
			window: FIXTURE_WINDOW_SOURCE,
			addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
				listeners.add(listener as (event: Event) => void);
			},
			removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
				listeners.delete(listener as (event: Event) => void);
			},
		} as Pick<Window, 'addEventListener' | 'removeEventListener'>,
		failNextAudioClose: () => { audioCloseFailure = true; },
		failNextPluginClose: () => { pluginCloseFailure = true; },
		refuseInitialPersistence: () => { initialPersistenceRefused = true; },
		deferNextAudioOpen: () => {
			delayAudioOpen = true;
			return { started: audioOpenStarted.promise, resolve: audioOpenGate.resolve };
		},
	};
}

function createRenderer(fixture: ReturnType<typeof rollbackFixture>, withController: boolean) {
	return createSoundscaperNativeRendererBridge({
		bridge: fixture.bridge,
		engine: fixture.engine,
		controller: withController ? fixture.controller : null,
		windowValue: fixture.windowValue,
	});
}

function useFakeAudioWorklet(context: Readonly<{ after(callback: () => void): void }>): void {
	const original = globalThis.AudioWorkletNode;
	class FakeAudioWorkletNode {
		readonly port = {
			onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
			start() {},
			postMessage: (message: Record<string, unknown>) => {
				if (message.type === 'native-plugin-attach') queueMicrotask(() => this.port.onmessage?.({
					data: { type: 'native-plugin-attached', generation: 1 },
				}));
				if (message.type === 'native-plugin-save-state') queueMicrotask(() => this.port.onmessage?.({
					data: {
						type: 'native-plugin-state', requestId: message.requestId,
						bytes: new Uint8Array([1]), authentication: { status: 'authenticated' },
					},
				}));
				if (message.type === 'native-plugin-load-state') queueMicrotask(() => this.port.onmessage?.({
					data: { type: 'native-plugin-state-loaded', requestId: message.requestId },
				}));
			},
		};
		connect(): void {}
		disconnect(): void {}
	}
	globalThis.AudioWorkletNode = FakeAudioWorkletNode as unknown as typeof AudioWorkletNode;
	context.after(() => { globalThis.AudioWorkletNode = original; });
}

const FIXTURE_WINDOW_SOURCE = {} as Window;

function pluginPortOffer(instanceId: string): Event {
	return {
		source: FIXTURE_WINDOW_SOURCE,
		data: { type: 'soundscaper-native-plugin-rpc-port-v1', offer: {
			instanceId, purpose: 'plugin-rpc', transport: 'message-port',
			portContractVersion: 1, generation: 1, reportedLatencyFrames: 0,
		} },
		ports: [{ postMessage() {}, close() {} }],
	} as unknown as Event;
}

function audioRequest(): NativeAudioSessionOpenRequestV1 {
	return {
		candidates: [{ backend: 'alsa', deviceHandle: 'device-1' }],
		direction: 'output', mode: 'shared', sampleRate: 48_000,
		periodFrames: 128, channelCount: 2,
	};
}

function audioNode(): AudioNode {
	return { connect() {}, disconnect() {} } as unknown as AudioNode;
}

function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
	let settle = (): void => undefined;
	const promise = new Promise<void>((resolve) => { settle = resolve; });
	return Object.freeze({ promise, resolve: () => settle() });
}

function pluginProjection(instanceId: string) {
	return {
		instanceId, entryId: 'entry-1', stablePluginId: 'org.example.effect', format: 'clap' as const,
		binarySha256: 'a'.repeat(64), inputChannels: 2, outputChannels: 2,
		state: 'hosted' as const, enabled: true, bypassed: false, latencySamples: 0,
	};
}

function pluginState(instanceId: string) {
	return {
		instanceId, format: 'clap' as const, stablePluginId: 'org.example.effect',
		binarySha256: 'a'.repeat(64), enabled: true, bypassed: false, continuity: 'live' as const,
		stateBody: {
			kind: 'native-plugin-state' as const, bodyId: 'b'.repeat(64),
			byteLength: 1, sha256: 'c'.repeat(64),
		},
	};
}

function rackEffect(instanceId: string): Record<string, unknown> {
	return {
		id: `effect-${instanceId}`, type: 'native-plugin', enabled: true, bypassed: false,
		params: { instanceId, latencyFrames: 0 },
		context: {
			format: 'clap', stablePluginId: 'org.example.effect', binarySha256: 'a'.repeat(64),
		},
	};
}
