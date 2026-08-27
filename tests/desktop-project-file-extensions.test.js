/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ACCEPTED_PROJECT_FILE_EXTENSIONS as DESKTOP_ACCEPTED,
	LEGACY_PROJECT_FILE_EXTENSION as DESKTOP_LEGACY,
	PRODUCT_ID,
	PROJECT_FILE_EXTENSION,
	READ_PROFILE_MATERIALIZED_V1,
	READ_PROFILE_SCAPE_RANGE_V1,
	SCAPE_PROJECT_MIME_TYPE,
} from '../desktop/constants.js';
import { extractProjectPaths, OPENABLE_PROJECT_EXTENSIONS } from '../desktop/file-associations.js';
import { readProfileForSelectedPath } from '../desktop/read-selection-service.js';
import { acceptsFile, mimeTypeForPath, validateSaveChoice } from '../desktop/validation.js';
import {
	ACCEPTED_PROJECT_FILE_EXTENSIONS,
	LEGACY_PROJECT_FILE_EXTENSION,
	projectFileExtensionForProduct,
} from '../src/common/project-file-extensions.ts';

// The Electron main process cannot import the shared registry, so the mirrored
// copy in desktop/constants.js has to be checked against it here.
test('the desktop constants mirror the shared project-file registry exactly', () => {
	assert.deepEqual([...DESKTOP_ACCEPTED], [...ACCEPTED_PROJECT_FILE_EXTENSIONS]);
	assert.equal(DESKTOP_LEGACY, LEGACY_PROJECT_FILE_EXTENSION);
	assert.equal(PROJECT_FILE_EXTENSION, projectFileExtensionForProduct(PRODUCT_ID));
});

test('a packaged build opens every project suffix but saves only its own', () => {
	for (const extension of ACCEPTED_PROJECT_FILE_EXTENSIONS) {
		assert.equal(acceptsFile('project', `/tmp/session${extension}`), true, extension);
		assert.equal(acceptsFile('project', `/tmp/session${extension.toUpperCase()}`), true, extension);
		assert.equal(mimeTypeForPath(`/tmp/session${extension}`), SCAPE_PROJECT_MIME_TYPE, extension);
		assert.equal(acceptsFile('media', `/tmp/session${extension}`), false, extension);
	}
	assert.equal(acceptsFile('project', '/tmp/session.sscape.zip'), false);
	const choice = validateSaveChoice({ purpose: 'project', suggestedName: 'session' });
	assert.equal(choice.suggestedName, `session${PROJECT_FILE_EXTENSION}`);
	assert.deepEqual(choice.filters, [{
		name: 'Scape project', extensions: [PROJECT_FILE_EXTENSION.slice(1)],
	}]);
});

test('every project suffix takes the Scape range profile, disguised ones do not', () => {
	for (const extension of ACCEPTED_PROJECT_FILE_EXTENSIONS) {
		assert.equal(
			readProfileForSelectedPath('project', `/tmp/session${extension.toUpperCase()}`),
			READ_PROFILE_SCAPE_RANGE_V1,
			extension,
		);
	}
	assert.equal(
		readProfileForSelectedPath('project', '/tmp/session.sscape.zip'),
		READ_PROFILE_MATERIALIZED_V1,
	);
	assert.equal(readProfileForSelectedPath('project', '/tmp/session.aup4'), READ_PROFILE_MATERIALIZED_V1);
	assert.equal(readProfileForSelectedPath('media', `/tmp/session${PROJECT_FILE_EXTENSION}`), READ_PROFILE_MATERIALIZED_V1);
});

test('positional and open-with routing admits every project suffix plus Audacity projects', () => {
	assert.deepEqual([...OPENABLE_PROJECT_EXTENSIONS], [...ACCEPTED_PROJECT_FILE_EXTENSIONS, '.aup3', '.aup4']);
	assert.deepEqual(
		extractProjectPaths([
			'--flag',
			'/tmp/a.sscape',
			'/tmp/b.FSCAPE',
			'/tmp/c.liscape',
			'/tmp/d.scape',
			'/tmp/e.aup4',
			'/tmp/f.sscape.zip',
			'/tmp/g.wav',
		], '/tmp'),
		['/tmp/a.sscape', '/tmp/b.FSCAPE', '/tmp/c.liscape', '/tmp/d.scape', '/tmp/e.aup4'],
	);
});
