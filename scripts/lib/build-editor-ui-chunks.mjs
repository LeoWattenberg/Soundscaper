/* SPDX-License-Identifier: AGPL-3.0-only */

import { DESIGN_SYSTEM_EDITOR_SHELL_COMPONENT_CHUNK_TEST, EDITOR_VARISPEED_CONTROL_CHUNK_TEST } from './build-chunk-tests.mjs';

/** @type {import('rolldown').CodeSplittingGroup[]} */
export const EDITOR_UI_CHUNK_GROUPS = [
	{
		// The optional toolbar adapter and its upstream component initialize together.
		name: 'editor-varispeed-control',
		test: EDITOR_VARISPEED_CONTROL_CHUNK_TEST,
		priority: 99,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Components used by the ready editor shell belong to that consumer. Components
		// reached only by a lazy dialog remain unowned and follow the dialog instead of
		// being hoisted into a broad shared vendor chunk.
		name: 'editor-shell-design-components',
		test: DESIGN_SYSTEM_EDITOR_SHELL_COMPONENT_CHUNK_TEST,
		priority: 94,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
];
