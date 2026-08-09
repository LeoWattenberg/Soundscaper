/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/legacy-recording-capture-service.ts';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/routed-recording-capture-service.ts';
import {
	createRecordingCaptureFixture,
	createScope,
} from './fixtures/recording-capture-fixture.ts';

const SETTINGS = Object.freeze({
	thresholdDb: -20,
	hysteresisDb: 6,
	holdFrames: 0,
});

test('legacy setup failure cancels a policy session created before recorder construction', async () => {
	const fixture = createRecordingCaptureFixture({
		soundActivationSettings: SETTINGS,
		createRecorder: async () => { throw new Error('recorder construction failed'); },
	});

	await assert.rejects(
		createLegacyRecordingCaptureService(fixture.runtime).capture(
			{ trackId: 'track-1' },
			createScope(() => true),
		),
		/recorder construction failed/u,
	);

	assert.deepEqual(fixture.soundActivationStates.map(({ state }) => state), ['cancelled']);
});

test('routed setup failure cancels every independent policy session before discarding it', async () => {
	const fixture = createRecordingCaptureFixture({
		soundActivationSettings: SETTINGS,
		streamChannelCount: 1,
		createRecorder: async () => { throw new Error('recorder construction failed'); },
	});
	fixture.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'display', deviceId: '', channelStart: 0, channelCount: 1 },
			'track-2': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};

	await assert.rejects(
		createRoutedRecordingCaptureService(fixture.runtime).capture({}, createScope(() => true)),
		/No inputs/u,
	);

	assert.deepEqual(fixture.soundActivationStates.map(({ source, state }) => [source.sourceKey, state]), [
		['display', 'cancelled'],
		['device:mic', 'cancelled'],
	]);
});
