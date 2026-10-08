/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { normalizeRecordingRouting, setRecordingTrackRoute } from '../src/common/editor/recording-routing.js';
import {
	createEditorTrackService, type EditorTrackServiceDependencies,
} from '../src/common/editor/controller/track-audio/internal/track-service.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';

function fixture(channelCount: number, occupied: boolean) {
	let project = applyEditorCommand(createCurrentAudioEditorProject({ id: 'recording-channel', sampleRate: 48_000 }),
		{ type: 'track/add', track: { id: 'starter', name: 'Track 1', type: 'audio' } });
	let routing = normalizeRecordingRouting({ routes: occupied ? {
		starter: { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1 },
	} : {} }, project.tracks);
	const original = routing;
	const dependencies: EditorTrackServiceDependencies = {
		lifetime: { assertActive() {} },
		copy: { track: 'Track', labels: 'Labels', recordingDesktopAudio: 'Desktop audio',
			trackDestinationInvalid: 'Invalid destination', trackNotFound: 'Missing track',
			v2Required: 'Current project required', audioTrackRequired: 'Audio track required',
			unknownTrackDisplay: 'Unknown display' },
		trackColors: ['blue'], getProject: () => project as ControllerProject,
		getSelectedTrackId: () => 'starter', editingBlocked: () => false,
		createId: () => 'new-recording-track',
		commit: command => { project = applyEditorCommand(project, command); },
		getPositionFrames: () => 0, snapTimelineFrame: frame => frame, setTimelineView() {},
		recording: { defaultDeviceId: 'default', displaySourceKey: 'display',
			getRouting: () => routing, setRouting: value => { routing = value; },
			getPreferredDeviceId: () => 'default', getPreferredChannelCount: () => 1,
			getDevices: () => [{ deviceId: 'default', channelCount }], getPoolSources: () => [],
			setTrackRoute: setRecordingTrackRoute, setRouteHealth() {}, updateDeviceRows() {},
			persistRouting: async () => undefined, publish() {} },
	};
	return { service: createEditorTrackService(dependencies), getRouting: () => routing, original };
}

test('new recording tracks do not invent a second channel before a mono device has been discovered', () => {
	const harness = fixture(0, true);
	assert.equal(harness.service.addTrack({ armed: true }), 'new-recording-track');
	assert.equal(harness.getRouting().routes['new-recording-track'], undefined,
		'the explicit default-input recording path must not be redirected to an undiscovered input 2');
	assert.deepEqual(harness.getRouting(), harness.original, 'the existing assigned track retains its input');
});

test('an undiscovered device still assigns its first requested channel when no existing track owns it', () => {
	const harness = fixture(0, false);
	harness.service.addTrack({ armed: true });
	assert.equal(harness.getRouting().routes['new-recording-track']?.channelStart, 0);
});

test('known device widths retain actual second-channel assignment and mono exhaustion', () => {
	for (const channelCount of [1, 2, 8]) {
		const harness = fixture(channelCount, true);
		harness.service.addTrack({ armed: true });
		assert.equal(harness.getRouting().routes['new-recording-track']?.channelStart,
			channelCount === 1 ? undefined : 1);
		assert.deepEqual(harness.getRouting().routes.starter, harness.original.routes.starter);
	}
});
