/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { soundscaperNativeAudioDestination } from '../src/common/editor/soundscaper-native-audio-renderer.ts';
import type { EnginePublicApi } from '../src/common/editor/engine/public-api.ts';
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import type { NativeAudioInventory } from '../src/common/editor/controller/native-audio-inventory.ts';
import type {
	NativeAudioSessionOpenRequestV1,
	SoundscaperNativeServicesBridge,
} from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import { createSoundscaperNativeRendererBridge } from '../src/common/editor/ui/soundscaper-native-renderer-bridge.ts';

test('the workspace renderer releases sessions on disable, explicit close, and workspace teardown only', async (t) => {
	useFakeAudioWorklet(t);
	const fixture = rendererFixture();
	const renderer = createRenderer(fixture);

	await renderer.bridge.openNativeAudioSession(audioRequest('audio-session-1'));
	fixture.offerAudio('audio-session-1');
	await renderer.bridge.bindNativeAudioSession({ sessionId: 'audio-session-1', queueCapacity: 8 });
	await renderer.bridge.instantiateNativePlugin({ installationId: 'installation-1', instanceId: null });
	assert.equal(fixture.effect().bypassed, false, 'instantiation authors one live project rack effect');
	assert.equal(fixture.nativeState().instanceId, 'plugin-instance-1',
		'instantiation authors the matching native state through the same binding action');
	assert.deepEqual(fixture.projectCommits(), { bindings: 1, stateUpserts: 0 });
	assert.notEqual(soundscaperNativeAudioDestination(fixture.context, fixture.fallback), fixture.fallback,
		'a bound output remains the live playback destination while the workspace owns it');
	assert.deepEqual(fixture.active(), { audio: ['audio-session-1'], plugins: ['plugin-instance-1'] });

	await renderer.bridge.setNativeAudioHelperEnabled(false);
	assert.equal(soundscaperNativeAudioDestination(fixture.context, fixture.fallback), fixture.fallback,
		'explicit disable releases the renderer route');
	await renderer.bridge.closeNativePluginInstance({ instanceId: 'plugin-instance-1' });
	assert.equal(fixture.effect().bypassed, true, 'explicit close bypasses the authored project effect');
	assert.deepEqual(fixture.active(), { audio: [], plugins: [] });

	await renderer.bridge.setNativeAudioHelperEnabled(true);
	await renderer.bridge.openNativeAudioSession(audioRequest('audio-session-2'));
	fixture.offerAudio('audio-session-2');
	await renderer.bridge.bindNativeAudioSession({ sessionId: 'audio-session-2', queueCapacity: 8 });
	await renderer.bridge.instantiateNativePlugin({ installationId: 'installation-1', instanceId: 'plugin-instance-2' });
	await renderer.dispose();
	assert.deepEqual(fixture.active(), { audio: [], plugins: [] });
	assert.deepEqual(fixture.closes, [
		['audio', 'audio-session-1'],
		['plugin', 'plugin-instance-1'],
		['audio', 'audio-session-2'],
		['plugin', 'plugin-instance-2'],
	]);
});

test('failed explicit native closes remain owned so workspace teardown can retry them', async (t) => {
	useFakeAudioWorklet(t);
	const fixture = rendererFixture();
	const renderer = createRenderer(fixture);
	const opened = await renderer.bridge.openNativeAudioSession(audioRequest('audio-retry'));
	assert.equal(opened.status, 'opened');
	if (opened.status !== 'opened') return;
	const instance = await renderer.bridge.instantiateNativePlugin({
		installationId: 'installation-1', instanceId: null,
	});
	const audioFailure = new Error('planned native audio close failure');
	const pluginFailure = new Error('planned native plug-in close failure');
	fixture.failNextAudioClose(audioFailure);
	fixture.failNextPluginClose(pluginFailure);
	await assert.rejects(
		() => renderer.bridge.closeNativeAudioSession({ sessionId: opened.sessionId }),
		audioFailure,
	);
	await assert.rejects(
		() => renderer.bridge.closeNativePluginInstance({ instanceId: instance.instanceId }),
		pluginFailure,
	);
	assert.deepEqual(fixture.active(), {
		audio: [opened.sessionId], plugins: [instance.instanceId],
	}, 'main still owns both failed closes');
	await renderer.dispose();
	assert.deepEqual(fixture.active(), { audio: [], plugins: [] }, 'teardown retries both closes');
	assert.deepEqual(fixture.closes, [
		['audio', opened.sessionId], ['plugin', instance.instanceId],
		['audio', opened.sessionId], ['plugin', instance.instanceId],
	]);
});

