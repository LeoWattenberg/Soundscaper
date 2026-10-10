/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import { editorProjectRuntimeProfileDefinition } from '../src/common/editor/project-runtime-profile.ts';
import { editorProjectRuntimeProfilePrerequisiteDefinition } from '../src/common/editor/project-runtime-profile-prerequisite.ts';
import { editorProjectFeatureCapabilityProfileDefinition } from '../src/common/editor/project-feature-capability-profile.ts';
import { MOTIONSCAPER_PROJECT_STORAGE_PROFILE } from '../src/motionscaper/editor-project-storage-profile.ts';
import {
	MOTIONSCAPER_PROJECT_RUNTIME_PROFILE, assertMotionscaperProjectRuntimeProfile,
} from '../src/motionscaper/editor-project-runtime-profile.ts';

test('motion libraries, workers and locks use an independent family-v1 namespace', () => {
	assert.deepEqual({ ...editorProjectStorageProfileNames(MOTIONSCAPER_PROJECT_STORAGE_PROFILE) }, {
		databaseName: 'kw-media-motionscaper-editor-v1',
		opfsDirectoryName: 'motionscaper-editor-v1-sources',
		opfsWorkerName: 'motionscaper-editor-v1-opfs-storage',
		projectLockPrefix: 'kw-media-motionscaper-editor-v1-lock:',
	});
});

test('motion runtime authenticates independent document and capability ownership', () => {
	assertMotionscaperProjectRuntimeProfile(MOTIONSCAPER_PROJECT_RUNTIME_PROFILE);
	assert.throws(() => assertMotionscaperProjectRuntimeProfile({}), /authenticated/u);
	const definition = editorProjectRuntimeProfileDefinition(MOTIONSCAPER_PROJECT_RUNTIME_PROFILE);
	const prerequisite = editorProjectRuntimeProfilePrerequisiteDefinition(definition.prerequisite);
	assert.equal(prerequisite.owner, 'motionscaper');
	assert.equal(prerequisite.storageProfile, MOTIONSCAPER_PROJECT_STORAGE_PROFILE);
	assert.equal(prerequisite.projectSchemaVersion, 1);
	assert.deepEqual(prerequisite.scapeFormatVersions, [1]);
	assert.deepEqual(prerequisite.desktopLibraryScope, ['Motionscaper', 'project-library', 'v1']);
	assert.equal(prerequisite.futureSchemaPolicy, 'opaque-read-only');
	const capability = editorProjectFeatureCapabilityProfileDefinition(definition.capabilityProfile);
	assert.equal(capability.owner, 'motionscaper');
	assert.ok(capability.registrations.every((entry) => entry.available === false),
		'authoring capabilities must remain unavailable until their implementation gates pass');
});
