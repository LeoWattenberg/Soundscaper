import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	migrateAudioEditorProject,
	migrateAudioEditorProjectV5ToV6,
	migrateAudioEditorProjectV6ToV7,
	migrateAudioEditorProjectV7ToV8,
	migrateAudioEditorProjectV8ToV9,
} from '../src/common/editor/migration.js';
import { validateAudioEditorProject } from '../src/common/editor/project.js';
import { createAudioEditorProjectV2 } from '../src/common/editor/project-v2.js';
import { createAudioEditorProjectV3 } from '../src/common/editor/project-v3.js';
import { createAudioEditorProjectV4 } from '../src/common/editor/project-v4.js';
import { createAudioEditorProjectV5 } from '../src/common/editor/project-v5.js';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	cloneAudioEditorProjectV6,
	createAudioEditorProjectV6,
	loadAudioEditorProjectV6,
	normalizeProjectBextMetadata,
	validateAudioEditorProjectV6,
} from '../src/common/editor/project-v6.ts';

const NOW = '2026-07-28T12:34:56.000Z';

test('V6 projects persist canonical BEXT v2 metadata or an explicit null', () => {
	const empty = createAudioEditorProjectV6({ title: 'Uninitialized', now: NOW });
	assert.equal(empty.schemaVersion, 6);
	assert.equal(empty.metadata.bext, null);
	assert.equal(validateAudioEditorProjectV6(empty), true);
	assert.equal(validateAudioEditorProject(empty as never), true);

	const input = {
		description: '  Broadcast master  ',
		originator: 'Soundscaper',
		timeReference: '9007199254740993',
		umid: 'ab'.repeat(32),
		loudnessValue: -23,
		codingHistory: 'A=PCM,F=48000,W=24,M=stereo,T=Soundscaper\r\n',
	};
	const project = createAudioEditorProjectV6({
		title: 'Broadcast project',
		now: NOW,
		metadata: { title: 'Broadcast project', artist: 'Editor', bext: input },
	});

	assert.ok(project.metadata.bext);
	assert.deepEqual(project.metadata.bext, {
		description: '  Broadcast master  ',
		originator: 'Soundscaper',
		originatorReference: '',
		originationDate: '',
		originationTime: '',
		timeReference: '9007199254740993',
		version: 2,
		umid: `${'ab'.repeat(32)}${'0'.repeat(64)}`,
		loudnessValue: -23,
		loudnessRange: null,
		maxTruePeakLevel: null,
		maxMomentaryLoudness: null,
		maxShortTermLoudness: null,
		codingHistory: 'A=PCM,F=48000,W=24,M=stereo,T=Soundscaper\n',
	});
	assert.equal(project.metadata.artist, 'Editor');
	assert.equal(validateAudioEditorProjectV6(project), true);

	input.description = 'Changed after creation';
	assert.equal(project.metadata.bext.description, '  Broadcast master  ');
	const cloned = cloneAudioEditorProjectV6(project);
	assert.deepEqual(cloned, project);
	assert.notStrictEqual(cloned.metadata.bext, project.metadata.bext);
});

test('V6 BEXT normalization forces the project profile to version 2 and rejects invalid persistence', () => {
	assert.equal(normalizeProjectBextMetadata({ version: 2 }).version, 2);
	assert.throws(
		() => normalizeProjectBextMetadata({ timeReference: '-1' }),
		/time reference|timeReference|unsigned/u,
	);

	const project = createAudioEditorProjectV6({ now: NOW });
	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete (missing.metadata as Record<string, unknown>).bext;
	assert.throws(() => validateAudioEditorProjectV6(missing), /metadata\.bext/u);

	const partial = structuredClone(project) as unknown as Record<string, unknown>;
	(partial.metadata as Record<string, unknown>).bext = { description: 'Not canonical', version: 2 };
	assert.throws(() => validateAudioEditorProjectV6(partial), /normalized BEXT/u);
});

