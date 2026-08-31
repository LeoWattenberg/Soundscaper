/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createRecordingInputCoordinationService,
	type RecordingDeviceInputRoute,
	type RecordingInputCoordinationRuntime,
	type RecordingInputCoordinationState,
	type RecordingInputRoute,
	type RecordingPoolSource,
} from '../src/common/editor/controller/recording-input-coordination-service.ts';

interface FixtureOptions {
	readonly acquireDisplay?: () => Promise<unknown>;
	readonly acquireHardware?: (
		deviceId: string,
		options: Readonly<{ channelCount: number; sampleRate: number }>,
	) => Promise<unknown>;
	readonly persistRouting?: () => Promise<unknown>;
	readonly streamChannels?: (stream: unknown) => number;
	readonly assertCurrent?: () => void;
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}

function deviceRoute(
	deviceId: string,
	channelStart = 0,
	channelCount = 1,
): RecordingDeviceInputRoute {
	return { kind: 'device', deviceId, channelStart, channelCount };
}

function displayRoute(channelCount = 2): RecordingInputRoute {
	return { kind: 'display', channelStart: 0, channelCount };
}

function source(
	key: string,
	kind: RecordingPoolSource['kind'],
	channelCount: number,
	deviceId?: string,
): RecordingPoolSource {
	return { key, kind, channelCount, ...(deviceId ? { deviceId } : {}) };
}

function createFixture(options: FixtureOptions = {}) {
	const events: string[] = [];
	const stopMeterOptions: Array<Readonly<{ releaseInput?: boolean }>> = [];
	const hardwareRequests: Array<Readonly<{
		deviceId: string;
		channelCount: number;
		sampleRate: number;
	}>> = [];
	const state: RecordingInputCoordinationState = {
		disposed: false,
		microphoneMetering: false,
		recorder: null,
		recordingPoolSources: [],
		recordingRouteHealth: {},
		recordingRouting: { routes: {}, offsets: {} },
		selectedTrackId: 'track-a',
		timedRecording: null,
		timedRecordingPreparing: false,
	};
	let meterGeneration = 0;
	let meterRestartGeneration: number | null = null;
	let meterReconciliations = 0;
	let routedMeterClears = 0;
	let releases = 0;
	let synchronizations = 0;
	let timedCancellations = 0;
	const getMeterRoute = () => {
		const selected = state.selectedTrackId
			? state.recordingRouting.routes[state.selectedTrackId]
			: null;
		const route = selected?.kind === 'device'
			? selected
			: Object.values(state.recordingRouting.routes).find((candidate) => candidate.kind === 'device');
		return route?.kind === 'device'
			? route
			: deviceRoute('default');
	};
	const runtime: RecordingInputCoordinationRuntime = {
		state,
		captureOperation: () => ({ assertCurrent: options.assertCurrent ?? (() => undefined) }),
		capturePool: {
			acquireDisplay: async () => {
				events.push('acquire-display');
				return options.acquireDisplay?.() ?? { channelCount: 2 };
			},
			acquireHardware: async (deviceId, request) => {
				events.push(`acquire:${deviceId}`);
				hardwareRequests.push({ deviceId, ...request });
				return options.acquireHardware?.(deviceId, request) ?? { channelCount: request.channelCount };
			},
		},
		meter: {
			clearRoutedLoudnessMeter: () => {
				events.push('clear-routed-meter');
				routedMeterClears += 1;
			},
			getRoute: getMeterRoute,
			getRouteKey: (route = getMeterRoute()) => (
				`${route.deviceId}:${route.channelStart}:${route.channelCount}`
			),
			invalidate: () => {
				events.push('invalidate-meter');
				meterGeneration += 1;
				meterRestartGeneration = meterGeneration;
				return meterGeneration;
			},
			isGeneration: (generation) => generation === meterGeneration,
			reconcileInput: () => {
				events.push(`reconcile-meter:${state.recordingPoolSources.map((entry) => entry.key).join(',')}`);
				meterReconciliations += 1;
				return true;
			},
			setMicrophoneMetering: async () => {
				events.push('restart-meter');
				return true;
			},
			stopMicrophoneMetering: (stopOptions = {}) => {
				events.push('stop-meter');
				stopMeterOptions.push(stopOptions);
			},
		},
		routing: {
			persistRecordingRouting: () => {
				events.push('persist-routing');
				return options.persistRouting?.() ?? Promise.resolve();
			},
			releaseUnretainedRecordingInputs: () => {
				events.push('release-unretained');
				releases += 1;
				return true;
			},
			syncRecordingPoolSnapshot: () => {
				events.push('sync-pool');
				synchronizations += 1;
			},
			updateRecordingDeviceRows: () => {
				events.push(`update-devices:${state.recordingPoolSources.map((entry) => entry.key).join(',')}`);
			},
		},
		cancelTimedRecording: () => {
			events.push('cancel-timed');
			timedCancellations += 1;
		},
		getTrack: (trackId) => ({ id: trackId, type: 'audio' }),
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot: () => { events.push('publish'); },
		recordingRouteSourceKey: (route) => (
			route.kind === 'display' ? 'display' : `device:${route.deviceId}`
		),
		setRecordingTrackRoute: (routing, track, requestedRoute) => {
			if (!track) throw new TypeError('missing track');
			const routes = { ...routing.routes };
			if (requestedRoute == null) delete routes[track.id];
			else routes[track.id] = requestedRoute;
			return { routes: Object.freeze(routes), offsets: routing.offsets };
		},
		streamAudioChannelCount: (stream) => (
			options.streamChannels?.(stream)
			?? (Number((stream as Readonly<{ channelCount?: number }>).channelCount) || 0)
		),
	};
	return {
		events,
		hardwareRequests,
		runtime,
		service: createRecordingInputCoordinationService(runtime),
		state,
		stopMeterOptions,
		get meterGeneration() { return meterGeneration; },
		get meterRestartGeneration() { return meterRestartGeneration; },
		get meterReconciliations() { return meterReconciliations; },
		get releases() { return releases; },
		get routedMeterClears() { return routedMeterClears; },
		get synchronizations() { return synchronizations; },
		get timedCancellations() { return timedCancellations; },
	};
}

