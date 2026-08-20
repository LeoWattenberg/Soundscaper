/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createAudioTrack,
	createLabelTrack,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	cloneCurrentAudioEditorProject,
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import { validateProjectTrackLocks } from '../src/common/editor/project-track-lock-validation.ts';
import { projectTrackFolderMediaStateV12 } from '../src/common/editor/track-folder-media-runtime.ts';

const NOW = '2026-08-11T14:00:00.000Z';

function allTrackKindsProject(): AudioEditorProjectCurrent {
	return createCurrentAudioEditorProject({
		id: 'current-track-locks',
		title: 'Current track locks',
		now: NOW,
		tracks: [
			createAudioTrack({ id: 'audio', name: 'Audio' }),
			createVideoTrack({ id: 'video', name: 'Video', locked: true }),
			createLabelTrack({ id: 'label', name: 'Labels' }),
		],
	});
}

test('current construction defaults an enumerable lock for every track kind', () => {
	const project = allTrackKindsProject();

	assert.equal(project.schemaVersion, 17);
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
	validateProjectTrackLocks(project);
	assert.equal(validateCurrentAudioEditorProject(project), true);
});

test('neutral lock validation rejects missing, hidden, accessor-backed, and non-boolean state', () => {
	const project = allTrackKindsProject();
	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete (missing.tracks as Record<string, unknown>[])[0]!.locked;
	assert.throws(() => validateProjectTrackLocks(missing), /locked.*own.*data property/iu);
	assert.throws(() => validateCurrentAudioEditorProject(missing), /locked.*own.*data property/iu);

	const hidden = structuredClone(project) as unknown as Record<string, unknown>;
	Object.defineProperty((hidden.tracks as Record<string, unknown>[])[0], 'locked', {
		enumerable: false,
		value: false,
	});
	assert.throws(
		() => validateProjectTrackLocks(hidden),
		/locked.*own.*enumerable.*data property/iu,
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
	assert.throws(() => validateProjectTrackLocks(accessor), /locked.*data property/iu);
	assert.equal(getterCalls, 0);

	const invalid = structuredClone(project) as unknown as Record<string, unknown>;
	(invalid.tracks as Record<string, unknown>[])[0]!.locked = 'false';
	assert.throws(() => validateProjectTrackLocks(invalid), /locked.*boolean/iu);
});

test('current clone and load preserve lock authority without aliases', () => {
	const project = allTrackKindsProject();
	const clone = cloneCurrentAudioEditorProject(project);
	const loaded = loadCurrentAudioEditorProject(JSON.parse(JSON.stringify(project)) as unknown);

	assert.notStrictEqual(clone, project);
	assert.deepEqual(clone, project);
	assert.notStrictEqual(clone.tracks, project.tracks);
	assert.deepEqual(loaded, { project, readOnly: false, reason: null });
	assert.equal(clone.tracks[1]?.locked, true);
});

test('folder media projection retains current lock state while applying folder media state', () => {
	const project = createCurrentAudioEditorProject({
		id: 'current-folder-projection',
		now: NOW,
		tracks: [createAudioTrack({ id: 'audio', name: 'Audio', locked: true, mute: false })],
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

test('current track commands default and retain lock authority', () => {
	let project = createCurrentAudioEditorProject({ id: 'track-commands', now: NOW });
	for (const track of [
		createAudioTrack({ id: 'audio', name: 'Audio' }),
		createVideoTrack({ id: 'video', name: 'Video' }),
		createLabelTrack({ id: 'label', name: 'Labels' }),
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
	assert.equal(validateCurrentAudioEditorProject(project), true);
});