test('metadata commands normalize, replace, and clear V6 BEXT without exposing it to legacy schemas', () => {
	const project = createAudioEditorProjectV6({ now: NOW });
	const changes = {
		bext: {
			description: 'Command metadata',
			timeReference: '48000',
			codingHistory: 'Original row\r\n',
		},
	};
	const updated = applyEditorCommand(project, { type: 'metadata/update', changes }, { now: NOW });
	assert.equal(updated.metadata.bext?.description, 'Command metadata');
	assert.equal(updated.metadata.bext?.timeReference, '48000');
	assert.equal(updated.metadata.bext?.version, 2);
	assert.equal(updated.metadata.bext?.codingHistory, 'Original row\n');
	assert.deepEqual(changes.bext, {
		description: 'Command metadata',
		timeReference: '48000',
		codingHistory: 'Original row\r\n',
	});

	const cleared = applyEditorCommand(updated, {
		type: 'metadata/update',
		changes: { bext: null },
	}, { now: NOW });
	assert.equal(cleared.metadata.bext, null);
	assert.throws(() => applyEditorCommand(createAudioEditorProjectV5({ now: NOW }), {
		type: 'metadata/update',
		changes: { bext: null },
	}, { now: NOW }), /cannot be updated/u);
});

test('V5 migration adds null BEXT metadata without mutating legacy state', () => {
	const v5 = createAudioEditorProjectV5({
		id: 'legacy-v5',
		title: 'Legacy project',
		now: NOW,
		metadata: {
			title: 'Metadata title',
			artist: 'Legacy artist',
			tags: { ISRC: 'TEST123' },
		},
		opaqueExtensions: { retained: true },
	});
	const original = structuredClone(v5);
	const migrated = migrateAudioEditorProjectV5ToV6(v5);

	assert.deepEqual(v5, original);
	assert.equal(migrated.schemaVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.deepEqual(migrated.metadata, { ...(v5.metadata as Record<string, unknown>), bext: null });
	assert.deepEqual(migrated.opaqueExtensions, v5.opaqueExtensions);
	assert.equal(migrated.createdAt, v5.createdAt);
	assert.equal(migrated.updatedAt, v5.updatedAt);
	assert.deepEqual(migrateAudioEditorProject(v5), {
		project: migrateAudioEditorProjectV8ToV9(migrateAudioEditorProjectV7ToV8(migrateAudioEditorProjectV6ToV7(migrated))),
		migrated: true,
		fromVersion: 5,
		readOnly: false,
		reason: null,
	});
});

test('every legacy project schema migrates with uninitialized BEXT metadata', () => {
	const v1 = {
		schemaVersion: 1,
		id: 'legacy-v1',
		title: 'Legacy V1',
		revision: 0,
		createdAt: NOW,
		updatedAt: NOW,
		sampleRate: 48_000,
		masterChannels: 2,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [],
		clips: [],
		tracks: [],
		master: { gain: 1, effects: [] },
	};
	const legacyProjects = [
		v1,
		createAudioEditorProjectV2({ id: 'legacy-v2', now: NOW }),
		createAudioEditorProjectV3({ id: 'legacy-v3', now: NOW }),
		createAudioEditorProjectV4({ id: 'legacy-v4', now: NOW }),
		createAudioEditorProjectV5({ id: 'legacy-v5-all', now: NOW }),
	];
	const originals = structuredClone(legacyProjects);

	for (const legacy of legacyProjects) {
		const result = migrateAudioEditorProject(legacy);
		assert.equal(result.project.schemaVersion, 9);
		assert.equal(result.project.metadata.bext, null);
		assert.equal(result.project.metadata.adm, null);
		assert.equal(result.migrated, true);
		assert.equal(result.fromVersion, legacy.schemaVersion);
	}
	assert.deepEqual(legacyProjects, originals);
});

test('V6 loading clones canonical projects and preserves newer schemas read-only', () => {
	const current = createAudioEditorProjectV6({
		id: 'current-v6',
		now: NOW,
		metadata: { bext: { description: 'Current' } },
	});
	assert.deepEqual(loadAudioEditorProjectV6(current), {
		project: current,
		readOnly: false,
		reason: null,
	});
	assert.notStrictEqual(loadAudioEditorProjectV6(current).project, current);
	assert.deepEqual(migrateAudioEditorProject(current), {
		project: migrateAudioEditorProjectV8ToV9(migrateAudioEditorProjectV7ToV8(migrateAudioEditorProjectV6ToV7(current))),
		migrated: true,
		fromVersion: 6,
		readOnly: false,
		reason: null,
	});

	const futureV7 = { ...current, schemaVersion: 7, futureData: { retained: true } };
	assert.deepEqual(loadAudioEditorProjectV6(futureV7), {
		project: futureV7,
		readOnly: true,
		reason: 'newer-schema',
	});
	const future = { ...current, schemaVersion: 10, futureData: { retained: true } };
	assert.deepEqual(migrateAudioEditorProject(future), {
		project: future,
		migrated: false,
		fromVersion: 10,
		readOnly: true,
		reason: 'newer-schema',
	});
});