test('track input assignment persists before acquisition and reconciles pool cleanup in order', async () => {
	const fixture = createFixture();
	const route = deviceRoute('interface', 2, 2);

	assert.equal(await fixture.service.setRecordingTrackInput('track-a', route), route);
	assert.equal(fixture.state.recordingRouteHealth['track-a'], 'open');
	assert.equal(fixture.routedMeterClears, 1);
	assert.deepEqual(fixture.hardwareRequests, [{
		deviceId: 'interface', channelCount: 4, sampleRate: 48_000,
	}]);
	assert.equal(fixture.synchronizations, 2);
	assert.equal(fixture.releases, 1);
	assert.deepEqual(fixture.events, [
		'clear-routed-meter',
		'update-devices:',
		'publish',
		'persist-routing',
		'acquire:interface',
		'sync-pool',
		'release-unretained',
		'sync-pool',
		'update-devices:',
		'publish',
	]);
});

test('display assignment uses display acquisition and reports insufficient device channels as unavailable', async () => {
	const display = createFixture();
	assert.deepEqual(
		await display.service.setRecordingTrackInput('track-b', displayRoute()),
		displayRoute(),
	);
	assert.equal(display.state.recordingRouteHealth['track-b'], 'open');
	assert.deepEqual(display.hardwareRequests, []);
	assert.equal(display.events.includes('acquire-display'), true);

	const insufficient = createFixture({ streamChannels: () => 2 });
	await insufficient.service.setRecordingTrackInput('track-a', deviceRoute('small', 1, 2));
	assert.equal(insufficient.state.recordingRouteHealth['track-a'], 'unavailable');
});

