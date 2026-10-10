/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { EAGER_CHUNK_GROUPS, resolveRelativeModule, sourceModules, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PNG = 'src/common/editor/imaging/pixel-frame-png-v1.ts';
const EXPORT_COPY = 'src/common/i18n/lightscaper-photo-png-export-copy.ts';
const MENU_COPY = 'src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
const PHOTO_OWNERS = new Set(['editor-neutral-foundations', 'editor-photo-library-scalars', 'editor-imaging',
	'editor-media-storage-contracts', 'editor-media-custody-storage', 'editor-closed-domain-values',
	'editor-dialog-foundations', 'editor-file-saving', 'editor-scape-archive-bytes',
	'lightscaper-editor-copy', 'lightscaper-develop-copy', 'editor-visual-effect-copy']);
const PHOTO_COOWNERS = sourceModules(resolve(ROOT, 'src'))
	.filter(path => PHOTO_OWNERS.has(chunkGroupForModulePath(path) ?? ''));
const RUNTIME_SOURCE = new Map<string, string>();

test('PNG byte encoding has an exact optional owner without acquiring shared codec dependencies', () => {
	for (const separator of ['/', '\\']) {
		assert.equal(chunkGroupForModulePath(PNG.replaceAll('/', separator)), 'editor-png-bytes');
		for (const path of [PNG + '.foreign', PNG.replace('-v1.', '-v2.'), PNG.replace('imaging/', 'imaging/foreign/')]) {
			assert.notEqual(chunkGroupForModulePath(path.replaceAll('/', separator)), 'editor-png-bytes', path);
		}
	}
	const owner = chunkGroups.find(group => group.name === 'editor-png-bytes'); assert.ok(owner);
	assert.equal(owner.priority, 99); assert.equal(owner.minSize, 0); assert.equal(owner.maxSize, 400_000);
	assert.equal(owner.includeDependenciesRecursively, false);
	assert.ok(!EAGER_CHUNK_GROUPS.has('editor-png-bytes'));
});

test('existing frame contracts and shared fflate retain their established owners', () => {
	for (const separator of ['/', '\\']) {
		for (const path of ['imaging/pixel-frame-contract-v1.ts', 'imaging/pixel-frame-admission-v1.ts', 'timeline-image-frame-pack-v1.ts']) {
			assert.equal(chunkGroupForModulePath(`src/common/editor/${path}`.replaceAll('/', separator)), 'editor-imaging', path);
		}
		assert.equal(chunkGroupForModulePath('node_modules/fflate/esm/browser.js'.replaceAll('/', separator)), 'vendor');
	}
	assert.match(runtimeSource(resolve(ROOT, 'src/common/editor/timeline-image-frame-pack-v1.ts')), /from "fflate"/u);
	assert.match(runtimeSource(resolve(ROOT, PNG)), /from "fflate"/u);
});

test('full PNG export labels stay optional while the menu label uses existing photo copy', () => {
	for (const separator of ['/', '\\']) {
		assert.equal(chunkGroupForModulePath(EXPORT_COPY.replaceAll('/', separator)), 'lightscaper-photo-png-export-copy');
		assert.equal(chunkGroupForModulePath(MENU_COPY.replaceAll('/', separator)), 'lightscaper-editor-copy');
		for (const path of [EXPORT_COPY + '.foreign', EXPORT_COPY.replace('-copy.', '-future-copy.')]) {
			assert.notEqual(chunkGroupForModulePath(path.replaceAll('/', separator)), 'lightscaper-photo-png-export-copy', path);
		}
	}
	const owner = chunkGroups.find(group => group.name === 'lightscaper-photo-png-export-copy'); assert.ok(owner);
	assert.equal(owner.priority, 98); assert.equal(owner.minSize, 0); assert.equal(owner.maxSize, 400_000);
	assert.equal(owner.includeDependenciesRecursively, false);
	assert.ok(!EAGER_CHUNK_GROUPS.has('lightscaper-photo-png-export-copy'));
	assert.ok(EAGER_CHUNK_GROUPS.has('lightscaper-editor-copy'));
});

for (const entry of ['src/lightscaper/ui/LightscaperBootstrap.tsx',
	'src/common/editor/ui/lightscaper/PhotoImportDialogV2.tsx', 'src/lightscaper/controller/photo-library-backup-v5.ts']) {
	test(`real photo entry ${entry} does not load PNG bytes through shared image co-owners`, () => {
		const reached = runtimeClosure(entry);
		assert.ok(reached.has('src/common/editor/imaging/pixel-frame-contract-v1.ts'), `${entry} omitted the actual frame contract`);
		assert.ok(!reached.has(PNG), `${entry} loads optional PNG encoding through an image owner`);
	});
}

function runtimeSource(path: string): string {
	let source = RUNTIME_SOURCE.get(path);
	if (source === undefined) {
		source = transformSync(readFileSync(path, 'utf8'), {
			loader: path.endsWith('.tsx') ? 'tsx' : path.endsWith('.ts') ? 'ts' : path.endsWith('.jsx') ? 'jsx' : 'js', format: 'esm',
		}).code;
		RUNTIME_SOURCE.set(path, source);
	}
	return source;
}

// Static imports pay for all members of a shared photo owner, including a
// member the product never calls. Dynamic menu imports remain outside this walk.
function runtimeClosure(entry: string): ReadonlySet<string> {
	const reached = new Set<string>(), pending = [resolve(ROOT, entry)];
	while (pending.length) {
		const path = pending.pop()!, repositoryPath = relative(ROOT, path).split(sep).join('/');
		if (reached.has(repositoryPath)) continue;
		reached.add(repositoryPath);
		const owner = chunkGroupForModulePath(path);
		if (owner && PHOTO_OWNERS.has(owner)) for (const candidate of PHOTO_COOWNERS) {
			if (chunkGroupForModulePath(candidate) === owner && !reached.has(relative(ROOT, candidate).split(sep).join('/'))) pending.push(candidate);
		}
		for (const specifier of staticRelativeDependencies(runtimeSource(path))) {
			const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); pending.push(target);
		}
	}
	return reached;
}
