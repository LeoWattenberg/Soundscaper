/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { dynamicRelativeImports, resolveRelativeModule, sourceModules, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APPS = ['src/common/editor/ui/lightscaper/LightscaperAppV2.tsx', 'src/common/editor/ui/lightscaper/LightscaperAppCurrentV1.tsx'];
const APP_KERNEL = 'src/common/editor/ui/lightscaper/LightscaperAppKernelV1.tsx';
const SESSIONS = ['src/lightscaper/controller/photo-library-session-v2.ts', 'src/lightscaper/controller/photo-library-session-current-v1.ts'];
const SESSION_KERNEL = 'src/lightscaper/controller/photo-library-session-kernel-v2.ts';
const COPY = ['lightscaper-photo-batch-export-menu-copy', 'lightscaper-photo-batch-export-copy', 'lightscaper-photo-export-presets-copy'];
const moduleSource = (path: string) => transformSync(readFileSync(path, 'utf8'), { loader: path.endsWith('.tsx') ? 'tsx' : path.endsWith('.ts') ? 'ts' : 'js', format: 'esm' }).code;
test('batch menu and optional full labels have exact isolated nonrecursive owners', () => {
	for (const owner of COPY) {
		const path = `src/common/i18n/${owner}.ts`;
		for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), owner);
			assert.notEqual(chunkGroupForModulePath(`${path}.foreign`.replaceAll('/', separator)), owner);
		}
		const group = chunkGroups.find(candidate => candidate.name === owner)!; assert.equal(group.priority, 98); assert.equal(group.maxSize, 400_000);
		assert.equal(group.minSize, 0); assert.equal(group.includeDependenciesRecursively, false);
	}
});
test('both actual photo shells stay cold for queue, optional batch labels and both encoders across copy co-owners', () => {
	const copies = sourceModules(resolve(ROOT, 'src/common/i18n'));
	for (const app of APPS) {
		assert.ok(staticRelativeDependencies(moduleSource(resolve(ROOT, app))).includes('./LightscaperAppKernelV1.tsx'), app);
		const reached = new Set<string>(), pending = [resolve(ROOT, app)];
		while (pending.length) {
			const path = pending.pop()!, name = relative(ROOT, path).replaceAll('\\', '/'); if (reached.has(name)) continue; reached.add(name);
			const group = chunkGroupForModulePath(path);
			if (group && path.includes('/i18n/')) for (const copy of copies) if (chunkGroupForModulePath(copy) === group) pending.push(copy);
			for (const importPath of staticRelativeDependencies(moduleSource(path))) { const dependency = resolveRelativeModule(path, importPath); assert.ok(dependency); pending.push(dependency); }
		}
		for (const path of ['src/lightscaper/controller/photo-raster-export-batch-queue.ts', 'src/lightscaper/controller/photo-raster-export-persisted-batch.ts',
			'src/lightscaper/controller/photo-library-export-journal-session.ts', 'src/lightscaper/controller/photo-library-export-presets-session.ts',
			'src/lightscaper/storage/photo-raster-export-presets-v1.ts', 'src/lightscaper/controller/photo-raster-export-preset-v1.ts',
			'src/common/editor/ui/lightscaper/PhotoRasterExportPresets.tsx', 'src/common/i18n/lightscaper-photo-export-presets-copy.ts', 'src/common/i18n/lightscaper-photo-batch-export-copy.ts',
			'src/common/editor/imaging/pixel-frame-png-v1.ts', 'src/common/editor/imaging/pixel-frame-jpeg-v1.ts']) assert.equal(reached.has(path), false, path);
		assert.equal(reached.has(APP_KERNEL), true, app);
		assert.equal(reached.has('src/common/i18n/lightscaper-photo-batch-export-menu-copy.ts'), true);
	}
	const kernel = moduleSource(resolve(ROOT, APP_KERNEL));
	assert.ok(dynamicRelativeImports(kernel).includes('./PhotoRasterExportSurface.tsx'));
	assert.equal(staticRelativeDependencies(kernel).includes('./PhotoRasterExportSurface.tsx'), false);
	assert.ok(dynamicRelativeImports(moduleSource(resolve(ROOT, 'src/common/editor/ui/lightscaper/PhotoRasterExportSurface.tsx'))).includes('./PhotoRasterBatchExportDialog.tsx'));
});
test('both actual Sessions reach their shared lazy journal and preset facades', () => {
	for (const session of SESSIONS) assert.ok(staticRelativeDependencies(moduleSource(resolve(ROOT, session))).includes('./photo-library-session-kernel-v2.ts'), session);
	const kernel = moduleSource(resolve(ROOT, SESSION_KERNEL));
	for (const facade of ['./photo-library-export-journal-session.ts', './photo-library-export-presets-session.ts']) {
		assert.ok(dynamicRelativeImports(kernel).includes(facade), facade);
		assert.equal(staticRelativeDependencies(kernel).includes(facade), false, facade);
	}
});
