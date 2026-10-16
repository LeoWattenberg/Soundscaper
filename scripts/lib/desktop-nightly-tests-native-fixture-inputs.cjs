/* SPDX-License-Identifier: AGPL-3.0-only */

const externalDisplaySources = require('./desktop-nightly-tests-external-display-inputs.cjs');

// The preload fixture bundles these maintained sources with its two exact
// project-library-runtime aliases; no generated desktop runtime is required.
module.exports = Object.freeze([
	...externalDisplaySources,
	'desktop/preload.mjs',
	'desktop/ara-preload.ts',
	'desktop/blender-preload.ts',
	'src/common/editor/ara-contract.ts',
	'src/common/editor/blender-contract.ts',
]);
