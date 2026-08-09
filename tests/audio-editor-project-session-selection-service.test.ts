/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectSessionSelectionService } from '../src/common/editor/controller/project-session-selection-service.ts';

interface TestProject {
	readonly tracks: readonly Readonly<{ id: string; type: string }>[];
	readonly clips: readonly Readonly<{ id: string }>[];
}

function createFixture(
	project: TestProject,
	selectedTrackId: string | null = null,
	selectedClipId: string | null = null,
) {
	const state = { selectedTrackId, selectedClipId };
	const service = createProjectSessionSelectionService<TestProject>({
		state,
		findTrack: (candidate, trackId) => (
			candidate.tracks.find((track) => track.id === trackId) ?? null
		),
		findClip: (candidate, clipId) => (
			candidate.clips.find((clip) => clip.id === clipId) ?? null
		),
	});
	return { project, service, state };
}

test('project session selection capture retains explicit null metadata', () => {
	const fixture = createFixture({ tracks: [], clips: [] });

	const captured = fixture.service.capture();

	assert.deepEqual(captured, { selectedTrackId: null, selectedClipId: null });
	assert.equal(Object.isFrozen(captured), true);
});

test('project session selection restores valid label and clip focus independently', () => {
	const fixture = createFixture({
		tracks: [
			{ id: 'labels', type: 'label' },
			{ id: 'audio', type: 'audio' },
		],
		clips: [{ id: 'clip' }],
	});

	fixture.service.restore(fixture.project, {
		selectedTrackId: 'labels',
		selectedClipId: 'clip',
	});

	assert.deepEqual(fixture.state, {
		selectedTrackId: 'labels',
		selectedClipId: 'clip',
	});
});

test('project session selection falls back to the first non-label track and clears a missing clip', () => {
	const fixture = createFixture({
		tracks: [
			{ id: 'labels', type: 'label' },
			{ id: 'audio', type: 'audio' },
			{ id: 'video', type: 'video' },
		],
		clips: [{ id: 'clip' }],
	}, 'previous-track', 'previous-clip');

	fixture.service.restore(fixture.project, {
		selectedTrackId: 'missing-track',
		selectedClipId: 'missing-clip',
	});

	assert.deepEqual(fixture.state, {
		selectedTrackId: 'audio',
		selectedClipId: null,
	});
});

test('project session selection falls back to the first label and then null when no track remains', () => {
	const labelsOnly = createFixture({
		tracks: [{ id: 'labels', type: 'label' }],
		clips: [],
	});
	labelsOnly.service.restore(labelsOnly.project, {});
	assert.equal(labelsOnly.state.selectedTrackId, 'labels');

	const empty = createFixture({ tracks: [], clips: [] }, 'previous', 'previous');
	empty.service.restore(empty.project, {});
	assert.deepEqual(empty.state, { selectedTrackId: null, selectedClipId: null });
});
