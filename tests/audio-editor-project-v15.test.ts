/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
	cloneCurrentAudioEditorProject,
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	isSourceCharacteristicsProjectSchema,
	isTimelineAnnotationProjectSchema,
	isTrackFolderProjectSchema,
	isTrackLockProjectSchema,
} from '../src/common/editor/project-schema-version.ts';
import {
	createAudioTrackV10,
	createLabelTrackV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import {
	createAudioEditorProjectV14,
	validateAudioEditorProjectV14,
} from '../src/common/editor/project-v14.ts';
import {
	AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION,
	cloneAudioEditorProjectV15,
	createAudioEditorProjectV15,
	loadAudioEditorProjectV15,
	validateAudioEditorProjectV15,
	type AudioEditorProjectV15,
} from '../src/common/editor/project-v15.ts';
import { projectTrackFolderMediaStateV12 } from '../src/common/editor/track-folder-media-runtime.ts';

const NOW = '2026-08-11T14:00:00.000Z';

function allTrackKindsProject(): AudioEditorProjectV15 {
	return createAudioEditorProjectV15({
		id: 'v15-track-locks',
		title: 'V15 track locks',
		now: NOW,
		tracks: [
			createAudioTrackV10({ id: 'audio', name: 'Audio' }),
			createVideoTrackV10({ id: 'video', name: 'Video', locked: true }),
			createLabelTrackV10({ id: 'label', name: 'Labels' }),
		],
	});
}

test('V15 is exact current and defaults a required lock for every track kind', () => {
	const project = allTrackKindsProject();

	assert.equal(AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION, 15);
	assert.equal(AUDIO_EDITOR_PROJECT_SCHEMA_VERSION, 15);
	assert.equal(AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, 15);
	assert.equal(project.schemaVersion, 15);
	assert.deepEqual(project.tracks.map(({ type, locked }) => ({ type, locked })), [
		{ type: 'audio', locked: false },
		{ type: 'video', locked: true },
		{ type: 'label', locked: false },
	]);
	for (const track of project.tracks) {
		const descriptor = Object.getOwnPropertyDescriptor(track, 'locked');
		assert.equal(descriptor?.enumerable, true);
		assert.equal(Object.hasOwn(descriptor ?? {}, 'value'), true);
		assert.equal(typeof descriptor?.value, 'boolean');
	}
	assert.equal(validateAudioEditorProjectV15(project), true);
	assert.equal(validateCurrentAudioEditorProject(project), true);
});

test('V15 rejects a missing, hidden, accessor-backed, or non-boolean track lock', () => {
	const project = allTrackKindsProject();
	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete (missing.tracks as Record<string, unknown>[])[0]!.locked;
	assert.throws(() => validateAudioEditorProjectV15(missing), /locked.*own.*data property/iu);

	const hidden = structuredClone(project) as unknown as Record<string, unknown>;
	Object.defineProperty((hidden.tracks as Record<string, unknown>[])[0], 'locked', {
		enumerable: false,
		value: false,
	});
	assert.throws(
		() => validateAudioEditorProjectV15(hidden),
		/locked.*own.*enumerable.*data property|properties must be enumerable data properties/iu,
	);

	let getterCalls = 0;
	const accessor = structuredClone(project) as unknown as Record<string, unknown>;
	Object.defineProperty((accessor.tracks as Record<string, unknown>[])[0], 'locked', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return false;
		},
	});
	assert.throws(
		() => validateAudioEditorProjectV15(accessor),
		/locked.*data property|accessor|properties must be enumerable data properties/iu,
	);
	assert.equal(getterCalls, 0);

	const invalid = structuredClone(project) as unknown as Record<string, unknown>;
	(invalid.tracks as Record<string, unknown>[])[0]!.locked = 'false';
	assert.throws(() => validateAudioEditorProjectV15(invalid), /locked.*boolean/iu);
});

