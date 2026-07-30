/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EditorControllerLifetime,
	isEditorDisposedError,
} from '../src/common/editor/controller/lifecycle.ts';
import {
	createProjectBootstrapService,
	type ProjectBootstrapServiceRuntime,
} from '../src/common/editor/controller/project-bootstrap-service.ts';

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

interface TestProject {
	readonly id: string;
	readonly tracks: readonly Readonly<{ id: string; type: string }>[];
}

interface TestPreferences {
	readonly loaded: boolean;
}

interface TestPresets {
	readonly source: unknown;
}

function createFixture() {
	const lifetime = new EditorControllerLifetime();
	const settings = new Map<string, unknown>();
	let ready: () => PromiseLike<unknown> | unknown = () => Promise.resolve();
	let lastProjectId: string | null = null;
	let savedProject: TestProject | null = null;
	let loadProject: (
		projectId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	) => Promise<TestProject | null> = async () => savedProject;
	let openProject: (value: TestProject) => Promise<unknown> = async () => undefined;
	let missingSources = false;
	let removeDeviceListener: () => void = () => undefined;
	let deviceListener: (() => void) | null = null;
	let disposed = false;
	const events: string[] = [];
	const statuses: Array<readonly [string, string]> = [];
	const errors: unknown[] = [];
	const state = {
		preferences: { loaded: false },
		effectPresets: { source: 'initial' },
		monitoring: false,
		microphoneMetering: false,
		recordingInputGain: 0,
		latencyOffsetMs: 0,
		leadInRecording: false,
		showRms: false,
		showVerticalRulers: true,
		updateDisplayWhilePlaying: true,
		pinnedPlayhead: false,
		playbackOnRulerClick: true,
		metronomeEnabled: false,
		selectionFollowsLoop: false,
		preferredInputDeviceId: '',
		preferredInputChannelCount: 1,
		preferredOutputDeviceId: '',
		readOnly: false,
	};
	const runtime: ProjectBootstrapServiceRuntime<TestProject, TestPreferences, TestPresets> = {
		state,
		lifetimeSignal: lifetime.signal,
		store: {
			ready: () => ready(),
			cleanupTemporaryAssets: () => { events.push('cleanup-assets'); },
			requestPersistentStorage: () => { events.push('request-persistence'); },
			async loadSetting(key, fallback) {
				events.push(`load:${key}`);
				return settings.has(key) ? settings.get(key) : fallback;
			},
			async loadProject(
				projectId: string,
				options: Readonly<{ signal?: AbortSignal }> = {},
			) {
				events.push(`load-project:${projectId}`);
				return loadProject(projectId, options);
			},
		},
		engine: {
			loadProject() {},
			setOutputDevice: (deviceId) => { events.push(`output:${deviceId}`); },
		},
		mediaDevices: {
			addEventListener(_type, listener) {
				deviceListener = listener;
				events.push('listen-devices');
			},
			removeEventListener() { events.push('unlisten-devices'); },
		},
		productSettingKey: (key) => `product:${key}`,
		audioDevicePreferencesSettingKey: 'audio-devices',
		recordingInputGainDefault: 1,
		loadPreferences: async (token) => {
			await lifetime.guard(Promise.resolve(), token);
			state.preferences = { loaded: true };
			events.push('load-preferences');
		},
		createEffectPresets: (value = 'default') => ({ source: value }),
		normalizeRecordingInputGain: (value) => Number(value),
		normalizeLatencyOffset: (value) => Number(value),
		normalizeAudioDevicePreferences: (value) => {
			const record = value as Readonly<Record<string, unknown>> | null;
			return {
				inputDeviceId: String(record?.inputDeviceId ?? ''),
				inputChannelCount: Number(record?.inputChannelCount ?? 1),
				outputDeviceId: String(record?.outputDeviceId ?? ''),
			};
		},
		refreshAudioDevices: async (options) => { events.push(`refresh-devices:${String(options.publish)}`); },
		setRemoveDeviceChangeListener: (remove) => { removeDeviceListener = remove; },
		loadRecentProjectState: async () => lastProjectId,
		openProject: (value) => openProject(value),
		newProject: async () => { events.push('new-project'); },
		publishProjectState: () => { events.push('publish'); },
		saveNow: async () => { events.push('save-now'); },
		refreshStorageUsage: async () => { events.push('storage-usage'); },
		hasMissingTimelineSources: () => missingSources,
		setStatus: (message, status) => { statuses.push([message, status]); },
		handleError: (error) => { errors.push(error); },
		isDisposed: () => disposed,
		isDisposedError: (error) => isEditorDisposedError(error),
		guard: (value, token) => lifetime.guard(value, token),
		copy: {
			webAudioUnsupported: 'Web Audio unavailable',
			missingSourcesBlocked: 'Missing sources',
			ready: 'Ready',
		},
	};
	return {
		deviceChange() { deviceListener?.(); },
		errors,
		events,
		lifetime,
		removeDeviceListener: () => removeDeviceListener(),
		service: createProjectBootstrapService(runtime),
		settings,
		state,
		statuses,
		setDisposed(value: boolean) { disposed = value; },
		setLastProject(value: string | null, loaded: TestProject | null) {
			lastProjectId = value;
			savedProject = loaded;
		},
		setMissingSources(value: boolean) { missingSources = value; },
		setLoadProject(value: typeof loadProject) { loadProject = value; },
		setOpenProject(value: typeof openProject) { openProject = value; },
		setReady(value: typeof ready) { ready = value; },
	};
}

