/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectSessionSelectionService } from '../src/common/editor/controller/document/internal/project/project-session-selection-service.ts';

for (const types of [['audio', 'label'], ['label'], ['video', 'audio']] as const) {
	test(`captured No tracks survives session restoration with ${types.join('/')} lanes`, () => {
		const project = { tracks: types.map((type, index) => ({ id: `track-${index}`, type })),
			clips: [], selection: { startFrame: 100, endFrame: 400, trackIds: [], clipIds: [] } };
		const original = structuredClone(project);
		const state = { selectedTrackId: null as string | null, selectedClipId: null as string | null,
			selectedAnnotationId: null as string | null };
		const service = createProjectSessionSelectionService({ state,
			findTrack: (value: typeof project, id) => value.tracks.find(track => track.id === id) ?? null,
			findClip: () => null });
		const captured = service.capture();
		state.selectedTrackId = 'other-project-track';
		service.restore(project, captured);
		assert.deepEqual(state, captured);
		assert.deepEqual(project, original);
	});
}

for (const requested of ['recording', 'stale', undefined] as const) {
	test(`session track focus ${requested ?? 'omitted'} retains existing restoration behavior`, () => {
		const project = { tracks: [{ id: 'labels', type: 'label' }, { id: 'recording', type: 'audio' }], clips: [] };
		const state = { selectedTrackId: null as string | null, selectedClipId: null as string | null,
			selectedAnnotationId: null as string | null };
		const service = createProjectSessionSelectionService({ state,
			findTrack: (value: typeof project, id) => value.tracks.find(track => track.id === id) ?? null,
			findClip: () => null });
		service.restore(project, requested === undefined ? {} : { selectedTrackId: requested });
		assert.equal(state.selectedTrackId, 'recording');
	});
}
