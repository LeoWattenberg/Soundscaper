/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/recording/internal/legacy-recording-capture-service.ts';
import { createEndingRecordingStream, createRecordingCaptureFixture, createScope } from './fixtures/recording-capture-fixture.ts';

for (const channelCount of [1, 2]) {
	test(`timed default capture reuses its live negotiated ${channelCount}-channel microphone`, async () => {
		const fixture = createRecordingCaptureFixture({ streamChannelCount: channelCount });
		const runtime = { ...fixture.runtime, capturePool: { ...fixture.runtime.capturePool,
			getHardware: () => fixture.stream,
		} };
		await createLegacyRecordingCaptureService(runtime).capture({ trackId: 'track-1',
			timedStartTimeMs: 10_000, reusePreparedInputsOnly: true,
		}, createScope(() => true));
		assert.equal(fixture.recorderCreations(), 1);
		assert.equal(fixture.recorderOptions()?.channelCount, channelCount);
		assert.equal(fixture.state.recordingStream, fixture.stream);
		assert.equal(fixture.hardwareRequests(), 0, 'prepared input reuse opens no second microphone');
	});
}

test('ordinary default capture already accepts the same mono microphone', async () => {
	const fixture = createRecordingCaptureFixture({ streamChannelCount: 1 });
	await createLegacyRecordingCaptureService(fixture.runtime).capture({ trackId: 'track-1' }, createScope(() => true));
	assert.equal(fixture.recorderOptions()?.channelCount, 1);
});

test('a prepared microphone that has ended still refuses timer capture without reopening', async () => {
	const fixture = createRecordingCaptureFixture({ streamChannelCount: 1 });
	const microphone = createEndingRecordingStream();
	microphone.end();
	const runtime = { ...fixture.runtime, capturePool: { ...fixture.runtime.capturePool,
		getHardware: () => microphone.stream,
	} };
	await assert.rejects(createLegacyRecordingCaptureService(runtime).capture({ trackId: 'track-1',
		timedStartTimeMs: 10_000, reusePreparedInputsOnly: true,
	}, createScope(() => true)), /Prepared input closed/u);
	assert.equal(fixture.recorderCreations(), 0);
	assert.equal(fixture.hardwareRequests(), 0);
});
