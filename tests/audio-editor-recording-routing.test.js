import test from 'node:test';
import assert from 'node:assert/strict';

import {
	RECORDING_ROUTING_SETTING_PREFIX,
	assertRecordingRouteConflicts,
	normalizeRecordingRoute,
	normalizeRecordingRouting,
	normalizeRecordingSourceOffset,
	recordingChannelOptions,
	recordingRouteSourceKey,
	recordingRoutingSettingKey,
	setRecordingSourceOffset,
	setRecordingTrackRoute,
} from '../src/lib/tools/audio-editor/recording-routing.js';

const MONO_TRACK = Object.freeze({ type: 'audio', id: 'mono' });
const STEREO_TRACK = Object.freeze({ type: 'audio', id: 'stereo' });

function deviceRoute(deviceId, channelStart, channelCount = 1) {
	return { kind: 'device', deviceId, channelStart, channelCount };
}

test('recording routes normalize migration-era local values into the current immutable shape', () => {
	const routing = normalizeRecordingRouting({
		routes: {
			mono: {
				kind: 'device', deviceId: 'interface-a', deviceLabel: 42,
				channelStart: '2', channelCount: '1', obsolete: true,
			},
			stereo: {
				kind: 'display', channelStart: 12, channelCount: 2, label: 'Browser audio', obsolete: true,
			},
			legacy: { kind: 'device', deviceId: 'legacy-mic', channelStart: 0, channelCount: 1 },
		},
		offsets: { 'device:interface-a': '12.5', display: -800, '': 20 },
	}, [MONO_TRACK, STEREO_TRACK, { id: 'legacy' }]);

	assert.deepEqual(routing, {
		routes: {
			mono: {
				kind: 'device', deviceId: 'interface-a', deviceLabel: '42', channelStart: 2, channelCount: 1,
			},
			stereo: { kind: 'display', channelStart: 0, channelCount: 2, label: 'Browser audio' },
			legacy: {
				kind: 'device', deviceId: 'legacy-mic', deviceLabel: '', channelStart: 0, channelCount: 1,
			},
		},
		offsets: { 'device:interface-a': 12.5, display: -500 },
	});
	assert.equal(Object.isFrozen(routing), true);
	assert.equal(Object.isFrozen(routing.routes), true);
	assert.equal(Object.isFrozen(routing.routes.mono), true);
	assert.equal(Object.isFrozen(routing.offsets), true);
	assert.equal(recordingRouteSourceKey(routing.routes.mono), 'device:interface-a');
	assert.equal(recordingRouteSourceKey(routing.routes.stereo), 'display');
	assert.equal(
		normalizeRecordingRoute(deviceRoute(' opaque browser device ID ', 0), MONO_TRACK).deviceId,
		' opaque browser device ID ',
	);
});

test('normalizing local routes prunes deleted tracks, label tracks, malformed assignments, and stale conflicts', () => {
	const routing = normalizeRecordingRouting({
		routes: {
			mono: deviceRoute('interface-a', 0),
			stereo: deviceRoute('interface-a', 0, 2),
			malformed: deviceRoute('interface-a', -1),
			labels: deviceRoute('interface-a', 3),
			deleted: deviceRoute('interface-b', 0),
		},
	}, [
		MONO_TRACK,
		STEREO_TRACK,
		{ type: 'audio', id: 'malformed' },
		{ type: 'label', id: 'labels' },
	]);

	// The first valid persisted assignment wins; a duplicate from older local
	// state is discarded rather than preventing the project from opening.
	assert.deepEqual(Object.keys(routing.routes), ['mono']);
	assert.equal(assertRecordingRouteConflicts(routing.routes), true);

	const afterDeletion = normalizeRecordingRouting(routing, [STEREO_TRACK]);
	assert.deepEqual(afterDeletion.routes, {});
});

