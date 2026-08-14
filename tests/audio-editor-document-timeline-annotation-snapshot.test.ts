/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDocumentTimelineAnnotationSnapshot,
} from '../src/common/editor/controller/document-timeline-annotation-snapshot.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
} from '../src/common/editor/project-schema-version.ts';

test('document annotation snapshot projects active V17 and Soundscaper V21 documents by runtime timing', () => {
	const project = createCurrentAudioEditorProject({
		id: 'annotation-view',
		now: 1_700_000_000_000,
		timelineAnnotations: [
			{
				id: 'sample-late', sequenceId: 'main-sequence', name: '', color: 'auto', batchId: null,
				opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionFrame: 48_000,
			},
			{
				id: 'musical-first', sequenceId: 'main-sequence', name: '', color: 'auto', batchId: null,
				opaqueExtensions: {}, kind: 'marker', anchor: 'musical', positionBeat: { num: 1, den: 1 },
			},
		],
	});
	const snapshot = createDocumentTimelineAnnotationSnapshot(project);
	assert.deepEqual(snapshot.map(({ id }) => id), ['musical-first', 'sample-late']);
	assert.equal(snapshot[0]?.timelineStartFrame, 24_000);
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot[0]), true);
	assert.deepEqual(
		createDocumentTimelineAnnotationSnapshot({
			...project,
			schemaVersion: SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
		}).map(({ id }) => id),
		['musical-first', 'sample-late'],
	);
});

test('document annotation snapshot does not traverse obsolete, Framescaper, future, or absent schema state', () => {
	const hostile = (schemaVersion: number) => ({
		schemaVersion,
		get timelineAnnotations(): never {
			throw new Error('timelineAnnotations was traversed');
		},
	});
	assert.deepEqual(createDocumentTimelineAnnotationSnapshot(hostile(10)), []);
	assert.deepEqual(createDocumentTimelineAnnotationSnapshot(hostile(FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION)), []);
	assert.deepEqual(createDocumentTimelineAnnotationSnapshot(hostile(SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION + 1)), []);
	assert.deepEqual(createDocumentTimelineAnnotationSnapshot({
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	}), []);
	assert.deepEqual(createDocumentTimelineAnnotationSnapshot(null), []);
});