test('denied acquisition retains the route pin and required persistence failures propagate', async () => {
	const denied = createFixture({
		acquireHardware: async () => { throw new Error('permission denied'); },
	});
	const route = deviceRoute('denied');
	assert.equal(await denied.service.setRecordingTrackInput('track-a', route), route);
	assert.equal(denied.state.recordingRouting.routes['track-a'], route);
	assert.equal(denied.state.recordingRouteHealth['track-a'], 'unavailable');
	assert.equal(denied.synchronizations, 0);
	assert.equal(denied.releases, 0);

	const persistenceError = new Error('required persistence failed');
	const failedPersistence = createFixture({
		persistRouting: async () => { throw persistenceError; },
	});
	await assert.rejects(
		failedPersistence.service.setRecordingTrackInput('track-a', null),
		(error) => error === persistenceError,
	);
	assert.equal(failedPersistence.state.recordingRouting.routes['track-a'], undefined);
});

test('timed recording preparation freezes route mutation without persistence or acquisition', async () => {
	const fixture = createFixture();
	const original = deviceRoute('prepared');
	fixture.state.recordingRouting = { routes: { 'track-a': original }, offsets: {} };
	fixture.state.timedRecordingPreparing = true;

	assert.equal(
		await fixture.service.setRecordingTrackInput('track-a', deviceRoute('ignored')),
		original,
	);
	assert.deepEqual(fixture.events, []);

	fixture.state.timedRecordingPreparing = false;
	fixture.state.timedRecording = {};
	assert.equal(await fixture.service.setRecordingTrackInput('missing', null), null);
	assert.deepEqual(fixture.events, []);
});

test('late input acquisition after disposal cannot publish or restart metering', async () => {
	const opened = deferred<unknown>();
	let current = true;
	const fixture = createFixture({
		acquireHardware: () => opened.promise,
		assertCurrent: () => {
			if (!current) throw new DOMException('Controller disposed.', 'AbortError');
		},
	});
	fixture.state.microphoneMetering = true;
	const assignment = fixture.service.setRecordingTrackInput('track-a', deviceRoute('late'));
	await new Promise<void>((resolve) => setImmediate(resolve));
	current = false;
	fixture.state.disposed = true;
	opened.resolve({ channelCount: 1 });

	await assert.rejects(assignment, { name: 'AbortError' });
	assert.equal(fixture.state.recordingRouteHealth['track-a'], 'unavailable');
	assert.equal(fixture.events.filter((event) => event === 'publish').length, 1);
	assert.equal(fixture.events.includes('restart-meter'), false);
});

test('a replaced route owns the final health state when the older acquisition finishes late', async () => {
	const first = deferred<unknown>();
	const fixture = createFixture({
		acquireHardware: (deviceId) => (
			deviceId === 'first' ? first.promise : Promise.resolve({ channelCount: 1 })
		),
	});
	const stale = fixture.service.setRecordingTrackInput('track-a', deviceRoute('first', 0, 2));
	await new Promise<void>((resolve) => setImmediate(resolve));
	const replacement = deviceRoute('second');
	assert.equal(await fixture.service.setRecordingTrackInput('track-a', replacement), replacement);
	first.resolve({ channelCount: 1 });

	await assert.rejects(stale, { name: 'AbortError' });
	assert.equal(fixture.state.recordingRouting.routes['track-a'], replacement);
	assert.equal(fixture.state.recordingRouteHealth['track-a'], 'open');
});

test('eager route persistence stays observed when an assignment is superseded', async () => {
	const firstAcquisition = deferred<unknown>();
	const firstPersistence = deferred<unknown>();
	let persistenceCalls = 0;
	let rejectionObservers = 0;
	const originalCatch = firstPersistence.promise.catch.bind(firstPersistence.promise);
	firstPersistence.promise.catch = ((onRejected) => {
		rejectionObservers += 1;
		return originalCatch(onRejected);
	}) as typeof firstPersistence.promise.catch;
	const fixture = createFixture({
		acquireHardware: (deviceId) => deviceId === 'first'
			? firstAcquisition.promise : Promise.resolve({ channelCount: 1 }),
		persistRouting: () => ++persistenceCalls === 1
			? firstPersistence.promise : Promise.resolve(),
	});
	const stale = fixture.service.setRecordingTrackInput('track-a', deviceRoute('first'));
	await new Promise<void>((resolve) => setImmediate(resolve));
	await fixture.service.setRecordingTrackInput('track-a', deviceRoute('second'));
	firstAcquisition.resolve({ channelCount: 1 });
	firstPersistence.resolve(undefined);

	await assert.rejects(stale, { name: 'AbortError' });
	assert.equal(rejectionObservers, 1);
});

