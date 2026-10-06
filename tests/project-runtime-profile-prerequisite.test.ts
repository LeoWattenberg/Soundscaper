/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorProjectRuntimeProfilePrerequisite,
	editorProjectRuntimeProfilePrerequisiteDefinition,
} from '../src/common/editor/project-runtime-profile-prerequisite.ts';
import { createEditorProjectStorageProfile } from
	'../src/common/editor/storage/project-storage-profile.ts';

const DEFINITION = {
	owner: 'test-editor',
	projectSchemaVersion: 1,
	storageProfile: createEditorProjectStorageProfile({
		databaseName: 'test-editor-v1',
		opfsDirectoryName: 'test-editor-v1',
		opfsWorkerName: 'test-editor-worker-v1',
		projectLockPrefix: 'test-editor-v1:',
	}),
	priorSchemaPolicy: 'reimport-required',
	futureSchemaPolicy: 'opaque-read-only',
	scapeFormatVersions: [1],
	attachedScapeFormatVersion: 1,
	desktopLibrarySchemaVersion: 1,
	desktopProjectSchemaVersion: 1,
	desktopDatabaseUserVersion: 1,
} as const;

test('desktop library scopes preserve application folder casing', () => {
	for (const product of ['Soundscaper', 'Framescaper']) {
		const scope = [product, 'project-library', 'v1'];
		const prerequisite = createEditorProjectRuntimeProfilePrerequisite({
			...DEFINITION, desktopLibraryScope: scope,
		});
		const stored = editorProjectRuntimeProfilePrerequisiteDefinition(prerequisite).desktopLibraryScope;
		assert.deepEqual(stored, scope);
		assert.notEqual(stored, scope);
		assert.ok(Object.isFrozen(stored));
	}
});

test('desktop library scopes reject traversal, separators and invalid folder names', () => {
	for (const segment of ['.', '..', '../Soundscaper', 'Soundscaper/library',
		'Soundscaper\\library', 'Soundscaper\0', 'Soundscaper.', ' Soundscaper', 'S'.repeat(129)]) {
		assert.throws(() => createEditorProjectRuntimeProfilePrerequisite({
			...DEFINITION, desktopLibraryScope: [segment, 'project-library', 'v1'],
		}), /contains an invalid segment/u);
	}
});