test('workspace teardown closes main audio ownership after a local release failure', async (t) => {
	useFakeAudioWorklet(t);
	const failure = new Error('planned playback restart failure');
	const fixture = rendererFixture({ engineState: 'playing', playFailure: failure });
	const renderer = createRenderer(fixture);
	const opened = await renderer.bridge.openNativeAudioSession(audioRequest('audio-release-failure'));
	assert.equal(opened.status, 'opened');
	if (opened.status !== 'opened') return;
	const instance = await renderer.bridge.instantiateNativePlugin({
		installationId: 'installation-1', instanceId: null,
	});
	await assert.rejects(renderer.dispose(), failure);
	assert.deepEqual(fixture.active().audio, [], 'main closes even when local graph restart reports failure');
	assert.deepEqual(fixture.active().plugins, [], 'later plug-in teardown is not skipped after that failure');
	assert.deepEqual(fixture.closes, [
		['audio', opened.sessionId],
		['plugin', instance.instanceId],
	]);
});

test('a port offer from a foreign window source never attaches audio authority', async (t) => {
	useFakeAudioWorklet(t);
	const fixture = rendererFixture();
	const renderer = createRenderer(fixture);
	await renderer.bridge.openNativeAudioSession(audioRequest('foreign'));
	// An embedded frame can post a well-formed offer with a transferred port;
	// accepting it would route playback into the sender's port and publish the
	// sender's audio into canonical recording.
	fixture.offerAudioFrom({}, 'foreign');
	assert.equal(soundscaperNativeAudioDestination(fixture.context, fixture.fallback), fixture.fallback,
		'a foreign-source offer must not become the playback destination');
	fixture.offerAudio('foreign');
	assert.notEqual(soundscaperNativeAudioDestination(fixture.context, fixture.fallback), fixture.fallback,
		'the preload relay offer from the window itself still attaches');
	await renderer.dispose();
});

test('a native route at a different rate than the engine context refuses instead of repitching', async (t) => {
	useFakeAudioWorklet(t);
	const fixture = rendererFixture();
	const renderer = createRenderer(fixture);
	// The fixture context runs at 48 kHz; a 44.1 kHz route would play ~8.8 %
	// fast against the export render, so the open must refuse and close the
	// session main just granted.
	await assert.rejects(
		() => renderer.bridge.openNativeAudioSession({
			...audioRequest('audio-mismatch'), sampleRate: 44_100,
		}),
		/context rate/u,
	);
	assert.deepEqual(fixture.active(), { audio: [], plugins: [] },
		'the refused route must not leave a main-side session open');
	await renderer.dispose();
});

test('project reconciliation restores rack projection and native state through one binding action', async (t) => {
	useFakeAudioWorklet(t);
	const fixture = rendererFixture({ initialInstanceId: 'plugin-instance-restored' });
	const renderer = createRenderer(fixture);

	assert.deepEqual(await renderer.restoreProjectNativePlugins(), [{
		instanceId: 'plugin-instance-restored', status: 'restored',
	}]);
	assert.deepEqual(fixture.projectCommits(), { bindings: 1, stateUpserts: 0 });
	assert.equal(fixture.nativeState().instanceId, 'plugin-instance-restored');
	await renderer.dispose();
});

