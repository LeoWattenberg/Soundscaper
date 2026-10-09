/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/recording/internal/legacy-recording-capture-service.ts';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { focusedRecordingTrackId, hasLockedRecordingTarget } from '../src/common/editor/controller/recording/recording-target-admission.ts';
import type { RecordingTrack } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import TransportToolbarGroup from '../src/common/editor/ui/toolbar/TransportToolbarGroup.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createRecordingCaptureFixture, createScope } from './fixtures/recording-capture-fixture.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

for (const owner of ['legacy', 'routed'] as const) for (const explicit of [false, true]) {
	test(`${owner} refuses a locked ${explicit ? 'explicit' : 'armed'} target before native input acquisition`, async () => {
		const fixture = createRecordingCaptureFixture();
		const tracks = fixture.project.tracks.map(track => ({ ...track, locked: track.id === 'track-1' }));
		(fixture.project as { tracks: readonly RecordingTrack[] }).tracks = tracks;
		fixture.state.recordingRouting = { routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		}, offsets: {} };
		const capture = owner === 'legacy' ? createLegacyRecordingCaptureService(fixture.runtime)
			: createRoutedRecordingCaptureService(fixture.runtime);
		await assert.rejects(capture.capture(explicit ? { trackId: 'track-1' } : {}, createScope(() => true)), /Track track-1 is locked\./u);
		assert.equal(fixture.hardwareRequests(), 0);
		assert.equal(fixture.recorderCreations(), 0);
		assert.equal(fixture.publishes(), 0);
		assert.equal(fixture.state.recordingStarting, false);
		assert.equal(fixture.state.recorder, null);
		assert.equal(fixture.project.tracks, tracks);
	});
}

for (const owner of ['legacy', 'routed'] as const) test(`${owner} records an explicit unlocked target beside a locked track`, async () => {
	const fixture = createRecordingCaptureFixture();
	(fixture.project as { tracks: readonly RecordingTrack[] }).tracks = fixture.project.tracks
		.map(track => ({ ...track, locked: track.id === 'track-1' }));
	fixture.state.recordingRouting = { routes: {
		'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		'track-2': { kind: 'device', deviceId: 'mic', channelStart: 1, channelCount: 1 },
	}, offsets: {} };
	const capture = owner === 'legacy' ? createLegacyRecordingCaptureService(fixture.runtime)
		: createRoutedRecordingCaptureService(fixture.runtime);
	await capture.capture({ trackId: 'track-2' }, createScope(() => true));
	assert.equal(fixture.recorderCreations(), 1);
	assert.equal(fixture.hardwareRequests(), 1);
	assert.equal(fixture.state.recordingTrackId ?? fixture.state.recordingEntries?.[0]?.trackId, 'track-2');
});

test('routed recording skips a locked unassigned track and records its assigned unlocked companion', async () => {
	const fixture = createRecordingCaptureFixture();
	(fixture.project as { tracks: readonly RecordingTrack[] }).tracks = fixture.project.tracks
		.map(track => ({ ...track, locked: track.id === 'track-2' }));
	fixture.state.recordingRouting = { routes: {
		'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
	}, offsets: {} };
	await createRoutedRecordingCaptureService(fixture.runtime).capture({}, createScope(() => true));
	assert.equal(fixture.recorderCreations(), 1);
	assert.equal(fixture.state.recordingEntries?.[0]?.trackId, 'track-1');
	assert.equal(fixture.state.recordingRouteHealth['track-2'], 'skipped');
});

test('routed recording refuses the complete target set before capturing its unlocked companion', async () => {
	const fixture = createRecordingCaptureFixture();
	(fixture.project as { tracks: readonly RecordingTrack[] }).tracks = fixture.project.tracks
		.map(track => ({ ...track, locked: track.id === 'track-2' }));
	fixture.state.recordingRouting = { routes: {
		'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		'track-2': { kind: 'display', channelStart: 0, channelCount: 2 },
	}, offsets: {} };
	await assert.rejects(createRoutedRecordingCaptureService(fixture.runtime).capture({}, createScope(() => true)), /Track track-2 is locked\./u);
	assert.equal(fixture.hardwareRequests(), 0);
	assert.equal(fixture.displayRequests(), 0);
	assert.equal(fixture.recorderCreations(), 0);
	assert.equal(fixture.publishes(), 0);
});

test('record target projection retains focused, paired-video and multitrack authorities', () => {
	const project = { id: 'project', tracks: [
		{ id: 'first', type: 'audio', armed: true },
		{ id: 'camera', type: 'video', laneGroupId: 'camera-pair' },
		{ id: 'camera-audio', type: 'audio', laneGroupId: 'camera-pair', locked: true },
		{ id: 'assigned', type: 'audio', armed: true, locked: true },
	] };
	assert.equal(focusedRecordingTrackId(project, 'camera', false), 'camera-audio');
	assert.equal(focusedRecordingTrackId(project, 'assigned', false), 'assigned');
	assert.equal(focusedRecordingTrackId(project, null, false), 'first');
	assert.equal(focusedRecordingTrackId(project, 'camera', true), undefined);
	assert.equal(hasLockedRecordingTarget(project, 'camera-audio', {}), true);
	assert.equal(hasLockedRecordingTarget(project, 'first', { assigned: {} }), false);
	assert.equal(hasLockedRecordingTarget(project, undefined, { first: {} }), false);
	assert.equal(hasLockedRecordingTarget(project, undefined, { assigned: {} }), true);
});

for (const { locked, recording, disabled } of [
	{ locked: true, recording: false, disabled: true },
	{ locked: false, recording: false, disabled: false },
	{ locked: true, recording: true, disabled: false },
]) test(`record primary availability locked=${String(locked)} recording=${String(recording)} preserves new-track options`, () => {
	const markup = renderToStaticMarkup(React.createElement(TransportToolbarGroup, {
		buttons: ['record'], blocked: false, capabilities: { audioRecording: true }, controller: {},
		copy: ENGLISH_COPY, locale: 'en', onJumpToEnd() {}, onJumpToStart() {},
		onOpenTakeCycleRecovery() {}, onOpenTimedRecording() {}, recordLabel: ENGLISH_COPY.record,
		recordingTargetLocked: locked, run() {}, toggleRecording() {}, toolbarButtons: {},
		snapshot: { productId: 'soundscaper', project: { id: 'project', tracks: [] },
			preferences: { workspace: { panels: {} } }, transportState: 'stopped', recording, readOnly: false },
	}));
	const primary = markup.match(/data-transport="record"[^]*?<button([^>]+)/u)?.[1];
	const options = markup.match(/<button([^>]*aria-label="Record options"[^>]+)/u)?.[1];
	assert.ok(primary);
	assert.ok(options);
	assert.equal(primary.includes(' disabled=""'), disabled);
	assert.equal(options.includes(' disabled=""'), false);
});
