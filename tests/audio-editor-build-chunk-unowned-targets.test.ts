/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import {
	eagerImportsOfLazyOwners,
	REACHABILITY_PLACED_TARGETS,
	staticRelativeImports,
} from './helpers/eager-chunk-group-crossings.ts';

/**
 * What the chunk-crossing guard was blind to, and what it is allowed to forgive.
 *
 * The guard reports an eagerly owned module that statically imports a lazily
 * owned one. Until this file existed it skipped a target with no owner at all,
 * which is the more dangerous half: an unowned module is placed by reachability,
 * so a leaf that a lazily imported dialog reaches is emitted inside that dialog's
 * chunk even when eagerly loaded shell code imports it too. That is exactly the
 * `video-delivery-frame-rate.ts` failure the ownership test documents - every
 * route failing to mount with `TypeError: y is not a function`.
 *
 * It was also blind to a double-quoted specifier, which made the whole static
 * import list of `nyquist/plugin-registry.js` invisible.
 *
 * `REACHABILITY_PLACED_TARGETS` is the escape hatch, and every entry carries the
 * reason its placement is safe. This file keeps those reasons honest: an entry
 * that has gained an owner, or that no longer exists, is a stale claim.
 */

const EDITOR_UI_DIRECTORY = fileURLToPath(new URL('../src/common/editor/ui/', import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));

test('a crossing into a module with no owner is reported rather than skipped', () => {
	const crossings = eagerImportsOfLazyOwners([EDITOR_UI_DIRECTORY], new Set());
	assert.ok(
		crossings.includes(
			'src/common/editor/ui/workspace-runtime.js [editor-shell] -> src/common/i18n/locale.js [unowned]',
		),
		`an unowned target must be reported as [unowned], got ${JSON.stringify(crossings)}`,
	);
});

test('a double-quoted specifier is a static import like any other', () => {
	// `src/common/editor/nyquist/plugin-registry.js` spells its imports with double
	// quotes, so every dependency of an eagerly owned effect-contract module was
	// invisible to the guard.
	assert.deepEqual(
		staticRelativeImports([
			'import { first } from "./first.ts";',
			"import { second } from './second.ts';",
			'import type { Third } from "./third.ts";',
			'import { type Fourth } from "./fourth.ts";',
		].join('\n')),
		['./first.ts', './second.ts'],
	);
});

test('every reasoned unowned target still exists, is still unowned, and says why', () => {
	for (const [path, reason] of REACHABILITY_PLACED_TARGETS) {
		assert.ok(existsSync(resolve(REPOSITORY_ROOT, path)), `${path} must exist`);
		assert.equal(chunkGroupForModulePath(path), null, `${path} has an owner now, so its reason is stale`);
		assert.ok(reason.length > 40, `${path} must record why its reachability placement is safe`);
	}
});

test('the shared leaves an eager importer reaches keep the owner that importer already loads', () => {
	// Each of these was unowned while an eagerly owned module imported it, so a
	// lazily imported dialog that also reads it could take the leaf into its own
	// chunk and make the shell statically import that chunk. The owner named here
	// is one the eager importer's own product graph already downloads, so nothing
	// new joins the startup graph.
	for (const [path, owner] of [
		['src/common/products.js', 'editor-shell'],
		['src/common/editor/audacity-effects/manifest.js', 'editor-effect-contracts'],
		['src/common/editor/nyquist/plugin-parser.js', 'editor-effect-contracts'],
		['src/common/editor/nyquist/plugins/catalog.js', 'editor-effect-contracts'],
		['desktop/desktop-audio-codec-capability-contract.ts', 'editor-codec-foundations'],
		['desktop/desktop-audio-codec-operation-contract.ts', 'editor-codec-foundations'],
		['src/common/editor/design-system-adapters/canvas.ts', 'editor-domain'],
		['src/common/editor/design-system-adapters/control-values.ts', 'editor-domain'],
		['src/common/editor/design-system-adapters/timeline.ts', 'editor-domain'],
		['src/common/editor/design-system-adapters/validation.ts', 'editor-domain'],
		['src/common/editor/design-system-adapters/waveform.ts', 'editor-domain'],
		['src/common/editor/design-system-adapters/waveform-internals.ts', 'editor-domain'],
	] as const) {
		assert.equal(chunkGroupForModulePath(path), owner, path);
	}
});
