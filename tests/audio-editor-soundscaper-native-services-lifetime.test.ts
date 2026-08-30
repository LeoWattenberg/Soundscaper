/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { EnginePublicApi } from '../src/common/editor/engine/public-api.ts';
import type { SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import {
	createSoundscaperNativeServicesSurfaceHost,
	releaseSoundscaperNativeServicesOwnedHost,
} from '../src/common/editor/ui/workspace/SoundscaperNativeServicesSurface.tsx';

test('menu close preserves bound audio and an authored effect until explicit lifetime actions', async () => {
	const fixture = lifetimeFixture();
	const host = createSoundscaperNativeServicesSurfaceHost({
		bridge: fixture.baseBridge,
		engine: fixture.engine,
		controller: fixture.controller,
		documentValue: fixture.documentValue,
		createHostRoot: () => fixture.root,
		createRendererBridge: () => fixture.renderer,
	});
	host.open('native-audio-device');
	await host.dialogRuntime.perform({ type: 'open-audio-session', request: audioRequest() });
	await host.dialogRuntime.perform({ type: 'bind-audio-session', sessionId: 'audio-session-1' });
	await host.dialogRuntime.perform({ type: 'instantiate-plugin', installationId: 'installation-1' });

	host.close();
	host.setCopy({ soundscaperNativeServicesTitle: 'Localized native services' });
	assert.deepEqual(fixture.active(), { audio: ['audio-session-1'], plugins: ['plugin-instance-1'] });
	assert.equal(fixture.project.tracks[0]?.effects[0]?.bypassed, false,
		'the authored rack effect must remain live when its menu surface closes');
	assert.equal(fixture.calls.some(([name]) => name === 'closeNativeAudioSession'), false);
	assert.equal(fixture.calls.some(([name]) => name === 'closeNativePluginInstance'), false);

	host.open('native-effect-manage');
	assert.equal(host.dialogRuntime.getState().audioSession?.state, 'bound',
		'reopening must recover the workspace-owned audio projection');
	assert.equal(host.dialogRuntime.getState().pluginInstance?.instanceId, 'plugin-instance-1',
		'reopening must recover the project-owned plug-in projection');
	await host.dialogRuntime.perform({ type: 'audio-session-status', sessionId: 'audio-session-1' });
	await fixture.record();
	await fixture.play();
	await host.dialogRuntime.perform({ type: 'run-plugin-offline', instanceId: 'plugin-instance-1' });
	assert.deepEqual(fixture.activity, ['record:audio-session-1', 'play:audio-session-1', 'effect:plugin-instance-1']);

	await host.dialogRuntime.perform({ type: 'set-audio-enabled', enabled: false });
	await host.dialogRuntime.perform({ type: 'close-plugin', instanceId: 'plugin-instance-1' });
	assert.deepEqual(fixture.active(), { audio: [], plugins: [] });
	assert.equal(host.dialogRuntime.getState().audioSession, null);
	assert.equal(host.dialogRuntime.getState().pluginInstance, null);
	await host.dispose();
});

test('workspace teardown closes retained audio and project plug-in sessions', async () => {
	const fixture = lifetimeFixture();
	const host = createSoundscaperNativeServicesSurfaceHost({
		bridge: fixture.baseBridge,
		engine: fixture.engine,
		controller: fixture.controller,
		createRendererBridge: () => fixture.renderer,
	});
	await host.dialogRuntime.perform({ type: 'open-audio-session', request: audioRequest() });
	await host.dialogRuntime.perform({ type: 'bind-audio-session', sessionId: 'audio-session-1' });
	await host.dialogRuntime.perform({ type: 'instantiate-plugin', installationId: 'installation-1' });

	await host.dispose();
	assert.deepEqual(fixture.active(), { audio: [], plugins: [] });
	assert.deepEqual(fixture.calls.filter(([name]) => name.startsWith('close')), [
		['closeNativeAudioSession', 'audio-session-1'],
		['closeNativePluginInstance', 'plugin-instance-1'],
	]);
});

test('a failed surface disposal retains ownership and can be retried', async () => {
	const failure = new Error('planned surface unmount failure');
	let unmounts = 0;
	const container = { dataset: {}, remove: () => undefined } as unknown as HTMLElement;
	const documentValue = {
		activeElement: null,
		defaultView: null,
		createElement: () => container,
		body: { append: () => undefined },
		querySelector: () => null,
	} as unknown as Document;
	const host = createSoundscaperNativeServicesSurfaceHost({
		bridge: {} as SoundscaperNativeServicesBridge,
		documentValue,
		createHostRoot: () => ({
			render: () => undefined,
			unmount: () => {
				unmounts += 1;
				if (unmounts === 1) throw failure;
			},
		}),
	});
	host.open('native-effect-manage');
	const owner = {};
	const hosts = new WeakMap<object, Readonly<{ host: typeof host }>>([
		[owner, Object.freeze({ host })],
	]);

	await assert.rejects(() => releaseSoundscaperNativeServicesOwnedHost(hosts, owner), failure);
	assert.equal(hosts.has(owner), true,
		'a failed disposal must retain the only handle that can retry its cleanup');
	await releaseSoundscaperNativeServicesOwnedHost(hosts, owner);
	assert.equal(unmounts, 2);
	assert.equal(hosts.has(owner), false, 'only a successful retry retires host ownership');
});

test('an in-flight failed disposal never hides or overwrites a replacement host', async () => {
	const failure = new Error('planned deferred disposal failure');
	let rejectDisposal: (reason?: unknown) => void = () => undefined;
	const disposal = new Promise<void>((_resolve, reject) => { rejectDisposal = reject; });
	const owner = {};
	const closing = Object.freeze({ host: Object.freeze({ dispose: () => disposal }) });
	let replacementDisposals = 0;
	const replacement = Object.freeze({ host: Object.freeze({
		dispose: () => { replacementDisposals += 1; return Promise.resolve(); },
	}) });
	const hosts = new WeakMap<object, typeof closing | typeof replacement>([[owner, closing]]);

	const release = releaseSoundscaperNativeServicesOwnedHost(hosts, owner, closing);
	const rejected = assert.rejects(release, failure);
	assert.equal(hosts.has(owner), false,
		'a closing host must yield its slot so resolution cannot reuse it');
	hosts.set(owner, replacement);
	rejectDisposal(failure);
	await rejected;
	assert.equal(hosts.get(owner), replacement,
		'a failed old disposal must not overwrite the replacement installed while it awaited');
	assert.equal(replacementDisposals, 0);
});

test('a stale lifecycle cleanup cannot release a replacement host', async () => {
	const owner = {};
	let replacementDisposals = 0;
	const previous = Object.freeze({ host: Object.freeze({ dispose: () => Promise.resolve() }) });
	const replacement = Object.freeze({ host: Object.freeze({
		dispose: () => { replacementDisposals += 1; return Promise.resolve(); },
	}) });
	const hosts = new WeakMap<object, typeof previous | typeof replacement>([[owner, replacement]]);

	await releaseSoundscaperNativeServicesOwnedHost(hosts, owner, previous);
	assert.equal(hosts.get(owner), replacement);
	assert.equal(replacementDisposals, 0,
		'an old bridge cleanup must be conditional on the host identity it captured');
});

function lifetimeFixture() {
	const calls: Array<[string, ...unknown[]]> = [];
	const audio = new Set<string>();
	const plugins = new Set<string>();
	const activity: string[] = [];
	let audioEnabled = true;
	let audioState: 'open' | 'bound' = 'open';
	const project = {
		nativePluginStates: [] as unknown[],
		tracks: [{ id: 'track-1', effects: [] as Array<{ id: string; bypassed: boolean }> }],
	};
	const bridge = {
		nativeAudioHelperAvailability: async () => ({
			enabled: audioEnabled, quarantined: false,
			payload: { status: 'available', reason: null, detail: '' }, backends: ['alsa'],
		}),
		setNativeAudioHelperEnabled: async (enabled: boolean) => {
			audioEnabled = enabled;
			if (!enabled) audio.clear();
			return enabled;
		},
		describeNativeAudioBackend: async () => ({
			status: 'described' as const,
			inventory: { backend: 'alsa', status: 'ready', detail: '', devices: [] },
		}),
		nativePluginAvailability: async () => ({
			enabled: true, quarantined: false, payload: { status: 'available', reason: null },
			formats: [], consent: { scanningEnabled: true, formats: [] },
			quarantine: { loaded: true, degraded: false, records: [], pendingFaults: 0 },
		}),
		setNativePluginConsent: async () => ({}),
		scanNativePlugins: async () => ({
			status: 'described' as const,
			scan: { format: 'fixture', status: 'scanned', detail: '', entries: [] },
		}),
		listNativePlugins: async () => ({ entries: [] }),
		openNativeAudioSession: async () => {
			audio.add('audio-session-1');
			audioState = 'open';
			return { status: 'opened' as const, sessionId: 'audio-session-1', backend: 'alsa' };
		},
		bindNativeAudioSession: async () => { audioState = 'bound'; return {}; },
		nativeAudioSessionStatus: async () => ({
			sessionId: 'audio-session-1', state: audioState, backend: 'alsa', calibrationFrames: null,
		}),
		calibrateNativeAudioSession: async () => ({
			sessionId: 'audio-session-1', state: audioState, backend: 'alsa', calibrationFrames: 0,
		}),
		closeNativeAudioSession: async ({ sessionId }: Readonly<{ sessionId: string }>) => {
			calls.push(['closeNativeAudioSession', sessionId]);
			return audio.delete(sessionId);
		},
		reviewNativePluginInstallation: async () => ({ entries: [] }),
		instantiateNativePlugin: async () => {
			plugins.add('plugin-instance-1');
			project.tracks[0]!.effects.push({ id: 'effect-1', bypassed: false });
			return pluginProjection();
		},
		runNativePluginOffline: async ({ instanceId }: Readonly<{ instanceId: string }>) => {
			if (!plugins.has(instanceId)) throw new Error('The authored effect is not active.');
			activity.push(`effect:${instanceId}`);
			return { instance: pluginProjection(), blocksRendered: 1, renderedSha256: 'a'.repeat(64) };
		},
		setNativePluginBypassed: async ({ bypassed }: Readonly<{ bypassed: boolean }>) => pluginProjection({ bypassed }),
		persistNativePluginState: async () => ({ outcome: { status: 'refused' }, projectState: null }),
		restoreNativePluginState: async () => ({ projectState: null }),
		openNativePluginVendorUi: async () => ({ status: 'refused' as const, code: 'unavailable' }),
		closeNativePluginVendorUi: async () => false,
		closeNativePluginInstance: async ({ instanceId }: Readonly<{ instanceId: string }>) => {
			calls.push(['closeNativePluginInstance', instanceId]);
			return plugins.delete(instanceId);
		},
	} as unknown as SoundscaperNativeServicesBridge;
	const renderer = {
		bridge,
		restoreProjectNativePlugins: async () => Object.freeze([]),
		dispose: async () => {
			for (const sessionId of [...audio]) await bridge.closeNativeAudioSession({ sessionId });
			for (const instanceId of [...plugins]) await bridge.closeNativePluginInstance({ instanceId });
		},
	};
	const engine = {} as EnginePublicApi;
	const controller = { project } as never;
	const documentValue = {
		createElement: () => ({ dataset: {}, remove() {} }),
		body: { append() {} },
		querySelector: () => null,
	} as unknown as Document;
	const root = { render() {}, unmount() {} };
	return {
		activity, baseBridge: bridge, calls, controller, documentValue, engine, project, renderer, root,
		active: () => ({ audio: [...audio], plugins: [...plugins] }),
		record: async () => {
			const sessionId = [...audio][0];
			if (!sessionId || audioState !== 'bound') throw new Error('Native recording input is unavailable.');
			activity.push(`record:${sessionId}`);
		},
		play: async () => {
			const sessionId = [...audio][0];
			if (!sessionId || audioState !== 'bound') throw new Error('Native playback output is unavailable.');
			activity.push(`play:${sessionId}`);
		},
	};
}

function audioRequest() {
	return Object.freeze({
		candidates: Object.freeze([{ backend: 'alsa' as const, deviceHandle: 'device-1' }]),
		direction: 'duplex' as const, mode: 'shared' as const, sampleRate: 48_000,
		periodFrames: 128, channelCount: 2,
	});
}

function pluginProjection(overrides: Readonly<Record<string, unknown>> = {}) {
	return Object.freeze({
		instanceId: 'plugin-instance-1', entryId: 'entry-1', stablePluginId: 'org.example.effect',
		format: 'clap', binarySha256: 'b'.repeat(64), inputChannels: 2, outputChannels: 2,
		state: 'hosted', enabled: true, bypassed: false, latencySamples: 0, ...overrides,
	});
}
