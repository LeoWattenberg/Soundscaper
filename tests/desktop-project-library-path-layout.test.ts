/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFixedProjectLibraryPaths,
	fixedProjectLibraryPaths,
	isProjectLibraryDescendant,
} from '../desktop/project-library-path-layout.ts';

test('product-specific scopes share one fixed SQLite and media directory layout', () => {
	const framescaper = createFixedProjectLibraryPaths('/app-data', ['kw.media', 'framescaper-project-library', 'v1']);
	const soundscaper = createFixedProjectLibraryPaths('/app-data', ['kw.media', 'soundscaper-project-library', 'v1']);
	assert.equal(framescaper.databasePath, '/app-data/kw.media/framescaper-project-library/v1/library.sqlite3');
	assert.equal(framescaper.projectsRoot, `${framescaper.libraryRoot}/projects`);
	assert.equal(framescaper.managedMediaRoot, `${framescaper.libraryRoot}/media`);
	assert.deepEqual(fixedProjectLibraryPaths(soundscaper.libraryRoot), soundscaper);
	assert.equal(isProjectLibraryDescendant('/app-data', framescaper.libraryRoot), true);
	assert.equal(isProjectLibraryDescendant('/app-data', '/app-data'), false);
	assert.equal(isProjectLibraryDescendant('/app-data', '/elsewhere'), false);
});