test('described native inventories accumulate in routing and disabling clears them', async () => {
	const fixture = rendererFixture({ nativeDevices: [{
		handle: 'studio-interface', label: 'Studio interface', direction: 'duplex',
		channelCount: 32, isDefault: true,
	}, {
		handle: 'relative/device', label: 'Path-shaped device', direction: 'input', channelCount: 2,
	}] });
	const renderer = createRenderer(fixture);
	await renderer.bridge.describeNativeAudioBackend({ backend: 'wasapi' });
	assert.equal(fixture.nativeRefreshes.length, 1);
	assert.equal(fixture.nativeRefreshes[0].probe, false);
	assert.deepEqual(fixture.nativeRefreshes[0].nativeInventory.inputs.map((row) => row.deviceId), [
		'native:wasapi:in:studio-interface',
	]);
	assert.deepEqual(fixture.nativeRefreshes[0].nativeInventory.outputs.map((row) => row.deviceId), [
		'native:wasapi:out:studio-interface',
	]);
	assert.deepEqual(fixture.nativeRefreshes[0].nativeInventory.rejected, [{
		label: 'Path-shaped device', reason: 'opaque-handle-required',
	}]);
	await renderer.bridge.describeNativeAudioBackend({ backend: 'asio' });
	assert.deepEqual(fixture.nativeRefreshes[1].nativeInventory.inputs.map((row) => row.deviceId), [
		'native:asio:in:studio-interface', 'native:wasapi:in:studio-interface',
	]);
	await renderer.bridge.setNativeAudioHelperEnabled(false);
	assert.deepEqual(fixture.nativeRefreshes[2].nativeInventory.inputs, []);
	assert.deepEqual(fixture.nativeRefreshes[2].nativeInventory.outputs, []);
	await renderer.dispose();
});

test('calibration refuses every busy renderer state before impulse and persists only the measured offset', async (t) => {
	useFakeAudioWorklet(t);
	const fixture = rendererFixture();
	const renderer = createRenderer(fixture);
	const request = { ...audioRequest('duplex'), direction: 'duplex' as const };
	const opened = await renderer.bridge.openNativeAudioSession(request);
	assert.equal(opened.status, 'opened');
	if (opened.status !== 'opened') return;
	fixture.offerAudio(opened.sessionId);
	await renderer.bridge.bindNativeAudioSession({ sessionId: opened.sessionId, queueCapacity: 8 });
	fixture.controller.state.monitoring = true;
	const busy = await renderer.bridge.nativeAudioSessionStatus({ sessionId: opened.sessionId });
	assert.equal(busy.calibrationAvailable, false);
	assert.equal(busy.calibrationUnavailableReason, 'renderer-busy');
	await assert.rejects(() => renderer.bridge.calibrateNativeAudioSession({ sessionId: opened.sessionId }),
		/stopped playback.*idle/iu);
	assert.deepEqual(fixture.calibrations, [], 'a refused calibration never asks the worklet to inject');
	fixture.controller.state.monitoring = false;
	const calibrated = await renderer.bridge.calibrateNativeAudioSession({ sessionId: opened.sessionId });
	assert.equal(calibrated.calibrationFrames, 64);
	assert.deepEqual(fixture.calibrations, [{ sessionId: opened.sessionId, calibrationFrames: 64 }]);
	await renderer.dispose();
});

test('worklet transfer and loss reports reach main in order before the local route disappears', async (t) => {
	useFakeAudioWorklet(t);
	const fixture = rendererFixture();
	const renderer = createRenderer(fixture);
	const opened = await renderer.bridge.openNativeAudioSession(audioRequest('loss'));
	assert.equal(opened.status, 'opened');
	if (opened.status !== 'opened') return;
	fixture.offerAudio(opened.sessionId);
	await renderer.bridge.bindNativeAudioSession({ sessionId: opened.sessionId, queueCapacity: 8 });
	const deviceNode = FakeAudioWorkletNode.instances.slice().reverse().find(
		(instance) => instance.name === 'soundscaper-native-device-io-v1',
	);
	assert.ok(deviceNode);
	deviceNode.port.onmessage?.({ data: {
		type: 'native-device-transfer', framesTransferred: 2_048, lostFrames: 16,
	} });
	deviceNode.port.onmessage?.({ data: { type: 'native-device-closed', reason: 'device-loss' } });
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.deepEqual(fixture.transfers, [{
		sessionId: opened.sessionId, framesTransferred: 2_048, lostFrames: 16,
	}]);
	assert.deepEqual(fixture.losses, [{ sessionId: opened.sessionId, reason: 'device-loss' }]);
	assert.equal(soundscaperNativeAudioDestination(fixture.context, fixture.fallback), fixture.fallback);
	await renderer.dispose();
});

