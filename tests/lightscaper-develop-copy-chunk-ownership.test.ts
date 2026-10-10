/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopSettingsCopy } from '../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { VIDEO_EFFECT_COPY_BY_LOCALE } from '../src/common/i18n/video-effect-copy.js';
import { dynamicRelativeImports, resolveRelativeModule, sourceModules, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HOOK = 'src/common/editor/ui/lightscaper/use-lightscaper-editor-copy.ts';
const DEVELOP = ['src/common/i18n/lightscaper-develop-copy.ts', 'src/common/i18n/lightscaper-develop-settings-copy.ts'];
const VISUAL = 'src/common/i18n/video-effect-copy.js';
const COPY_MODULES = [...sourceModules(resolve(ROOT, 'src/common/i18n')), resolve(ROOT, HOOK)];

test('optional develop labels and shared visual labels have exact independent nonrecursive owners', () => {
	for (const [paths, owner] of [[DEVELOP, 'lightscaper-develop-copy'], [[VISUAL], 'editor-visual-effect-copy']] as const) {
		for (const path of paths) for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), owner, path);
			for (const impostor of [path + '.foreign', path.replace('-copy.', '-future-copy.')]) {
				assert.notEqual(chunkGroupForModulePath(impostor.replaceAll('/', separator)), owner, impostor);
			}
		}
		const group = chunkGroups.find(candidate => candidate.name === owner); assert.ok(group);
		assert.equal(group.priority, 98); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000);
		assert.equal(group.includeDependenciesRecursively, false);
	}
	for (const path of [HOOK, 'src/common/i18n/lightscaper-editor-copy.ts', 'src/common/i18n/lightscaper-develop-menu-copy.ts']) {
		assert.equal(chunkGroupForModulePath(path), 'lightscaper-editor-copy', path);
	}
});

test('ordinary photo copy cannot acquire develop or timeline catalogs through co-owned labels', () => {
	const reached = copyClosure(HOOK);
	for (const path of [...DEVELOP, VISUAL, 'src/common/i18n/canonical-extras.js', 'src/common/i18n/catalogs.js']) {
		assert.ok(!reached.has(path), `Ordinary photo copy loads ${path}`);
	}
});

test('the real import-preset copy route retains visual labels without canonical audio catalogs', () => {
	const dialog = 'src/common/editor/ui/lightscaper/PhotoImportDialogV2.tsx';
	assert.ok(staticRelativeDependencies(runtimeSource(resolve(ROOT, dialog))).includes('../../../i18n/lightscaper-develop-settings-copy.ts'));
	const reached = copyClosure(DEVELOP[1]!);
	assert.ok(reached.has(DEVELOP[0]!)); assert.ok(reached.has(VISUAL));
	for (const path of reached) assert.doesNotMatch(path, /\/i18n\/(?:canonical-extras[^/]*|catalogs|runtime|editor-copy-inventory)\./u);
	assert.deepEqual(staticRelativeDependencies(runtimeSource(resolve(ROOT, VISUAL))), []);
});

test('both photo applications retain actual lazy import and develop entries with unchanged shared label identity', () => {
	for (const version of ['', 'V2']) {
		const source = runtimeSource(resolve(ROOT, `src/common/editor/ui/lightscaper/LightscaperApp${version}.tsx`));
		for (const name of [`./PhotoImportDialog${version}.tsx`, `./PhotoDevelopWorkspace${version}.tsx`]) {
			assert.ok(dynamicRelativeImports(source).includes(name), name);
			assert.ok(!staticRelativeDependencies(source).includes(name), name);
		}
	}
	for (const locale of ['en', 'de'] as const) {
		assert.equal(photoDevelopCopy(locale).shared, VIDEO_EFFECT_COPY_BY_LOCALE[locale]);
		assert.equal(photoDevelopSettingsCopy(locale).shared, VIDEO_EFFECT_COPY_BY_LOCALE[locale]);
	}
});

function runtimeSource(path: string): string {
	return transformSync(readFileSync(path, 'utf8'), { loader: path.endsWith('.tsx') ? 'tsx' : path.endsWith('.ts') ? 'ts' : 'js', format: 'esm' }).code;
}

// Follow real runtime imports and also pay for every copy module sharing an owner.
// A source-only import walk misses the co-owned optional labels that caused this failure.
function copyClosure(entry: string): ReadonlySet<string> {
	const reached = new Set<string>(), pending = [resolve(ROOT, entry)];
	while (pending.length) {
		const path = pending.pop()!, repositoryPath = relative(ROOT, path).split(sep).join('/');
		if (reached.has(repositoryPath)) continue;
		reached.add(repositoryPath);
		const owner = chunkGroupForModulePath(path);
		if (owner) for (const candidate of COPY_MODULES) {
			if (chunkGroupForModulePath(candidate) === owner && !reached.has(relative(ROOT, candidate).split(sep).join('/'))) pending.push(candidate);
		}
		for (const specifier of staticRelativeDependencies(runtimeSource(path))) {
			const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); pending.push(target);
		}
	}
	return reached;
}
