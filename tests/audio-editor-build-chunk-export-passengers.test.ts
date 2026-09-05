/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { staticRelativeImports } from './helpers/eager-chunk-group-crossings.ts';

/**
 * Two modules sitting on the wrong side of the export boundary.
 *
 * The crossing guard finds an eagerly owned module that imports a lazily owned
 * one. It cannot find these two, and they are the same defect seen from the
 * other end. A module owned by an eager group whose only importers are lazy is
 * a passenger: its bytes are downloaded during startup for a feature nobody
 * opened. A module owned by a lazy group that an eagerly composed product
 * controller reaches is worse - it makes the whole optional chunk a static
 * dependency of the boot graph, which is what the byte budgets are for.
 */

const REPOSITORY_ROOT = new URL('../', import.meta.url);

/** The relative specifiers one repository module statically imports for value. */
function importsOf(path: string): readonly string[] {
	return staticRelativeImports(readFileSync(fileURLToPath(new URL(path, REPOSITORY_ROOT)), 'utf8'));
}

test('the loudness normalization render belongs to the export slice that alone uses it', () => {
	// `controller/rendered-audio-encoding.ts` is the only module that imports it, and
	// that module is lazily owned, so every byte of the normalization render was in
	// the startup graph of both products for an export nobody had asked for yet.
	assert.ok(
		importsOf('src/common/editor/controller/rendered-audio-encoding.ts')
			.includes('../loudness-normalization-render.ts'),
		'the lazy encoder must still be the reason this module has an owner',
	);
	assert.equal(
		chunkGroupForModulePath('src/common/editor/controller/rendered-audio-encoding.ts'),
		'editor-optional-export',
	);
	assert.equal(
		chunkGroupForModulePath('src/common/editor/loudness-normalization-render.ts'),
		'editor-optional-export',
	);
});

test('the detached export projection is eager, because an eagerly composed strategy calls it', () => {
	// `src/soundscaper/editor-controller.ts` composes the Soundscaper video export
	// strategy while it builds the controller, and that strategy calls
	// `createExportRenderProject` synchronously. While the projection belonged to the
	// lazy export owner, composing a Soundscaper editor made the whole optional export
	// chunk a static dependency of the boot graph.
	assert.ok(
		importsOf('src/soundscaper/editor-controller.ts').includes('./video-export-strategy.ts'),
		'the product controller must still compose the export strategy eagerly',
	);
	assert.ok(
		importsOf('src/soundscaper/video-export-strategy.ts')
			.includes('../common/editor/controller/export-render-project.ts'),
		'the strategy must still reach the projection through a static import',
	);
	assert.equal(
		chunkGroupForModulePath('src/common/editor/controller/export-render-project.ts'),
		'editor-controller-core',
	);
	// Moving it costs the boot graph only this module: both of its own dependencies
	// are already owned by eagerly loaded groups.
	for (const [path, owner] of [
		['src/common/editor/project.js', 'editor-storage-model'],
		['src/common/editor/track-folder-media-runtime.ts', 'editor-domain'],
	] as const) assert.equal(chunkGroupForModulePath(path), owner, path);
});