test('bootstrap applies settings before opening the saved project', async () => {
	const fixture = createFixture();
	const saved = { id: 'saved-project', tracks: [] };
	fixture.setLastProject(saved.id, saved);
	fixture.setOpenProject(async (value) => { fixture.events.push(`open-project:${value.id}`); });
	fixture.settings.set('audio-editor-effect-presets-v1', { presets: ['one'] });
	fixture.settings.set('input-monitor', true);
	fixture.settings.set('microphone-metering', true);
	fixture.settings.set('recording-input-gain', 1.5);
	fixture.settings.set('recording-latency-offset-ms', 42);
	fixture.settings.set('recording-lead-in', true);
	fixture.settings.set('product:waveform-show-rms', true);
	fixture.settings.set('product:timeline-show-vertical-rulers', false);
	fixture.settings.set('product:audio-devices', {
		inputDeviceId: 'mic-a', inputChannelCount: 2, outputDeviceId: 'output-a',
	});

	await fixture.service.bootstrap(fixture.lifetime.capture());

	assert.equal(fixture.state.preferences.loaded, true);
	assert.equal(fixture.state.monitoring, true);
	assert.equal(fixture.state.recordingInputGain, 1.5);
	assert.equal(fixture.state.latencyOffsetMs, 42);
	assert.equal(fixture.state.showVerticalRulers, false);
	assert.equal(fixture.state.preferredInputChannelCount, 2);
	assert.ok(fixture.events.indexOf('output:output-a') < fixture.events.indexOf('open-project:saved-project'));
	assert.ok(fixture.events.includes('listen-devices'));
	assert.ok(fixture.events.includes('save-now'));
	assert.deepEqual(fixture.statuses.at(-1), ['Ready', 'success']);

	fixture.deviceChange();
	await Promise.resolve();
	assert.equal(fixture.events.filter((event) => event.startsWith('refresh-devices:')).length, 2);
	fixture.removeDeviceListener();
	assert.ok(fixture.events.includes('unlisten-devices'));
});

test('terminal disposal during store readiness prevents later resource acquisition', async () => {
	const fixture = createFixture();
	const ready = deferred<void>();
	fixture.setReady(() => ready.promise);
	const bootstrap = fixture.service.bootstrap(fixture.lifetime.capture());

	fixture.lifetime.beginDisposal();
	fixture.setDisposed(true);
	ready.resolve();

	await assert.rejects(() => bootstrap, { code: 'DISPOSED' });
	assert.equal(fixture.events.includes('cleanup-assets'), false);
	assert.equal(fixture.events.includes('listen-devices'), false);
	assert.equal(fixture.events.includes('new-project'), false);
	assert.equal(fixture.events.includes('publish'), false);
});

test('terminal disposal aborts the saved-project load before project activation', async () => {
	const fixture = createFixture();
	const saved = { id: 'saved-project', tracks: [] };
	const loadStarted = deferred<void>();
	const loadGate = deferred<TestProject | null>();
	let loadSignal: AbortSignal | undefined;
	fixture.setLastProject(saved.id, saved);
	fixture.setOpenProject(async (value) => { fixture.events.push(`open-project:${value.id}`); });
	fixture.setLoadProject(async (projectId, options) => {
		assert.equal(projectId, saved.id);
		loadSignal = options?.signal;
		loadStarted.resolve();
		const signal = loadSignal;
		if (!signal) return loadGate.promise;
		return new Promise<TestProject | null>((resolve, reject) => {
			signal.addEventListener('abort', () => { reject(signal.reason); }, { once: true });
			void loadGate.promise.then(resolve, reject);
		});
	});
	const bootstrap = fixture.service.bootstrap(fixture.lifetime.capture());
	await loadStarted.promise;

	fixture.lifetime.beginDisposal();
	fixture.setDisposed(true);
	loadGate.resolve(saved);

	await assert.rejects(() => bootstrap, { code: 'DISPOSED' });
	assert.equal(loadSignal, fixture.lifetime.signal);
	assert.equal(loadSignal?.aborted, true);
	assert.equal(fixture.events.includes('open-project:saved-project'), false);
	assert.equal(fixture.events.includes('new-project'), false);
	assert.equal(fixture.events.includes('publish'), false);
	assert.equal(fixture.events.includes('save-now'), false);
});

test('a late project-open completion cannot publish bootstrap readiness', async () => {
	const fixture = createFixture();
	const saved = { id: 'saved-project', tracks: [] };
	const openStarted = deferred<void>();
	const openGate = deferred<void>();
	fixture.setLastProject(saved.id, saved);
	fixture.setOpenProject(async () => {
		openStarted.resolve();
		await openGate.promise;
	});
	const bootstrap = fixture.service.bootstrap(fixture.lifetime.capture());
	await openStarted.promise;

	fixture.lifetime.beginDisposal();
	fixture.setDisposed(true);
	openGate.resolve();

	await assert.rejects(() => bootstrap, { code: 'DISPOSED' });
	assert.equal(fixture.events.includes('publish'), false);
	assert.equal(fixture.events.includes('save-now'), false);
	assert.equal(fixture.events.includes('storage-usage'), false);
});

test('missing source state remains a visible bootstrap error', async () => {
	const fixture = createFixture();
	fixture.setMissingSources(true);
	await fixture.service.bootstrap(fixture.lifetime.capture());
	assert.deepEqual(fixture.statuses.at(-1), ['Missing sources', 'error']);
});
