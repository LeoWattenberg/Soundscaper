/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AudioEditorProjectReimportRequiredError,
	migrateAudioEditorProject,
} from '../src/common/editor/migration.js';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

test('pre-release older raw schemas fail with a typed re-import requirement', () => {
	for (let schemaVersion = 1; schemaVersion < AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION; schemaVersion += 1) {
		assert.throws(
			() => migrateAudioEditorProject({ schemaVersion }),
			(error: unknown) => error instanceof AudioEditorProjectReimportRequiredError
				&& error.code === 'REIMPORT_REQUIRED'
				&& error.schemaVersion === schemaVersion
				&& error.currentSchemaVersion === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		);
	}
});

test('the current raw schema remains editable and a future schema remains opaque read-only', () => {
	const current = createAudioEditorProjectV10({
		id: 'current',
		title: 'Current',
		now: '2026-08-09T00:00:00.000Z',
	});
	const loaded = migrateAudioEditorProject(current);
	assert.equal(loaded.readOnly, false);
	assert.equal(loaded.fromVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.deepEqual(loaded.project, current);
	assert.notStrictEqual(loaded.project, current);

	const future = {
		...current,
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION + 1,
		futureState: { preserved: true },
	};
	const futureLoaded = migrateAudioEditorProject(future);
	assert.deepEqual(futureLoaded, {
		project: future,
		migrated: false,
		fromVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION + 1,
		readOnly: true,
		reason: 'newer-schema',
	});
	assert.notStrictEqual(futureLoaded.project, future);
});
