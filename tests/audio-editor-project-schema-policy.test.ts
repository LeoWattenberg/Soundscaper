/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_SCHEMA_VERSION,
	ProjectReimportRequiredError,
	readProjectSchemaIdentity,
} from '../src/common/editor/project-schema-identity.ts';

test('every numeric-only pre-release identity fails with the shared typed re-import requirement', () => {
	for (const schemaVersion of [1, 17, 21, 30, 32]) {
		assert.throws(
			() => readProjectSchemaIdentity({ schemaVersion }),
			(error: unknown) => error instanceof ProjectReimportRequiredError
				&& error.code === 'REIMPORT_REQUIRED'
				&& error.schemaVersion === schemaVersion
				&& error.currentSchemaVersion === PROJECT_SCHEMA_VERSION,
		);
	}
});

test('the identity reader returns the exact family tuple', () => {
	assert.deepEqual(readProjectSchemaIdentity({
		schemaFamily: 'soundscaper',
		schemaVersion: PROJECT_SCHEMA_VERSION,
	}), { schemaFamily: 'soundscaper', schemaVersion: 1 });
});
