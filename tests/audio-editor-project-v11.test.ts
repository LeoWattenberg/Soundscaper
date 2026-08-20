/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacityXmlNode } from '../src/common/editor/audacity-binary-xml.js';
import { convertLegacyAupToProject } from '../src/common/editor/aup-legacy-conversion.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
	cloneCurrentAudioEditorProject,
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import { validateProjectHierarchyDocument } from '../src/common/editor/project-hierarchy-document-validation.ts';
import { AudioEditorProjectStore } from '../src/common/editor/storage.js';

const NOW = '2026-08-09T16:00:00.000Z';

function sampleMarker(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		id: 'annotation-1', sequenceId: 'main-sequence', name: 'Opening cue', color: 'violet',
		batchId: null, opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionFrame: 24_000,
		...overrides,
	};
}

test('the exact current pipeline always owns annotation and selection collections', () => {
	const project = createCurrentAudioEditorProject({ id: 'current-v17', now: NOW });

	assert.equal(AUDIO_EDITOR_PROJECT_SCHEMA_VERSION, 17);
	assert.equal(AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, 17);
	assert.equal(project.schemaVersion, 17);
	assert.deepEqual(project.timelineAnnotations, []);
	assert.deepEqual(project.selection.annotationIds, []);
	assert.deepEqual(project.takeGroups, []);
	assert.equal(validateProjectHierarchyDocument(project, 17), true);
	assert.equal(validateCurrentAudioEditorProject(project), true);
});

test('current loaders reject non-integer schema wire values', () => {
	for (const schemaVersion of [17.5, Number.POSITIVE_INFINITY, '17', 17n]) {
		assert.throws(
			() => loadCurrentAudioEditorProject({ schemaVersion }),
			/schema version.*safe integer|safe integer.*schema version/iu,
		);
	}
});

test('current annotations retain validated selection without derived coordinates', () => {
	const input = sampleMarker({ opaqueExtensions: { riffCue: { id: 7 } } });
	const project = createCurrentAudioEditorProject({
		now: NOW,
		timelineAnnotations: [input],
		selection: { annotationIds: ['annotation-1'] },
	});
	const annotation = project.timelineAnnotations[0]!;

	assert.deepEqual(annotation, input);
	assert.notStrictEqual(annotation, input);
	assert.notStrictEqual(annotation.opaqueExtensions, input.opaqueExtensions);
	assert.equal(Object.hasOwn(annotation, 'timelineStartFrame'), false);
	(input.opaqueExtensions as { riffCue: { id: number } }).riffCue.id = 9;
	assert.deepEqual(annotation.opaqueExtensions, { riffCue: { id: 7 } });
	assert.deepEqual(project.selection.annotationIds, ['annotation-1']);
	assert.equal(validateCurrentAudioEditorProject(project), true);

	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete missing.timelineAnnotations;
	assert.throws(() => validateCurrentAudioEditorProject(missing), /timelineAnnotations.*array/iu);
	assert.throws(() => createCurrentAudioEditorProject({
		now: NOW,
		timelineAnnotations: [sampleMarker({ sequenceId: 'missing-sequence' })],
	}), /missing.*sequence|sequence.*missing/iu);
	assert.throws(() => createCurrentAudioEditorProject({
		now: NOW,
		timelineAnnotations: [input],
		selection: { annotationIds: ['missing-annotation'] },
	}), /selection.*missing-annotation|missing.*annotation/iu);
	assert.throws(() => createCurrentAudioEditorProject({
		now: NOW,
		timelineAnnotations: [input],
		selection: { annotationIds: ['annotation-1', 'annotation-1'] },
	}), /annotation.*duplicate|duplicate.*ID/iu);
});

test('annotation accessors are rejected without invocation', () => {
	let getterCalls = 0;
	const marker = sampleMarker();
	Object.defineProperty(marker, 'positionFrame', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return 24_000;
		},
	});
	assert.throws(
		() => createCurrentAudioEditorProject({ now: NOW, timelineAnnotations: [marker] }),
		/data property|accessor/iu,
	);
	assert.equal(getterCalls, 0);
});

