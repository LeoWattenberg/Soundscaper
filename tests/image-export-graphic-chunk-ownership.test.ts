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
const GRAPHIC = ['src/common/editor/imaging/image-export-graphic-source-v1.ts', 'src/common/editor/imaging/pixel-frame-graphic-watermark-v1.ts'];
const COPY = 'src/common/i18n/image-export-graphic-copy.ts', FIELDS = 'src/common/editor/ui/GraphicWatermarkFields.tsx';
const PAID = new Set([...EAGER_CHUNK_GROUPS, 'editor-visual-effect-copy', 'lightscaper-develop-copy']);
const MODULES = sourceModules(resolve(ROOT, 'src')).filter(path => !path.endsWith('.d.ts'));
const COOWNERS = new Map<string, string[]>();
for (const path of MODULES) { const owner = chunkGroupForModulePath(path); if (owner && PAID.has(owner)) {
	const paths = COOWNERS.get(owner) ?? []; paths.push(path); COOWNERS.set(owner, paths);
} }
const RUNTIME_SOURCE = new Map<string, string>();

test('video graphic and encode request helpers belong to their existing optional export service', () => {
	for (const name of ['video-export-graphic', 'video-export-product-encode-request']) {
		const path = `src/common/editor/controller/export/internal/video/${name}.ts`;
		for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), 'editor-optional-export');
			assert.notEqual(chunkGroupForModulePath((path + '.foreign').replaceAll('/', separator)), 'editor-optional-export');
		}
	}
});

test('graphic decode and transform have exact optional ownership without co-owning existing image readers or linear math', () => {
	for (const path of GRAPHIC) for (const separator of ['/', '\\']) {
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), 'editor-export-graphic');
		for (const impostor of [path + '.foreign', path.replace('-v1.', '-v2.'), path.replace('imaging/', 'imaging/nested/')]) {
			assert.notEqual(chunkGroupForModulePath(impostor.replaceAll('/', separator)), 'editor-export-graphic');
		}
	}
	for (const leaf of ['linear-rgba-composite-v1.ts']) {
		assert.equal(chunkGroupForModulePath(`src/common/editor/imaging/${leaf}`), 'editor-imaging');
	}
	for (const leaf of ['static-image-native-port-v1.ts', 'static-image-source-admission-v1.ts']) {
		assert.equal(chunkGroupForModulePath(`src/common/editor/imaging/${leaf}`), 'editor-image-file-admission');
	}
	const owner = chunkGroups.find(group => group.name === 'editor-export-graphic'); assert.ok(owner);
	assert.ok(typeof owner.name === 'string');
	assert.equal(owner.priority, 99); assert.equal(owner.minSize, 0); assert.equal(owner.maxSize, 400_000); assert.equal(owner.includeDependenciesRecursively, false);
	assert.ok(!EAGER_CHUNK_GROUPS.has(owner.name));
});

test('shared full graphic fields and copy remain optional while the gesture scalar has a neutral owner', () => {
	for (const path of [COPY, FIELDS]) for (const separator of ['/', '\\']) {
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), 'editor-export-graphic-dialog');
		assert.notEqual(chunkGroupForModulePath((path + '.foreign').replaceAll('/', separator)), 'editor-export-graphic-dialog');
	}
	const owner = chunkGroups.find(group => group.name === 'editor-export-graphic-dialog'); assert.ok(owner);
	assert.ok(typeof owner.name === 'string');
	assert.equal(owner.priority, 98); assert.equal(owner.maxSize, 400_000); assert.equal(owner.includeDependenciesRecursively, false);
	assert.ok(!EAGER_CHUNK_GROUPS.has(owner.name));
	assert.equal(chunkGroupForModulePath('src/common/editor/image-export-graphic-request.ts'), 'editor-neutral-foundations');
});

for (const entry of ['src/lightscaper/ui/LightscaperBootstrap.tsx', 'src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx',
	'src/common/editor/ui/lightscaper/PhotoImportDialogV2.tsx', 'src/lightscaper/controller/photo-library-backup-v5.ts']) {
	test(`actual ${entry} static imports and eager co-owners cannot acquire graphic decoding, transform or dialog`, () => {
		const reached = runtimeClosure(entry);
		for (const leaf of [...GRAPHIC, COPY, FIELDS]) assert.ok(!reached.has(leaf), `${entry} acquires ${leaf}`);
	});
}

test('both real export surfaces own shared fields while the pixel loader and transform remain dynamic delivery seams', () => {
	for (const entry of ['src/common/editor/ui/lightscaper/PhotoRasterExportDialog.tsx', 'src/common/editor/ui/inspector/ExportDialog.jsx']) {
		const reached = runtimeClosure(entry); assert.ok(reached.has(FIELDS)); assert.ok(reached.has(COPY));
		for (const leaf of GRAPHIC) assert.ok(!reached.has(leaf), `${entry} reads graphic before the Save option`);
	}
	for (const entry of ['src/lightscaper/controller/photo-raster-export.ts', 'src/common/editor/controller/export/internal/video/video-export-graphic.ts']) {
		const source = runtimeSource(resolve(ROOT, entry));
		for (const leaf of GRAPHIC) assert.ok(source.includes(`import("${entry.startsWith('src/lightscaper') ? '../../common/editor/' : '../../../../'}imaging/${leaf.split('/').at(-1)}")`), `${entry} lacks the actual dynamic ${leaf}`);
	}
});
function runtimeSource(path: string): string {
	let source = RUNTIME_SOURCE.get(path);
	if (source === undefined) {
		source = transformSync(readFileSync(path, 'utf8'), {
			sourcefile: path, loader: path.endsWith('.tsx') ? 'tsx' : path.endsWith('.ts') ? 'ts' : path.endsWith('.jsx') ? 'jsx' : 'js', format: 'esm',
		}).code;
		RUNTIME_SOURCE.set(path, source);
	}
	return source;
}

// Erase type imports and charge all actual members of every reached eager
// semantic group. A source-only import walk would miss optional co-owners.
function runtimeClosure(entry: string): ReadonlySet<string> {
	const reached = new Set<string>(), charged = new Set<string>(), pending = [resolve(ROOT, entry)];
	while (pending.length) {
		const path = pending.pop()!, repositoryPath = relative(ROOT, path).split(sep).join('/');
		if (reached.has(repositoryPath)) continue;
		reached.add(repositoryPath);
		const owner = chunkGroupForModulePath(path);
		if (owner && PAID.has(owner) && !charged.has(owner)) {
			charged.add(owner); pending.push(...COOWNERS.get(owner) ?? []);
		}
		for (const specifier of staticRelativeDependencies(runtimeSource(path))) {
			const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); pending.push(target);
		}
	}
	return reached;
}
