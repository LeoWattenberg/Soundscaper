/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacityXmlNode } from '../src/common/editor/audacity-binary-xml.js';
import { convertLegacyAupToProject } from '../src/common/editor/aup-legacy-conversion.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	AudioEditorProjectReimportRequiredError,
	migrateAudioEditorProject,
} from '../src/common/editor/migration.js';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
	cloneCurrentAudioEditorProject,
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import {
	AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION,
	createAudioEditorProjectV10,
	loadAudioEditorProjectV10,
	validateAudioEditorProjectV10,
} from '../src/common/editor/project-v10.ts';
import {
	AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION,
	createAudioEditorProjectV11,
	loadAudioEditorProjectV11,
	validateAudioEditorProjectV11,
} from '../src/common/editor/project-v11.ts';
import { AudioEditorProjectStore } from '../src/common/editor/storage.js';

const NOW = '2026-08-09T16:00:00.000Z';

function sampleMarker(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		id: 'annotation-1', sequenceId: 'main-sequence', name: 'Opening cue', color: 'violet',
		batchId: null, opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionFrame: 24_000,
		...overrides,
	};
}

test('V12 is exact current while V11 and V10 remain honest historical generations', () => {
	const current = createCurrentAudioEditorProject({ id: 'current-v12', now: NOW });
	const historicalV11 = createAudioEditorProjectV11({ id: 'historical-v11', now: NOW });
	const historical = createAudioEditorProjectV10({ id: 'historical-v10', now: NOW });

	assert.equal(AUDIO_EDITOR_PROJECT_SCHEMA_VERSION, 14);
	assert.equal(AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, 14);
	assert.equal(AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION, 11);
	assert.equal(AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION, 10);
	assert.equal(current.schemaVersion, 14);
	assert.equal(historicalV11.schemaVersion, 11);
	assert.equal(historical.schemaVersion, 10);
	assert.deepEqual(current.timelineAnnotations, []);
	assert.deepEqual(current.selection.annotationIds, []);
	assert.equal(validateCurrentAudioEditorProject(current), true);
	assert.equal(validateAudioEditorProjectV11(historicalV11), true);
	assert.equal(validateAudioEditorProjectV10(historical), true);
	assert.throws(() => validateAudioEditorProjectV10(current), /schema version/iu);
	assert.throws(() => validateAudioEditorProjectV11(current), /schema version/iu);
});

test('the historical V11 contract owns its exact schema boundary', () => {
	const project = createAudioEditorProjectV11({ id: 'v11-boundary', now: NOW });
	const future = { ...project, schemaVersion: 15 };

	assert.deepEqual(loadAudioEditorProjectV11(future), {
		project: future,
		readOnly: true,
		reason: 'newer-schema',
	});
	const loaded = loadAudioEditorProjectV11(project);
	assert.equal(loaded.readOnly, false);
	assert.deepEqual(loaded.project, project);
	assert.throws(() => loadAudioEditorProjectV11({ ...project, schemaVersion: 10 }), /schema version/iu);
});

test('current and historical loaders reject non-integer schema wire values', () => {
	for (const schemaVersion of [11.5, Number.POSITIVE_INFINITY, '12', 12n]) {
		assert.throws(
			() => loadCurrentAudioEditorProject({ schemaVersion }),
			/schema version.*safe integer|safe integer.*schema version/iu,
		);
	}
	for (const schemaVersion of [10.5, Number.POSITIVE_INFINITY, '11', 11n]) {
		assert.throws(
			() => loadAudioEditorProjectV10({ schemaVersion }),
			/schema version.*safe integer|safe integer.*schema version/iu,
		);
	}
	for (const schemaVersion of [11.5, Number.POSITIVE_INFINITY, '12', 12n]) {
		assert.throws(
			() => loadAudioEditorProjectV11({ schemaVersion }),
			/schema version.*safe integer|safe integer.*schema version/iu,
		);
	}
});

test('historical V10 cannot carry the V11 annotation document field', () => {
	const historical = createAudioEditorProjectV10({ id: 'historical-v10', now: NOW });
	assert.throws(
		() => validateAudioEditorProjectV10({ ...historical, timelineAnnotations: [] }),
		/timelineAnnotations.*V11/iu,
	);
	assert.throws(
		() => validateAudioEditorProjectV10({
			...historical,
			selection: {
				...(historical.selection as Readonly<Record<string, unknown>>),
				annotationIds: [],
			},
		}),
		/selection\.annotationIds.*V11|V11.*selection\.annotationIds/iu,
	);
});