test('recording channel options use persisted route width instead of track format', () => {
	const monoRoutes = { mono: deviceRoute('interface-a', 0, 1) };
	const stereoRoutes = { stereo: deviceRoute('interface-a', 0, 2) };
	assert.deepEqual(recordingChannelOptions(MONO_TRACK, 5, monoRoutes), [
		{ channelStart: 0, channelCount: 1, disabled: false },
		{ channelStart: 1, channelCount: 1, disabled: false },
		{ channelStart: 2, channelCount: 1, disabled: false },
		{ channelStart: 3, channelCount: 1, disabled: false },
		{ channelStart: 4, channelCount: 1, disabled: false },
	]);
	assert.deepEqual(recordingChannelOptions(STEREO_TRACK, 5, stereoRoutes), [
		{ channelStart: 0, channelCount: 2, disabled: false },
		{ channelStart: 2, channelCount: 2, disabled: false },
	]);
	assert.deepEqual(recordingChannelOptions(STEREO_TRACK, 1, stereoRoutes), []);
	assert.deepEqual(recordingChannelOptions(MONO_TRACK, 0, monoRoutes), []);
});

test('channel options and route setters prevent overlap on one source without blocking another device', () => {
	const stereo = { ...STEREO_TRACK, id: 'stereo-current' };
	const routes = {
		'stereo-current': deviceRoute('interface-a', 2, 2),
		'mono-a': deviceRoute('interface-a', 0),
		'mono-b': deviceRoute('interface-b', 1),
	};
	assert.deepEqual(recordingChannelOptions(stereo, 4, routes), [
		{ channelStart: 0, channelCount: 2, disabled: true },
		{ channelStart: 2, channelCount: 2, disabled: false },
	]);

	let routing = setRecordingTrackRoute({}, STEREO_TRACK, deviceRoute('interface-a', 0, 2));
	assert.throws(
		() => setRecordingTrackRoute(routing, MONO_TRACK, deviceRoute('interface-a', 1)),
		/already assigned to track stereo/,
	);
	routing = setRecordingTrackRoute(routing, MONO_TRACK, deviceRoute('interface-a', 2));
	routing = setRecordingTrackRoute(routing, { ...MONO_TRACK, id: 'other-device' }, deviceRoute('interface-b', 0));
	assert.deepEqual(Object.keys(routing.routes), ['stereo', 'mono', 'other-device']);
	assert.throws(
		() => normalizeRecordingRoute(deviceRoute('interface-a', 1, 2), STEREO_TRACK),
		/must begin on an adjacent odd-numbered input pair/,
	);

	const cleared = setRecordingTrackRoute(routing, STEREO_TRACK, null);
	assert.equal(cleared.routes.stereo, undefined);
	assert.equal(routing.routes.stereo.channelStart, 0);
});

test('manual recording latency offsets remain independent per source and clamp to the supported range', () => {
	assert.equal(normalizeRecordingSourceOffset('-18.75'), -18.75);
	assert.equal(normalizeRecordingSourceOffset(-501), -500);
	assert.equal(normalizeRecordingSourceOffset(900), 500);
	assert.equal(normalizeRecordingSourceOffset('not-a-number'), 0);

	const initial = Object.freeze({
		routes: Object.freeze({ mono: Object.freeze(deviceRoute('interface-a', 0)) }),
		offsets: Object.freeze({ display: 8 }),
	});
	const hardwareAdjusted = setRecordingSourceOffset(initial, 'device:interface-a', 23.25);
	const desktopAdjusted = setRecordingSourceOffset(hardwareAdjusted, 'display', -12);
	assert.deepEqual(desktopAdjusted.offsets, {
		display: -12,
		'device:interface-a': 23.25,
	});
	assert.equal(initial.offsets.display, 8);
	assert.equal(desktopAdjusted.routes.mono, initial.routes.mono);
	assert.throws(() => setRecordingSourceOffset(initial, ' ', 10), /source key is required/);
});

test('recording route storage keys are project-specific and reject missing project IDs', () => {
	assert.equal(recordingRoutingSettingKey('project-a'), `${RECORDING_ROUTING_SETTING_PREFIX}project-a`);
	assert.equal(recordingRoutingSettingKey('project-b'), `${RECORDING_ROUTING_SETTING_PREFIX}project-b`);
	assert.notEqual(recordingRoutingSettingKey('project-a'), recordingRoutingSettingKey('project-b'));
	assert.throws(() => recordingRoutingSettingKey(''), /project ID is required/);
	assert.throws(() => recordingRoutingSettingKey('   '), /project ID is required/);
});
