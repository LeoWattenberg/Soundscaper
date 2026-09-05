/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import {
	staticRelativeDependencies,
	staticRelativeImports,
	staticRelativeReexports,
} from './helpers/eager-chunk-group-crossings.ts';

/**
 * The half of a barrel's dependencies the crossing guard could not see.
 *
 * The guard matched `import ... from` only, so every `export ... from` line was invisible
 * and a barrel's static dependencies did not exist as far as the eager/lazy boundary was
 * concerned. That is the worst possible blind spot to have, because a barrel is the one
 * module shape whose entire content is re-exports: `src/common/editor/ui/AudioEditorInspector.jsx`
 * named seven lazily loaded Inspector panels this way while `editor-shell` owned it, which
 * made all seven optional chunks static dependencies of the shell the moment anything
 * imported the barrel, and `src/common/editor/index.js` re-exported the AUP4 archive client
 * that `controller/deferred-archive-runtime.ts` exists to keep behind a dynamic import.
 *
 * A type-only re-export is not an edge: it is erased before the bundler sees it.
 */

const REPOSITORY_ROOT = new URL('../', import.meta.url);

function sourceOf(path: string): string {
	return readFileSync(fileURLToPath(new URL(path, REPOSITORY_ROOT)), 'utf8');
}

test('a value re-export is a static edge and a type-only one is not', () => {
	assert.deepEqual(
		staticRelativeReexports([
			"export { first } from './first.ts';",
			'export * from "./second.ts";',
			"export * as third from './third.ts';",
			"export type { Fourth } from './fourth.ts';",
			"export { type Fifth } from './fifth.ts';",
			"export { default as Sixth } from './sixth.jsx';",
		].join('\n')),
		['./first.ts', './second.ts', './third.ts', './sixth.jsx'],
	);
});

test('a declaration that opens with export never reaches a later statement for its specifier', () => {
	// `export function`, `export const` and `export class` open a line in nearly every
	// module. A lazily quantified clause would run from one of those to the `from` of the
	// next import and invent an edge, then swallow the real re-export that followed it.
	assert.deepEqual(
		staticRelativeReexports([
			'export const ready = true;',
			"import { helper } from './helper.ts';",
			'export function build() { return helper(); }',
			"export { shape } from './shape.ts';",
		].join('\n')),
		['./shape.ts'],
	);
});

test('the guard reads a barrel as imports followed by re-exports', () => {
	const source = [
		"import { local } from './local.ts';",
		"export { shared } from './shared.ts';",
	].join('\n');
	assert.deepEqual(staticRelativeImports(source), ['./local.ts']);
	assert.deepEqual(staticRelativeDependencies(source), ['./local.ts', './shared.ts']);
});

test('the public editor facade re-exports nothing the archive boundary keeps lazy', () => {
	// `aup4-client.js` is optional archive implementation with no owner, reached in
	// production only through `controller/deferred-archive-runtime.ts`. Re-exporting it from
	// the `editor-controller-core` barrel put it one static import from the boot graph.
	const facade = sourceOf('src/common/editor/index.js');
	assert.ok(!staticRelativeDependencies(facade).includes('./aup4-client.js'));
	assert.equal(chunkGroupForModulePath('src/common/editor/aup4-client.js'), null);
	assert.equal(chunkGroupForModulePath('src/common/editor/index.js'), 'editor-controller-core');
});

test('the legacy Inspector facade names its panels through dynamic imports only', () => {
	const facade = sourceOf('src/common/editor/ui/AudioEditorInspector.jsx');
	assert.deepEqual(
		staticRelativeReexports(facade),
		[],
		'a static re-export here makes every Inspector panel chunk a shell dependency',
	);
	for (const panel of [
		'AnalysisPanel.jsx',
		'AudioEditorEffectsOverlay.jsx',
		'AudioEditorMacroManagerDialog.jsx',
		'ClipPropertiesDialog.jsx',
		'ExportDialog.jsx',
		'LabelExportDialog.jsx',
		'SelectionEffectsDialog.jsx',
	]) {
		assert.match(facade, new RegExp(`import\\('\\./inspector/${panel.replace('.', '\\.')}'\\)`, 'u'), panel);
	}
});