test('V11 requires annotations and retains validated annotation selection without derived coordinates', () => {
	const input = sampleMarker({ opaqueExtensions: { riffCue: { id: 7 } } });
	const project = createAudioEditorProjectV11({
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
	assert.equal(validateAudioEditorProjectV11(project), true);

	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete missing.timelineAnnotations;
	assert.throws(() => validateAudioEditorProjectV11(missing), /timelineAnnotations.*array/iu);
	assert.throws(() => createAudioEditorProjectV11({
		now: NOW,
		timelineAnnotations: [sampleMarker({ sequenceId: 'missing-sequence' })],
	}), /missing.*sequence|sequence.*missing/iu);
	assert.throws(() => createAudioEditorProjectV11({
		now: NOW,
		timelineAnnotations: [input],
		selection: { annotationIds: ['missing-annotation'] },
	}), /selection.*missing-annotation|missing.*annotation/iu);
	assert.throws(() => createAudioEditorProjectV11({
		now: NOW,
		timelineAnnotations: [input],
		selection: { annotationIds: ['annotation-1', 'annotation-1'] },
	}), /annotation.*duplicate|duplicate.*ID/iu);
});

test('current clone, JSON save/load, and store reload are byte-idempotent', async () => {
	const project = createCurrentAudioEditorProject({
		id: 'v11-roundtrip',
		title: 'V11 round trip',
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
		databaseName: 'v11-current-project-roundtrip',
	});
	await store.saveProject(project);
	const reopened = await store.loadProject(project.id);
	assert.deepEqual(reopened, project);
	assert.equal(JSON.stringify(reopened), serialized);
	await store.close();
});

test('current commands retain the authoritative V11 annotation collection', () => {
	const project = createCurrentAudioEditorProject({ now: NOW, timelineAnnotations: [sampleMarker()] });
	const updated = applyEditorCommand(project, {
		type: 'metadata/update',
		changes: { artist: 'Soundscaper' },
	}, { now: '2026-08-09T16:01:00.000Z' });

	assert.deepEqual(updated.timelineAnnotations, project.timelineAnnotations);
	assert.notStrictEqual(updated.timelineAnnotations, project.timelineAnnotations);
	assert.equal((updated.metadata as Readonly<{ artist: string }>).artist, 'Soundscaper');
	assert.equal(validateCurrentAudioEditorProject(updated), true);
});

test('current selection commands preserve the mandatory annotation selection field', () => {
	const project = createCurrentAudioEditorProject({
		now: NOW,
		timelineAnnotations: [sampleMarker()],
		selection: { annotationIds: ['annotation-1'] },
	});
	const cleared = applyEditorCommand(project, {
		type: 'selection/set',
		startFrame: 10,
		endFrame: 20,
	}, { now: '2026-08-09T16:01:00.000Z' });
	const selected = applyEditorCommand(cleared, {
		type: 'selection/set',
		startFrame: 10,
		endFrame: 20,
		annotationIds: ['annotation-1'],
	}, { now: '2026-08-09T16:02:00.000Z' });

	assert.deepEqual(cleared.selection.annotationIds, []);
	assert.deepEqual(selected.selection.annotationIds, ['annotation-1']);
	assert.equal(validateCurrentAudioEditorProject(selected), true);
});

test('the raw router rejects schemas 1 through 13, loads exact V14, and preserves V15 opaquely read-only', () => {
	for (const schemaVersion of [14.5, Number.POSITIVE_INFINITY, '15', 15n]) {
		assert.throws(
			() => migrateAudioEditorProject({ schemaVersion }),
			/unsupported.*schema version|schema version.*unsupported/iu,
		);
	}
	for (let schemaVersion = 1; schemaVersion <= 13; schemaVersion += 1) {
		assert.throws(
			() => migrateAudioEditorProject({ schemaVersion }),
			(error: unknown) => error instanceof AudioEditorProjectReimportRequiredError
				&& error.schemaVersion === schemaVersion
				&& error.currentSchemaVersion === 14,
		);
	}
	const current = createCurrentAudioEditorProject({ id: 'router-v14', now: NOW });
	const loaded = migrateAudioEditorProject(current);
	assert.equal(loaded.readOnly, false);
	assert.deepEqual(loaded.project, current);

	const future = {
		...current,
		schemaVersion: 15,
		timelineAnnotations: { futureShape: { retained: true } },
	};
	assert.deepEqual(migrateAudioEditorProject(future), {
		project: future,
		migrated: false,
		fromVersion: 15,
		readOnly: true,
		reason: 'newer-schema',
	});
});

test('legacy AUP and AUP4 imports author exact V14 documents with empty annotations and folders', async () => {
	const legacy = convertLegacyAupToProject({ sampleRate: 48_000, tracks: [] }, {
		idFactory: (prefix: string) => prefix,
		now: NOW,
	});
	assert.equal(legacy.project.schemaVersion, 14);
	assert.deepEqual(legacy.project.timelineAnnotations, []);
	assert.deepEqual(legacy.project.trackFolders, []);
	assert.equal(validateCurrentAudioEditorProject(legacy.project), true);

	const root = createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'version', type: 'string', value: '2.0.0' },
		{ kind: 'attribute', name: 'rate', type: 'double', value: 48_000, digits: -1 },
	]);
	let nextId = 0;
	const aup4 = await decodeAudacityProjectTree(root, async () => null, {
		idFactory: (prefix: string) => `${prefix}-${String(++nextId)}`,
	});
	assert.equal(aup4.project.schemaVersion, 14);
	assert.deepEqual(aup4.project.timelineAnnotations, []);
	assert.deepEqual(aup4.project.trackFolders, []);
	assert.equal(validateCurrentAudioEditorProject(aup4.project), true);
});