test('meter route changes stop and restart the meter without releasing a reused device', async () => {
	const fixture = createFixture();
	fixture.state.microphoneMetering = true;
	fixture.state.recordingRouting = {
		routes: { 'track-a': deviceRoute('interface', 0, 1) },
		offsets: {},
	};

	await fixture.service.setRecordingTrackInput('track-a', deviceRoute('interface', 1, 1));
	assert.equal(fixture.meterGeneration, 1);
	assert.equal(fixture.meterRestartGeneration, 1);
	assert.deepEqual(fixture.stopMeterOptions, [{ releaseInput: false }]);
	assert.equal(fixture.events.includes('restart-meter'), true);

	const replacement = createFixture();
	replacement.state.microphoneMetering = true;
	replacement.state.recordingRouting = {
		routes: { 'track-a': deviceRoute('first') },
		offsets: {},
	};
	await replacement.service.setRecordingTrackInput('track-a', deviceRoute('second'));
	assert.deepEqual(replacement.stopMeterOptions, [{ releaseInput: true }]);
});

test('pool changes publish a fully reconciled snapshot and preserve disconnected health', () => {
	const fixture = createFixture();
	fixture.state.recordingRouting = {
		routes: {
			available: deviceRoute('interface', 0, 2),
			tooWide: deviceRoute('interface', 1, 2),
			ended: deviceRoute('ended'),
			display: displayRoute(),
		},
		offsets: {},
	};
	fixture.state.recordingRouteHealth = {
		available: 'unavailable',
		tooWide: 'open',
		ended: 'disconnected',
		display: 'unavailable',
	};
	const snapshot = [
		source('device:interface', 'device', 2, 'interface'),
		source('display', 'display', 1),
	];

	fixture.service.handleRecordingPoolChange(snapshot);

	assert.equal(Object.isFrozen(fixture.state.recordingPoolSources), true);
	assert.deepEqual(fixture.state.recordingPoolSources, snapshot);
	assert.deepEqual(fixture.state.recordingRouteHealth, {
		available: 'open',
		tooWide: 'skipped',
		ended: 'disconnected',
		display: 'open',
	});
	assert.equal(fixture.meterReconciliations, 1);
	assert.deepEqual(fixture.events, [
		'update-devices:device:interface,display',
		'reconcile-meter:device:interface,display',
		'publish',
	]);

	fixture.state.recorder = {};
	fixture.state.recordingRouteHealth.available = 'recording';
	fixture.service.handleRecordingPoolChange(null);
	assert.equal(fixture.state.recordingRouteHealth.available, 'recording');

	fixture.state.disposed = true;
	fixture.service.handleRecordingPoolChange([]);
	assert.equal(fixture.events.at(-1), 'reconcile-meter:');
});

test('losing a prepared timed input cancels immediately before device or meter reconciliation', () => {
	const fixture = createFixture();
	fixture.state.timedRecording = { inputKeys: ['device:prepared', 'display'] };

	fixture.service.handleRecordingPoolChange([
		source('device:prepared', 'device', 2, 'prepared'),
	]);

	assert.equal(fixture.timedCancellations, 1);
	assert.deepEqual(fixture.events, ['cancel-timed']);
	assert.deepEqual(
		fixture.state.recordingPoolSources.map((entry) => entry.key),
		['device:prepared'],
	);

	fixture.events.length = 0;
	fixture.state.timedRecording = { inputKeys: [] };
	fixture.service.handleRecordingPoolChange([]);
	assert.deepEqual(fixture.events, ['update-devices:', 'reconcile-meter:', 'publish']);
});
