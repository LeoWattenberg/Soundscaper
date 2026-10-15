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
const JPEG = 'src/common/editor/imaging/pixel-frame-jpeg-v1.ts';
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

test('Light actual Current image graph retains the complete runtime JSON manifest as executable module data', async () => {
	const manifest = 'config/lightscaper-libraw-runtime-manifest.json';
	const reached = runtimeClosure('src/common/editor/timeline-image-model-current-v1.ts');
	assert.ok(reached.has(manifest), 'The real static RAW receipt dependency must remain in the graph.');
	const path = resolve(ROOT, manifest), source = runtimeSource(path);
	assert.deepEqual(staticRelativeDependencies(source), [], 'The manifest contributes data without fabricated source dependencies.');
	const compiled = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`) as { readonly default: unknown };
	const expected: unknown = JSON.parse(readFileSync(path, 'utf8'));
	assert.deepEqual(compiled.default, expected, 'JSON transformation must retain the actual pinned decoder metadata.');
});

for (const entry of ['src/lightscaper/ui/LightscaperBootstrap.tsx',
	'src/common/editor/ui/lightscaper/PhotoImportDialogV2.tsx', 'src/lightscaper/controller/photo-library-backup-v5.ts']) {
	test(`real photo entry ${entry} does not load PNG bytes through shared image co-owners`, () => {
		const reached = runtimeClosure(entry);
		assert.ok(reached.has('src/common/editor/imaging/pixel-frame-contract-v1.ts'), `${entry} omitted the actual frame contract`);
		assert.ok(!reached.has(JPEG), `${entry} loads optional JPEG encoding through an image owner`);
		assert.ok(!reached.has(PNG), `${entry} loads optional PNG encoding through an image owner`);
	});
}

test('JPEG codec and full copy remain exact optional owners while only its menu label is eager', () => {
	for (const separator of ['/', '\\']) {
		for (const [path, name] of [[JPEG, 'editor-jpeg-bytes'], ['src/common/i18n/lightscaper-photo-jpeg-export-copy.ts', 'lightscaper-photo-jpeg-export-copy']] as const) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), name);
			assert.notEqual(chunkGroupForModulePath((path + '.foreign').replaceAll('/', separator)), name);
			const owner = chunkGroups.find(group => group.name === name); assert.ok(owner);
			assert.equal(owner.includeDependenciesRecursively, false); assert.equal(owner.maxSize, 400_000); assert.ok(!EAGER_CHUNK_GROUPS.has(name));
		}
		assert.equal(chunkGroupForModulePath('src/common/i18n/lightscaper-photo-jpeg-export-menu-copy.ts'.replaceAll('/', separator)), 'lightscaper-editor-copy');
		assert.notEqual(chunkGroupForModulePath(JPEG.replace('-v1.', '-v2.').replaceAll('/', separator)), 'editor-jpeg-bytes');
	}
	for (const entry of ['LightscaperAppV2.tsx', 'LightscaperAppCurrentV1.tsx']) {
		const path = `src/common/editor/ui/lightscaper/${entry}`, app = runtimeSource(resolve(ROOT, path));
		assert.ok(staticRelativeDependencies(app).includes('./LightscaperAppKernelV1.tsx'), entry);
		assert.ok(!staticRelativeDependencies(app).includes('./PhotoRasterExportSurface.tsx'), entry);
		assert.ok(!staticRelativeDependencies(app).includes('./PhotoJpegExportDialog.tsx'), entry);
		const reached = runtimeClosure(path);
		assert.ok(reached.has('src/common/editor/ui/lightscaper/LightscaperAppKernelV1.tsx'), entry);
		assert.ok(reached.has('src/common/editor/ui/lightscaper/LightscaperRasterExportSurfaceV1.tsx'), entry);
		for (const optional of [JPEG, PNG, EXPORT_COPY, 'src/common/i18n/lightscaper-photo-jpeg-export-copy.ts',
			'src/common/i18n/lightscaper-photo-batch-export-copy.ts', 'src/common/editor/ui/lightscaper/PhotoRasterExportSurface.tsx',
			'src/lightscaper/controller/photo-raster-export-current-v1.ts', 'src/lightscaper/controller/photo-raster-export-batch-queue-current-v1.ts']) {
			assert.ok(!reached.has(optional), `${entry} loads optional ${optional}`);
		}
	}
	const kernel = runtimeSource(resolve(ROOT, 'src/common/editor/ui/lightscaper/LightscaperAppKernelV1.tsx'));
	assert.ok(staticRelativeDependencies(kernel).includes('./LightscaperRasterExportSurfaceV1.tsx'));
	const composition = runtimeSource(resolve(ROOT, 'src/common/editor/ui/lightscaper/LightscaperRasterExportSurfaceV1.tsx'));
	assert.match(composition, /lazy\(\(\) => import\("\.\/PhotoRasterExportSurface\.tsx"\)\)/u);
	assert.ok(!staticRelativeDependencies(composition).includes('./PhotoRasterExportSurface.tsx'));
	assert.match(composition, /module\.PhotoRasterExportSurfaceCurrentV1/u);
	const surface = runtimeSource(resolve(ROOT, 'src/common/editor/ui/lightscaper/PhotoRasterExportSurface.tsx'));
	assert.match(surface, /lazy\(\(\) => import\("\.\/PhotoJpegExportDialog\.tsx"\)\)/u);
	assert.ok(!staticRelativeDependencies(surface).includes('./PhotoJpegExportDialog.tsx'));
	assert.ok(runtimeClosure('src/common/editor/ui/lightscaper/PhotoJpegExportDialog.tsx').has(JPEG));
	assert.match(surface, /module\.PhotoJpegExportDialogCurrentV1/u);
	assert.ok(!staticRelativeDependencies(surface).includes('./PhotoRasterBatchExportDialog.tsx'));
});

function runtimeSource(path: string): string {
	let source = RUNTIME_SOURCE.get(path);
	if (source === undefined) {
		source = transformSync(readFileSync(path, 'utf8'), {
			loader: path.endsWith('.tsx') ? 'tsx' : path.endsWith('.ts') ? 'ts' : path.endsWith('.jsx') ? 'jsx' : path.endsWith('.json') ? 'json' : 'js', format: 'esm',
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
