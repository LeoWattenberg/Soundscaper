/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createControllerRecordingState } from '../src/common/editor/controller/recording/recording-state.ts';
import { createRecordingSessionService } from '../src/common/editor/controller/recording/internal/recording-session-service.ts';
import type { RecordingCompositionDependencies } from '../src/common/editor/controller/recording/internal/recording-composition-types.ts';
import type { createEditorTrackService } from '../src/common/editor/controller/track-audio/internal/track-service.ts';

void test('recording accepts the track owner declining to create a track', async () => {
	const addTrack: ReturnType<typeof createEditorTrackService>['addTrack'] = () => undefined;
	const state = {
		...createControllerRecordingState({
			recordingRouting: { routes: {}, offsets: {} }, recordingInputGain: 1,
			preferredInputDeviceId: 'default',
		}),
		readOnly: false, disposed: false, projectBinPreview: null,
	};
	let starts = 0;
	const session = createRecordingSessionService({
		state, getProjectId: () => 'project',
		addTrack: addTrack satisfies RecordingCompositionDependencies['addTrack'],
		async beginRecording() { starts += 1; },
		async performLegacyFinalization() {}, async performRoutedFinalization() {},
	});
	assert.equal(await session.startRecordingOnNewTrack(), null);
	assert.equal(starts, 0);
	assert.equal(state.recordingStarting, false);
});
