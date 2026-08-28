/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectRuntimeProfileDefinition } from
	'../src/common/editor/project-runtime-profile.ts';
import { editorProjectRuntimeProfilePrerequisiteDefinition } from
	'../src/common/editor/project-runtime-profile-prerequisite.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
	assertFramescaperProjectRuntimeProfile,
} from '../src/framescaper/editor-project-runtime-profile.ts';

test('Framescaper owns one authenticated family-v1 runtime profile', () => {
	const definition = editorProjectRuntimeProfileDefinition(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const prerequisite = editorProjectRuntimeProfilePrerequisiteDefinition(definition.prerequisite);
	assert.deepEqual(prerequisite, {
		owner: 'framescaper',
		projectSchemaVersion: 1,
		storageProfile: prerequisite.storageProfile,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1],
		attachedScapeFormatVersion: 1,
		desktopLibrarySchemaVersion: 1,
		desktopProjectSchemaVersion: 1,
		desktopDatabaseUserVersion: 1,
		desktopLibraryScope: ['kw.media', 'framescaper-project-library', 'v1'],
	});
	assert.doesNotThrow(() => assertFramescaperProjectRuntimeProfile(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
	));
	assert.throws(() => assertFramescaperProjectRuntimeProfile({}), /Framescaper 1\.0/u);
});
