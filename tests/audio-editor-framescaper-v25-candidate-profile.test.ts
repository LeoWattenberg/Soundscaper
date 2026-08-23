/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../src/common/editor/project-feature-capability-profile.ts';
import {
	editorProjectRuntimeProfileDefinition,
} from '../src/common/editor/project-runtime-profile.ts';
import {
	editorProjectRuntimeProfilePrerequisiteDefinition,
} from '../src/common/editor/project-runtime-profile-prerequisite.ts';
import {
	FRAMESCAPER_V25_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from '../src/framescaper/editor-project-feature-capability-profile-v25.ts';
import {
	FRAMESCAPER_PROJECT_V25_CLIPBOARD_VERSION,
	FRAMESCAPER_PROJECT_V25_RENDER_PLAN_VERSION,
	FRAMESCAPER_V25_CANDIDATE_CONTRACT,
	FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import {
	createFramescaperDesktopProjectLibraryV15Handshake,
	createFramescaperDesktopProjectLibraryV15Paths,
	validateFramescaperDesktopProjectLibraryV15Handshake,
} from '../desktop/project-library-v15-contract.ts';

test('the V25 candidate pins the approved cumulative compatibility identity', () => {
	assert.deepEqual(FRAMESCAPER_V25_CANDIDATE_CONTRACT, {
		status: 'dormant-candidate',
		projectSchemaVersion: 25,
		desktopLibrarySchemaVersion: 15,
		desktopDatabaseUserVersion: 17,
		desktopLibraryScopeVersion: 'v15',
		clipboardVersion: 9,
		renderPlanVersion: 11,
	});
	assert.equal(FRAMESCAPER_PROJECT_V25_CLIPBOARD_VERSION, 9);
	assert.equal(FRAMESCAPER_PROJECT_V25_RENDER_PLAN_VERSION, 11);
	const definition = editorProjectRuntimeProfileDefinition(FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE);
	const prerequisite = editorProjectRuntimeProfilePrerequisiteDefinition(definition.prerequisite);
	assert.equal(prerequisite.projectSchemaVersion, 25);
	assert.equal(prerequisite.desktopLibrarySchemaVersion, 15);
	assert.equal(prerequisite.desktopDatabaseUserVersion, 17);
	assert.deepEqual(prerequisite.desktopLibraryScope, ['kw.media', 'scape-project-library', 'v15']);
	assert.equal(prerequisite.priorSchemaPolicy, 'reimport-required');
	assert.equal(prerequisite.futureSchemaPolicy, 'opaque-read-only');
});

test('the candidate enables inherited transitions and V24 visual prerequisites for tests', () => {
	const rows = new Map(editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V25_PROJECT_FEATURE_CAPABILITY_PROFILE,
	).registrations.map((row) => [row.key, row.available]));
	for (const key of [
		'videoTransitions', 'videoTransitionDissolve', 'videoStills', 'videoGenerators',
		'videoAdjustmentLayers', 'videoMasksMattes', 'videoFreeze',
	]) assert.equal(rows.get(key), true, key);
	assert.equal(rows.get('videoRetime'), true, 'the candidate inherits activated V20 retime');
});

test('desktop V15 keeps an exact isolated handshake and path scope', () => {
	const handshake = createFramescaperDesktopProjectLibraryV15Handshake();
	assert.deepEqual(handshake, {
		kind: 'framescaper-project-library-handshake',
		version: 1,
		owner: 'framescaper',
		projectSchemaVersion: 25,
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		storageDatabaseName: 'kw-media-framescaper-editor-v25',
		desktopLibrarySchemaVersion: 15,
		desktopDatabaseUserVersion: 17,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v15'],
	});
	assert.deepEqual(validateFramescaperDesktopProjectLibraryV15Handshake(handshake), handshake);
	assert.equal(
		createFramescaperDesktopProjectLibraryV15Paths('/tmp/framescaper-v25').libraryRoot,
		'/tmp/framescaper-v25/kw.media/scape-project-library/v15',
	);
	assert.throws(() => validateFramescaperDesktopProjectLibraryV15Handshake({
		...handshake, desktopLibrarySchemaVersion: 12,
	}), /identity is unsupported/u);
});

test('V25 stays dormant: the shipped App route does not import it', async () => {
	const app = await readFile(new URL('../src/common/site/App.jsx', import.meta.url), 'utf8');
	assert.doesNotMatch(app, /FramescaperAudioEditorBootstrapV25|runtime-profile-v25/u);
});
