/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectSessionSelectionService,
	type ProjectSessionSelectionMetadata,
} from '../src/common/editor/controller/project-session-selection-service.ts';

interface TestProject {
	readonly schemaVersion?: unknown;
	readonly timelineAnnotations?: unknown;
	readonly tracks: readonly Readonly<{ id: string; type: string }>[];
	readonly clips: readonly Readonly<{ id: string }>[];
}

function createFixture(
	project: TestProject,
	selectedTrackId: string | null = null,
	selectedClipId: string | null = null,
	selectedAnnotationId: string | null = null,
) {
	const state = { selectedTrackId, selectedClipId, selectedAnnotationId };
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

	assert.deepEqual(captured, {
		selectedTrackId: null,
		selectedClipId: null,
		selectedAnnotationId: null,
	});
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
		selectedAnnotationId: null,
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
		selectedAnnotationId: null,
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
	assert.deepEqual(empty.state, {
		selectedTrackId: null,
		selectedClipId: null,
		selectedAnnotationId: null,
	});
});

test('project session selection restores an existing annotation only for the current timeline-annotation schema', () => {
	const fixture = createFixture({
		schemaVersion: 15,
		timelineAnnotations: [{ id: 'annotation' }, { id: 'other' }],
		tracks: [],
		clips: [],
	});

	fixture.service.restore(fixture.project, { selectedAnnotationId: 'annotation' });

	assert.equal(fixture.state.selectedAnnotationId, 'annotation');
	fixture.service.restore(fixture.project, { selectedAnnotationId: 'stale' });
	assert.equal(fixture.state.selectedAnnotationId, null);
});

test('project session selection clears malformed annotation focus', () => {
	const malformed = createFixture({
		schemaVersion: 15,
		timelineAnnotations: [{ id: 'annotation' }, null],
		tracks: [],
		clips: [],
	}, null, null, 'previous');

	malformed.service.restore(malformed.project, { selectedAnnotationId: 'annotation' });

	assert.equal(malformed.state.selectedAnnotationId, null);
	const malformedMetadata = createFixture({
		schemaVersion: 15,
		timelineAnnotations: [{ id: 'annotation' }],
		tracks: [],
		clips: [],
	}, null, null, 'previous');
	malformedMetadata.service.restore(malformedMetadata.project, {
		selectedAnnotationId: 42,
	} as unknown as ProjectSessionSelectionMetadata);
	assert.equal(malformedMetadata.state.selectedAnnotationId, null);
	const older = createFixture({
		schemaVersion: 10,
		timelineAnnotations: [{ id: 'annotation' }],
		tracks: [],
		clips: [],
	}, null, null, 'previous');
	older.service.restore(older.project, { selectedAnnotationId: 'annotation' });
	assert.equal(older.state.selectedAnnotationId, null);
});

test('project session selection does not traverse future annotation storage', () => {
	let annotationReads = 0;
	const futureProject: TestProject = {
		schemaVersion: 16,
		get timelineAnnotations(): never {
			annotationReads += 1;
			throw new Error('future timelineAnnotations was traversed');
		},
		tracks: [],
		clips: [],
	};
	const fixture = createFixture(futureProject, null, null, 'previous');

	fixture.service.restore(futureProject, { selectedAnnotationId: 'annotation' });

	assert.equal(fixture.state.selectedAnnotationId, null);
	assert.equal(annotationReads, 0);
});