test('V15 clone/load preserve locks, V14 remains historical, and V16 stays opaque read-only', () => {
	const project = allTrackKindsProject();
	const clone = cloneAudioEditorProjectV15(project);
	const loaded = loadAudioEditorProjectV15(JSON.parse(JSON.stringify(project)) as unknown);

	assert.notStrictEqual(clone, project);
	assert.deepEqual(clone, project);
	assert.deepEqual(loaded, { project, readOnly: false, reason: null });
	assert.equal(clone.tracks[1]?.locked, true);

	const v14 = createAudioEditorProjectV14({ id: 'historical-v14', now: NOW });
	assert.equal(validateAudioEditorProjectV14(v14), true);
	assert.throws(() => validateAudioEditorProjectV15(v14), /unsupported audio editor schema version/iu);
	assert.throws(() => loadAudioEditorProjectV15(v14), /unsupported audio editor schema version/iu);

	const future = { ...project, schemaVersion: 16, futureState: { retained: true } };
	const futureLoaded = loadAudioEditorProjectV15(future);
	assert.deepEqual(futureLoaded, {
		project: future,
		readOnly: true,
		reason: 'newer-schema',
	});
	assert.notStrictEqual(futureLoaded.project, future);
});

test('current aliases and inherited schema predicates route V15 through every owning domain', () => {
	const project = createCurrentAudioEditorProject({ now: NOW });
	const clone = cloneCurrentAudioEditorProject(project);
	const loaded = loadCurrentAudioEditorProject(project);

	assert.equal(project.schemaVersion, 15);
	assert.deepEqual(clone, project);
	assert.deepEqual(loaded, { project, readOnly: false, reason: null });
	assert.equal(isTimelineAnnotationProjectSchema(15), true);
	assert.equal(isTrackFolderProjectSchema(15), true);
	assert.equal(isSourceCharacteristicsProjectSchema(15), true);
	assert.equal(isTrackLockProjectSchema(15), true);
	assert.equal(isTrackLockProjectSchema(14), false);
});

test('the exact-current folder media projection retains V15 lock state', () => {
	const project = createAudioEditorProjectV15({
		id: 'v15-folder-projection',
		now: NOW,
		tracks: [createAudioTrackV10({ id: 'audio', name: 'Audio', locked: true, mute: false })],
		trackFolders: [{
			id: 'folder', name: 'Folder', collapsed: false, height: 40,
			hidden: false, mute: true, solo: false,
		}],
		sequences: [{
			id: 'main-sequence',
			trackNodes: [
				{ kind: 'folder', id: 'folder', parentFolderId: null },
				{ kind: 'track', id: 'audio', parentFolderId: 'folder' },
			],
		}],
	});
	const projected = projectTrackFolderMediaStateV12(project);

	assert.notStrictEqual(projected, project);
	assert.equal(project.tracks[0]?.mute, false);
	assert.equal(projected.tracks[0]?.mute, true);
	assert.equal(projected.tracks[0]?.locked, true);
});

test('V15 track commands default new locks and preserve or update existing lock state', () => {
	let project = createAudioEditorProjectV15({ id: 'track-commands', now: NOW });
	for (const track of [
		createAudioTrackV10({ id: 'audio', name: 'Audio' }),
		createVideoTrackV10({ id: 'video', name: 'Video' }),
		createLabelTrackV10({ id: 'label', name: 'Labels' }),
	]) {
		project = applyEditorCommand(project, { type: 'track/add', track });
	}
	assert.deepEqual(project.tracks.map(({ locked }) => locked), [false, false, false]);

	project = applyEditorCommand(project, {
		type: 'track/update',
		trackId: 'video',
		changes: { locked: true },
	});
	assert.equal(project.tracks.find(({ id }) => id === 'video')?.locked, true);

	project = applyEditorCommand(project, {
		type: 'track/update',
		trackId: 'video',
		changes: { name: 'Renamed video' },
	});
	assert.equal(project.tracks.find(({ id }) => id === 'video')?.locked, true);
	assert.equal(validateAudioEditorProjectV15(project), true);
});
