/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { EDITOR_COPY_AUDIT_INVENTORY } from '../scripts/lib/editor-copy-audit-inventory.mjs';
import { photoFramescaperCollectionHandoffCopy, photoFramescaperHandoffCopy, photoFramescaperReceiveCopy } from '../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperCollectionHandoffMenuLabel, photoFramescaperHandoffMenuLabel, photoFramescaperReceiveMenuLabel } from '../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { dynamicRelativeImports, resolveRelativeModule, sourceModules, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APP = 'src/common/editor/ui/lightscaper/LightscaperAppV2.tsx';
const MENU = 'src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
const COPY = 'src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
const source = (path: string) => transformSync(readFileSync(path, 'utf8'), { loader: path.endsWith('.tsx') ? 'tsx' : 'ts', format: 'esm' }).code;
test('tiny menu labels share honest eager copy; full guidance has an exact nonrecursive lazy owner', () => {
	for (const separator of ['/', '\\']) {
		assert.equal(chunkGroupForModulePath(MENU.replaceAll('/', separator)), 'lightscaper-editor-copy');
		assert.equal(chunkGroupForModulePath(COPY.replaceAll('/', separator)), 'lightscaper-photo-framescaper-handoff-copy');
		assert.notEqual(chunkGroupForModulePath(`${COPY}.foreign`.replaceAll('/', separator)), 'lightscaper-photo-framescaper-handoff-copy');
	}
	const group = chunkGroups.find(value => value.name === 'lightscaper-photo-framescaper-handoff-copy'); assert.ok(group);
	assert.equal(group.priority, 98); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000); assert.equal(group.includeDependenciesRecursively, false);
	const audit: Readonly<Record<string, string>> = EDITOR_COPY_AUDIT_INVENTORY;
	for (const [key, text] of Object.entries(photoFramescaperHandoffCopy('en'))) assert.equal(audit[`ui.photoFramescaperHandoff.${key}`], text);
	assert.equal(EDITOR_COPY_AUDIT_INVENTORY['ui.photoFramescaperHandoffMenu.download'], photoFramescaperHandoffMenuLabel('en'));
	for (const [key, text] of Object.entries(photoFramescaperReceiveCopy('en'))) assert.equal(audit[`ui.photoFramescaperReceive.${key}`], text);
	assert.equal(EDITOR_COPY_AUDIT_INVENTORY['ui.photoFramescaperHandoffMenu.receive'], photoFramescaperReceiveMenuLabel('en'));
	for (const [key, text] of Object.entries(photoFramescaperCollectionHandoffCopy('en'))) assert.equal(audit[`ui.photoFramescaperCollectionHandoff.${key}`], text);
	assert.equal(EDITOR_COPY_AUDIT_INVENTORY['ui.photoFramescaperHandoffMenu.collection'], photoFramescaperCollectionHandoffMenuLabel('en'));
});
test('actual App startup does not import editable-copy archive, frame factories, native decoder or full guidance', () => {
	const reached = new Set<string>(), pending = [resolve(ROOT, APP)], copies = sourceModules(resolve(ROOT, 'src/common/i18n'));
	while (pending.length) {
		const path = pending.pop()!, name = relative(ROOT, path).replaceAll('\\', '/'); if (reached.has(name)) continue; reached.add(name);
		const group = chunkGroupForModulePath(path);
		if (group && path.includes('/i18n/')) for (const copy of copies) if (chunkGroupForModulePath(copy) === group) pending.push(copy);
		for (const module of staticRelativeDependencies(source(path))) { const child = resolveRelativeModule(path, module); assert.ok(child); pending.push(child); }
	}
	assert.equal(reached.has(MENU), true);
	for (const name of [COPY, 'src/common/editor/ui/lightscaper/PhotoFramescaperHandoffDialog.tsx', 'src/common/editor/ui/lightscaper/PhotoFramescaperReceiveDialog.tsx', 'src/common/editor/ui/lightscaper/PhotoFramescaperCollectionHandoffDialog.tsx',
		'src/lightscaper/controller/photo-framescaper-handoff-inspect-v1.ts', 'src/lightscaper/controller/photo-library-image-receive-session.ts', 'src/lightscaper/controller/photo-framescaper-handoff-read-v1.ts', 'src/lightscaper/controller/photo-framescaper-handoff-download.ts',
		'src/lightscaper/controller/photo-framescaper-handoff-archive-v1.ts', 'src/lightscaper/controller/photo-framescaper-collection-handoff-archive-v1.ts', 'src/lightscaper/controller/photo-framescaper-collection-handoff-project-v1.ts',
		'src/framescaper/editor-project-factory.ts', 'src/common/editor/timeline-image-native-decode-v1.ts']) assert.equal(reached.has(name), false, name);
	assert.ok(dynamicRelativeImports(source(resolve(ROOT, 'src/common/editor/ui/lightscaper/use-photo-framescaper-handoff-entry.tsx'))).includes('./PhotoFramescaperHandoffDialog.tsx'));
	assert.ok(dynamicRelativeImports(source(resolve(ROOT, 'src/common/editor/ui/lightscaper/use-photo-framescaper-handoff-entry.tsx'))).includes('./PhotoFramescaperReceiveDialog.tsx'));
	assert.ok(dynamicRelativeImports(source(resolve(ROOT, 'src/common/editor/ui/lightscaper/use-photo-framescaper-handoff-entry.tsx'))).includes('./PhotoFramescaperCollectionHandoffDialog.tsx'));
});