class FakeAudioWorkletNode {
	static readonly instances: FakeAudioWorkletNode[] = [];
	readonly name: string;
	readonly port: {
		onmessage: ((event: { data: Record<string, unknown> }) => void) | null;
		start(): void;
		postMessage: (message: Record<string, unknown>) => void;
	};
	constructor(_context: unknown, name: string) {
		this.name = name;
		FakeAudioWorkletNode.instances.push(this);
		this.port = {
			onmessage: null,
			start() {},
			postMessage: (message) => {
				if (message.type === 'native-device-calibrate') queueMicrotask(() => this.port.onmessage?.({
					data: { type: 'native-device-calibration-result', requestId: message.requestId, calibrationFrames: 64 },
				}));
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
	}
	connect(): void {}
	disconnect(): void {}
}

/** Stands in for the window the preload relay posts to; offers carry it as their source. */
const FIXTURE_WINDOW_SOURCE = {} as Window;

function useFakeAudioWorklet(context: Readonly<{ after(callback: () => void): void }>): void {
	const original = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = FakeAudioWorkletNode as unknown as typeof AudioWorkletNode;
	context.after(() => { globalThis.AudioWorkletNode = original; });
}

function createRenderer(fixture: ReturnType<typeof rendererFixture>) {
	return createSoundscaperNativeRendererBridge({
		bridge: fixture.bridge, engine: fixture.engine,
		controller: fixture.controller, windowValue: fixture.windowValue,
	});
}

function rendererFixture(options: Readonly<{
	initialInstanceId?: string;
	nativeDevices?: readonly Readonly<Record<string, unknown>>[];
	engineState?: string;
	playFailure?: Error;
}> = {}) {
	const audio = new Set<string>();
	const plugins = new Set<string>();
	const closes: Array<['audio' | 'plugin', string]> = [];
	let audioEnabled = true;
	let audioSequence = 0;
	const listeners = new Set<(event: Event) => void>();
	const destination = node('destination');
	const fallback = node('fallback');
	const bindingCommits: unknown[] = [];
	const nativeRefreshes: Array<Readonly<{ probe: false; nativeInventory: NativeAudioInventory }>> = [];
	const calibrations: unknown[] = [];
	const transfers: unknown[] = [];
	const losses: unknown[] = [];
	const audioRequests = new Map<string, NativeAudioSessionOpenRequestV1>();
	let audioCloseFailure: Error | null = null;
	let pluginCloseFailure: Error | null = null;
	let stateUpserts = 0;
	const initialInstanceId = options.initialInstanceId ?? null;
	const project = {
		sampleRate: 48_000,
		masterChannels: 2,
		tracks: [{
			id: 'track-1', type: 'audio', enabled: true, effectsActive: true,
			effects: (initialInstanceId ? [rackEffect(initialInstanceId)] : []) as Array<Record<string, unknown>>,
		}],
		master: { effectsActive: true, effects: [] },
		mixer: createDefaultMixerGraphV21([{ id: 'track-1', channelCount: 2 }], 2),
		nativePluginStates: (initialInstanceId ? [projectState(initialInstanceId)] : []) as unknown[],
	};
	const context = {
		sampleRate: 48_000,
		destination,
		audioWorklet: { addModule: async () => undefined },
		createGain: () => ({ ...node('sink'), gain: { value: 1 } }),
		createMediaStreamDestination: () => ({ stream: {
			clone: () => ({ getTracks: () => [{ stop() {} }] }),
		} }),
	} as unknown as AudioContext;
	const audioProjection = (sessionId: string, calibrationFrames: number | null = null) => {
		const request = audioRequests.get(sessionId) ?? audioRequest(sessionId);
		return {
			sessionId, state: 'bound' as const, backend: request.candidates[0].backend,
			format: request, attempts: [], framesTransferred: 0, lostFrames: 0, calibrationFrames,
			calibrationAvailable: request.direction === 'duplex',
			calibrationUnavailableReason: request.direction === 'duplex' ? null : 'duplex-required' as const,
			transport: 'native' as const, fallback: null,
		};
	};
	const bridge = {
		nativeAudioHelperAvailability: async () => ({
			enabled: audioEnabled, quarantined: false,
			payload: { status: 'available', reason: null, detail: '' }, backends: ['alsa'],
		}),
		setNativeAudioHelperEnabled: async (enabled: boolean) => { audioEnabled = enabled; return enabled; },
		describeNativeAudioBackend: async ({ backend }: Readonly<{ backend: string }>) => ({ status: 'described', inventory: {
			backend, status: 'ready', detail: '', devices: options.nativeDevices ?? [],
		} }),
		nativePluginAvailability: async () => ({
			enabled: true, quarantined: false, payload: { status: 'available', reason: null },
			formats: [], consent: { scanningEnabled: true, formats: [] },
			quarantine: { loaded: true, degraded: false, records: [], pendingFaults: 0 },
		}),
		setNativePluginConsent: async () => ({}),
		scanNativePlugins: async () => ({ status: 'described', scan: {
			format: 'clap', status: 'scanned', detail: '', entries: [],
		} }),
		listNativePlugins: async () => ({ entries: [] }),
		openNativeAudioSession: async (request: NativeAudioSessionOpenRequestV1) => {
			const sessionId = `audio-session-${String(++audioSequence)}`;
			audio.add(sessionId);
			audioRequests.set(sessionId, request);
			return { status: 'opened' as const, sessionId, backend: request.candidates[0].backend,
				deviceHandle: request.candidates[0].deviceHandle, format: request, attempts: [] };
		},
		bindNativeAudioSession: async () => ({}),
		nativeAudioSessionStatus: async ({ sessionId }: Readonly<{ sessionId: string }>) => audioProjection(sessionId),
		calibrateNativeAudioSession: async (request: Readonly<{ sessionId: string; calibrationFrames: number }>) => {
			calibrations.push(request);
			return audioProjection(request.sessionId, request.calibrationFrames);
		},
		reportNativeAudioSessionTransfer: async (request: Readonly<{
			sessionId: string; framesTransferred: number; lostFrames: number;
		}>) => { transfers.push(request); return audioProjection(request.sessionId); },
		reportNativeAudioSessionLoss: async (request: Readonly<{
			sessionId: string; reason: string;
		}>) => { losses.push(request); return audioProjection(request.sessionId); },
		closeNativeAudioSession: async ({ sessionId }: Readonly<{ sessionId: string }>) => {
			closes.push(['audio', sessionId]);
			if (audioCloseFailure) {
				const failure = audioCloseFailure;
				audioCloseFailure = null;
				throw failure;
			}
			return audio.delete(sessionId);
		},
		reviewNativePluginInstallation: async () => ({ entries: [] }),
		instantiateNativePlugin: async (request: Readonly<{ instanceId: string | null }>) => {
			const instanceId = request.instanceId ?? 'plugin-instance-1';
			plugins.add(instanceId);
			queueMicrotask(() => { for (const listener of listeners) listener(pluginOffer(instanceId)); });
			return pluginProjection(instanceId);
		},
		runNativePluginOffline: async ({ instanceId }: Readonly<{ instanceId: string }>) => ({
			instance: pluginProjection(instanceId), blocksRendered: 1, renderedSha256: 'a'.repeat(64),
		}),
		setNativePluginBypassed: async ({ instanceId, bypassed }: Readonly<{
			instanceId: string; bypassed: boolean;
		}>) => pluginProjection(instanceId, { bypassed }),
		persistNativePluginState: async ({ instanceId }: Readonly<{ instanceId: string }>) => ({
			outcome: { status: 'persisted' }, projectState: projectState(instanceId),
		}),
		restoreNativePluginState: async ({ instanceId }: Readonly<{ instanceId: string }>) => ({
			projectState: projectState(instanceId), bytes: new Uint8Array([1]),
		}),
		openNativePluginVendorUi: async () => ({ status: 'refused', code: 'unavailable' }),
		closeNativePluginVendorUi: async () => false,
		closeNativePluginInstance: async ({ instanceId }: Readonly<{ instanceId: string }>) => {
			closes.push(['plugin', instanceId]);
			if (pluginCloseFailure) {
				const failure = pluginCloseFailure;
				pluginCloseFailure = null;
				throw failure;
			}
			return plugins.delete(instanceId);
		},
	} as unknown as SoundscaperNativeServicesBridge;
	const engine = {
		sampleRate: 48_000,
		getAudioContext: async () => context,
		getState: () => ({ state: options.engineState ?? 'stopped' }),
		getPositionFrames: () => 0,
		commitNativeEffectPdcRevision: () => ({ contextTime: null, publicationDelayMs: 0 }),
		pause() {},
		play: async () => { if (options.playFailure) throw options.playFailure; },
	} as unknown as EnginePublicApi;
	const controller = {
		project,
		state: {
			monitoring: false, microphoneMetering: false, recorder: null,
			recordingStarting: false, recordingFinishing: false, timedRecordingPreparing: false,
			timedRecording: null, timedRecordingCancelling: false, recordingPoolSources: [] as unknown[],
		},
		refreshAudioDevices: async (value: (typeof nativeRefreshes)[number]) => { nativeRefreshes.push(value); },
		getSnapshot: () => ({ selectedTrackId: 'track-1' }),
		actions: {
			effects: {
				add: (request: Readonly<Record<string, unknown>>) => {
					const options = request.options as Readonly<Record<string, unknown>>;
					project.tracks[0]!.effects.push({
						id: `effect-${String(project.tracks[0]!.effects.length + 1)}`,
						type: request.type, enabled: options.enabled, bypassed: options.bypassed,
						params: options.params, context: options.context,
					});
					return project.tracks[0]!.effects.at(-1)?.id;
				},
				update: (_scope: string, _trackId: string, effectId: string, changes: Readonly<Record<string, unknown>>) => {
					const effect = project.tracks[0]!.effects.find(({ id }) => id === effectId);
					if (effect) Object.assign(effect, changes);
				},
			},
			nativePlugins: {
				commitBinding: (request: Readonly<{
					operation: 'author' | 'restore'; trackId: string;
					effect: Readonly<Record<string, unknown>>; state: unknown;
				}>) => {
					bindingCommits.push(request);
					const effectId = typeof request.effect.id === 'string'
						? request.effect.id : `effect-${String(project.tracks[0]!.effects.length + 1)}`;
					const effect = { id: effectId, type: 'native-plugin', ...request.effect };
					const effects = project.tracks[0]!.effects;
					if (request.operation === 'author') effects.push(effect);
					else {
						const index = effects.findIndex(({ id }) => id === effectId);
						if (index < 0) throw new Error('Missing restored effect');
						effects[index] = effect;
					}
					project.nativePluginStates = [request.state];
					return { effectId };
				},
				upsert: (state: unknown) => {
					stateUpserts += 1;
					project.nativePluginStates = [state];
				},
				setBypassed: (instanceId: string, bypassed: boolean) => {
					project.nativePluginStates = project.nativePluginStates.map((state) => (
						(state as { instanceId?: string }).instanceId === instanceId
							? { ...(state as Record<string, unknown>), bypassed } : state
					));
				},
			},
		},
	};
	return {
		bridge, calibrations, closes, context, controller, engine, fallback,
		losses, nativeRefreshes, transfers,
		windowValue: {
			window: FIXTURE_WINDOW_SOURCE,
			addEventListener: (_type: string, next: EventListenerOrEventListenerObject) => {
				listeners.add(next as (event: Event) => void);
			},
			removeEventListener: (_type: string, next: EventListenerOrEventListenerObject) => {
				listeners.delete(next as (event: Event) => void);
			},
		} as Pick<Window, 'addEventListener' | 'removeEventListener'>,
		offerAudio: (sessionId: string) => {
			for (const listener of listeners) listener(audioOffer(sessionId));
		},
		offerAudioFrom: (source: object, sessionId: string) => {
			for (const listener of listeners) {
				listener({ ...(audioOffer(sessionId) as unknown as Record<string, unknown>), source } as unknown as Event);
			}
		},
		active: () => ({ audio: [...audio], plugins: [...plugins] }),
		failNextAudioClose: (error: Error) => { audioCloseFailure = error; },
		failNextPluginClose: (error: Error) => { pluginCloseFailure = error; },
		effect: () => project.tracks[0]!.effects[0] as Readonly<{ bypassed: boolean }>,
		nativeState: () => project.nativePluginStates[0] as Readonly<{ instanceId: string }>,
		projectCommits: () => ({ bindings: bindingCommits.length, stateUpserts }),
	};
}

function node(name: string) {
	return { name, connect() {}, disconnect() {} } as unknown as AudioNode;
}

function audioRequest(_sessionId: string) {
	return {
		candidates: [{ backend: 'alsa' as const, deviceHandle: 'device-1' }],
		direction: 'output' as const, mode: 'shared' as const, sampleRate: 48_000,
		periodFrames: 128, channelCount: 2,
	};
}

function audioOffer(_sessionId: string): Event {
	return {
		source: FIXTURE_WINDOW_SOURCE,
		data: { type: 'soundscaper-native-realtime-port-v1', offer: {
			protocolVersion: 1, generation: 1, sampleFormat: 'f32-planar', sampleRate: 48_000,
			channelCount: 2, frameCount: 128, queueCapacity: 8, startFrame: 0,
		} },
		ports: [{ postMessage() {}, close() {} }],
	} as unknown as Event;
}

function pluginOffer(instanceId: string): Event {
	return {
		source: FIXTURE_WINDOW_SOURCE,
		data: { type: 'soundscaper-native-plugin-rpc-port-v1', offer: {
			instanceId, purpose: 'plugin-rpc', transport: 'message-port',
			portContractVersion: 1, generation: 1, reportedLatencyFrames: 0,
		} },
		ports: [{ postMessage() {}, close() {} }],
	} as unknown as Event;
}

function pluginProjection(instanceId: string, overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		instanceId, entryId: 'entry-1', stablePluginId: 'org.example.effect', format: 'clap',
		binarySha256: 'b'.repeat(64), inputChannels: 2, outputChannels: 2,
		state: 'hosted', enabled: true, bypassed: false, latencySamples: 0, ...overrides,
	};
}

function projectState(instanceId: string) {
	return {
		instanceId, format: 'clap', stablePluginId: 'org.example.effect', binarySha256: 'b'.repeat(64),
		stateBody: {
			kind: 'native-plugin-state' as const, bodyId: `native-plugin-state:${'c'.repeat(64)}`,
			byteLength: 1, sha256: 'c'.repeat(64),
		},
		enabled: true, bypassed: false, continuity: 'live' as const, latencySamples: 0,
	};
}

function rackEffect(instanceId: string) {
	return {
		id: `effect-${instanceId}`, type: 'native-plugin', enabled: true, bypassed: false,
		params: { instanceId, latencyFrames: 0 },
		context: {
			format: 'clap', stablePluginId: 'org.example.effect', binarySha256: 'b'.repeat(64),
		},
	};
}