test('current clone, JSON load, and store reload are byte-idempotent', async () => {
	const project = createCurrentAudioEditorProject({
		id: 'annotation-roundtrip',
		title: 'Annotation round trip',
		now: NOW,
		timelineAnnotations: [sampleMarker()],
	});
	const serialized = JSON.stringify(project);
	const loaded = loadCurrentAudioEditorProject(JSON.parse(serialized));
	const cloned: AudioEditorProjectCurrent = cloneCurrentAudioEditorProject(project);

	assert.equal(loaded.readOnly, false);
	assert.deepEqual(loaded.project, project);
	assert.notStrictEqual(loaded.project, project);
	assert.deepEqual(cloned, project);
	assert.notStrictEqual(cloned.timelineAnnotations, project.timelineAnnotations);
	assert.equal(JSON.stringify(loaded.project), serialized);

	const store = new AudioEditorProjectStore({
		indexedDB: null,
		databaseName: 'current-annotation-roundtrip',
	});
	await store.saveProject(project);
	const reopened = await store.loadProject(project.id);
	assert.deepEqual(reopened, project);
	assert.equal(JSON.stringify(reopened), serialized);
	await store.close();
});

test('current commands retain authoritative annotations and selection', () => {
	const project = createCurrentAudioEditorProject({
		now: NOW,
		timelineAnnotations: [sampleMarker()],
		selection: { annotationIds: ['annotation-1'] },
	});
	const updated = applyEditorCommand(project, {
		type: 'metadata/update',
		changes: { artist: 'Soundscaper' },
	}, { now: '2026-08-09T16:01:00.000Z' });
	assert.deepEqual(updated.timelineAnnotations, project.timelineAnnotations);
	assert.notStrictEqual(updated.timelineAnnotations, project.timelineAnnotations);

	const cleared = applyEditorCommand(updated, {
		type: 'selection/set',
		startFrame: 10,
		endFrame: 20,
	}, { now: '2026-08-09T16:02:00.000Z' });
	const selected = applyEditorCommand(cleared, {
		type: 'selection/set',
		startFrame: 10,
		endFrame: 20,
		annotationIds: ['annotation-1'],
	}, { now: '2026-08-09T16:03:00.000Z' });

	assert.deepEqual(cleared.selection.annotationIds, []);
	assert.deepEqual(selected.selection.annotationIds, ['annotation-1']);
	assert.equal(validateCurrentAudioEditorProject(selected), true);
});

test('legacy AUP and AUP4 imports author exact current documents with empty editorial state', async () => {
	const legacy = convertLegacyAupToProject({ sampleRate: 48_000, tracks: [] }, {
		idFactory: (prefix: string) => prefix,
		now: NOW,
	});
	assert.equal(legacy.project.schemaVersion, 17);
	assert.deepEqual(legacy.project.timelineAnnotations, []);
	assert.deepEqual(legacy.project.trackFolders, []);
	assert.deepEqual(legacy.project.takeGroups, []);
	assert.equal(validateCurrentAudioEditorProject(legacy.project), true);

	const root = createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'version', type: 'string', value: '2.0.0' },
		{ kind: 'attribute', name: 'rate', type: 'double', value: 48_000, digits: -1 },
	]);
	let nextId = 0;
	const aup4 = await decodeAudacityProjectTree(root, async () => null, {
		idFactory: (prefix: string) => `${prefix}-${String(++nextId)}`,
	});
	assert.equal(aup4.project.schemaVersion, 17);
	assert.deepEqual(aup4.project.timelineAnnotations, []);
	assert.deepEqual(aup4.project.trackFolders, []);
	assert.deepEqual(aup4.project.takeGroups, []);
	assert.equal(validateCurrentAudioEditorProject(aup4.project), true);
});
