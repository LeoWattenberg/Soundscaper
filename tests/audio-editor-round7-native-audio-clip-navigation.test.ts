/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipSelectionNavigationService, type ClipSelectionNavigationProject } from '../src/common/editor/controller/track-audio/internal/clip-selection-navigation-service.ts';

for (const action of ['selectNextClip', 'selectPreviousClip', 'selectCursorToNextClipBoundary', 'selectPreviousClipBoundaryToCursor'] as const) {
	test(`${action} ignores an unrelated native Title while preserving ordinary audio navigation`, () => {
		const backwards = action === 'selectPreviousClip' || action === 'selectPreviousClipBoundaryToCursor';
		const audio = [{ id: 'left', kind: 'audio', sourceId: 'sound', timelineStartFrame: 0, durationFrames: 100, sourceStartFrame: 0, sourceDurationFrames: 100 },
			{ id: 'right', kind: 'audio', sourceId: 'sound', timelineStartFrame: 200, durationFrames: 100, sourceStartFrame: 100, sourceDurationFrames: 100 }];
		const project: ClipSelectionNavigationProject = {
			sampleRate: 48_000, primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 30, den: 1 } }],
			clips: audio, tracks: [{ id: 'sound', type: 'audio', clipIds: ['left', 'right'] }, { id: 'pictures', type: 'video', clipIds: [] }],
			selection: { startFrame: 0, endFrame: 0, clipIds: [backwards ? 'right' : 'left'], trackIds: ['sound'] },
		};
		function perform(current: ClipSelectionNavigationProject) {
			const service = createClipSelectionNavigationService({ getProject: () => current,
				state: { selectedClipId: backwards ? 'right' : 'left', selectedTrackId: 'sound', selectedAnnotationId: null },
				updateSelection: command => command, seek: () => assert.fail('Selection must not seek') });
			return service[action]();
		}
		const healthy = perform(project);
		assert.ok(healthy);
		const withTitle: ClipSelectionNavigationProject = { ...project,
			clips: [...audio, { id: 'title', kind: 'generator', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 150 }],
			tracks: [project.tracks[0]!, { id: 'pictures', type: 'video', clipIds: ['title'] }],
		};
		const before = structuredClone(withTitle);
		assert.deepEqual(perform(withTitle), healthy);
		assert.deepEqual(withTitle, before);
	});
}
