/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionViewService, type SelectionViewProject, type SelectionViewSelectionCommand,
	type SelectionViewServiceRuntime } from '../src/common/editor/controller/track-audio/internal/selection-view-service.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';

for (const headerSelection of [false, true]) {
	test(`zero-crossing alignment retains a spectral band on a ${headerSelection ? 'clip' : 'time'} selection`, async () => {
		const frequencyRange = { minimumFrequency: 100, maximumFrequency: 400 };
		const project: SelectionViewProject = {
			id: 'voice', schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
			tracks: [{ id: 'voice', type: 'audio', clipIds: ['recording'] }],
			clips: [{ id: 'recording', kind: 'audio', timelineStartFrame: 0, durationFrames: 100 }],
			selection: { startFrame: headerSelection ? 0 : 10, endFrame: headerSelection ? 0 : 30,
				trackIds: ['voice'], clipIds: headerSelection ? ['recording'] : [], frequencyRange },
		};
		let written: SelectionViewSelectionCommand | null = null;
		const runtime: SelectionViewServiceRuntime<SelectionViewProject, Readonly<{ channels: Float32Array[] }>> = {
			DEFAULT_PIXELS_PER_SECOND: 100, MAX_PIXELS_PER_SECOND: 10_000,
			activeSelection: () => headerSelection ? null : project.selection,
			audioBufferChannels: buffer => buffer.channels, cloneProject: value => structuredClone(value),
			collectRelatedClipIds: (_project, ids) => ids,
			commit: command => { if (command.type === 'selection/set') written = command; return project; },
			copy: { audioTrackNotFound: 'Missing track', audioClipNotFound: 'Missing clip',
				selectionFramesFinite: 'Finite frames required', timelineFramesFinite: 'Finite frames required',
				v2Required: 'Current project required', zeroCrossingsAligned: 'Aligned' },
			editorTimelineDurationFrames: () => 100,
			engine: { getPositionFrames: () => 0, getState: () => ({ state: 'stopped' }), seek() {} },
			findClip: (value, id) => value.clips.find(clip => clip.id === id),
			findClipTrack: value => value.tracks[0], findTrack: (value, id) => value.tracks.find(track => track.id === id),
			findNearestAudioZeroCrossing: (_channels, frame) => frame, getProject: () => project,
			handleError: error => { throw error; }, normalizeTimelineFrame: value => Number(value),
			persistSetting: () => Promise.resolve(), productSettingKey: name => name,
			projectDurationFrames: () => 100, projectSampleRate: () => 1000,
			publishDocumentSnapshot() {}, publishProjectState() {},
			renderSnapshot: (_project, range) => ({ channels: [new Float32Array(range.outputFrames)] }),
			resetRoutedInputMeter() {}, setStatus() {}, snapAudioEditorFrameWithProject: frame => frame,
			state: { analysisProcessing: false, selectedTrackId: 'voice', selectedClipId: headerSelection ? 'recording' : null,
				selectedAnnotationId: null, showRms: false, showVerticalRulers: false, scrollViewToPlayhead: false,
				pinnedPlayhead: false, playbackOnRulerClick: false, timelineViewportWidth: 1000, pixelsPerSecond: 100 },
			synchronizeAutomaticSampleEditMode() {}, synchronizeMicrophoneMeterTarget() {},
			updatePlayhead() {}, updateSelection: () => project,
		};
		await createSelectionViewService(runtime).selectAtZeroCrossings();
		assert.ok(written);
		assert.deepEqual((written as SelectionViewSelectionCommand).frequencyRange, frequencyRange);
		assert.equal(runtime.state.analysisProcessing, false);
	});
}
