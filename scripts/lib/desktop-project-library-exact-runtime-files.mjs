/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact-generation files staged for immutable V12 and selected V17. */
export const DESKTOP_PROJECT_LIBRARY_EXACT_RUNTIME_FILES = Object.freeze([
	'desktop/project-library-exact-generation-contract.js',
	'desktop/project-library-exact-generation-database.js',
	'desktop/project-library-exact-generation-lifecycle.js',
	'desktop/project-library-exact-generation-main-channels.js',
	'desktop/project-library-exact-generation-main-ipc.js',
	'desktop/project-library-exact-generation-main.js',
	'desktop/project-library-exact-generation-storage.js',
	'desktop/project-library-session-admission.js',
	...['contract', 'current-project', 'database', 'main-channels', 'main-ipc', 'main', 'values']
		.map((name) => `desktop/project-library-v12-${name}.js`),
	...['contract', 'current-project', 'database', 'import', 'main-channels', 'main-ipc', 'main', 'writer']
		.map((name) => `desktop/project-library-v17-${name}.js`),
]);
