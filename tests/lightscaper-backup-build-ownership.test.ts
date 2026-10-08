/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { EAGER_CHUNK_GROUPS, resolveRelativeModule, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const editor = root + 'src/common/editor/';

test('the synchronous photo save owner has only scalar contracts in the existing photo controller chunk', () => {
	const pending = [editor + 'controller/shared/photo-library-backup-save-v1.ts'], seen = new Set<string>();
	while (pending.length) {
		const path = pending.pop()!; if (seen.has(path)) continue; seen.add(path);
		assert.ok(path.startsWith(root + 'src/common/'), path);
		if (path.startsWith(editor)) assert.ok(['editor-photo-library-scalars', 'editor-closed-domain-values', 'editor-neutral-foundations']
			.some(owner => owner === chunkGroupForModulePath(path)), path);
		for (const dependency of runtimeDependencies(path)) { const target = resolveRelativeModule(path, dependency); assert.ok(target); pending.push(target); }
	}
	assert.ok(!seen.has(editor + 'browser-file-save-service.ts'));
	assert.ok(!seen.has(editor + 'file-save-stream.ts'));
});

test('the browser save facade owns its exact prepared-file and delayed-download closure without read services', () => {
	const owner = 'editor-file-saving';
	for (const path of ['browser-file-save-service.ts', 'file-save-stream.ts', 'object-url-revoke.ts']) {
		assert.equal(chunkGroupForModulePath(editor + path), owner);
		assert.equal(chunkGroupForModulePath((editor + path).replaceAll('/', '\\')), owner);
		assert.notEqual(chunkGroupForModulePath(editor + path + '.foreign'), owner);
		for (const dependency of runtimeDependencies(editor + path)) {
			const target = resolveRelativeModule(editor + path, dependency); assert.ok(target);
			assert.equal(chunkGroupForModulePath(target), owner);
		}
	}
	assertGroup(owner);
	assert.notEqual(chunkGroupForModulePath(editor + 'file-service.js'), owner);
	assert.notEqual(chunkGroupForModulePath(editor + 'desktop-helper-video-timing-probe.ts'), owner);
});

test('actual photo export composition uses neutral archive bytes instead of timeline, PCM or copy implementation', () => {
	const pending = [root + 'src/lightscaper/photo-library-backup-save-runtime.ts', root + 'src/lightscaper/archive/catalog-archive-export.ts'], seen = new Set<string>();
	while (pending.length) {
		const path = pending.pop()!; if (seen.has(path)) continue; seen.add(path);
		if (path.startsWith(editor) && !path.slice(editor.length).includes('/')) {
			assert.ok(['editor-file-saving', 'editor-scape-archive-bytes', 'editor-neutral-foundations',
				'editor-imaging', 'editor-closed-domain-values', 'project-interchange-foundations']
				.some(owner => owner === chunkGroupForModulePath(path)), path);
		}
		assert.ok(!/\/(?:wavpack|ui|soundscaper|framescaper)\//u.test(path), path);
		for (const dependency of runtimeDependencies(path)) { const target = resolveRelativeModule(path, dependency); assert.ok(target); pending.push(target); }
	}
	for (const name of ['scape-archive-envelope.ts', 'scape-archive-media.ts', 'file-service.js']) assert.ok(!seen.has(editor + name), name);
	// Catalog archives genuinely use the same bounded Scape document serializer;
	// its portable representation has no timeline or PCM implementation imports.
	assert.ok(seen.has(editor + 'scape-project-document.ts'));
	assertGroup('editor-scape-archive-bytes');
});

test('dialog save preparation loads capacity without loading ZIP, catalog documents or the exporter', () => {
	const pending = [root + 'src/lightscaper/photo-library-backup-save-runtime.ts'], seen = new Set<string>();
	while (pending.length) {
		const path = pending.pop()!; if (seen.has(path)) continue; seen.add(path);
		assert.ok(!path.includes('/src/lightscaper/catalog/'), path);
		assert.ok(!path.endsWith('/catalog-archive-export.ts'), path);
		assert.ok(!readFileSync(path, 'utf8').includes('@zip.js/zip.js'), path);
		for (const dependency of runtimeDependencies(path)) { const target = resolveRelativeModule(path, dependency); assert.ok(target); pending.push(target); }
	}
	assert.ok(seen.has(editor + 'scape-export-estimate.ts'));
});

function runtimeDependencies(path: string): readonly string[] {
	return staticRelativeDependencies(transformSync(readFileSync(path, 'utf8'), { loader: path.endsWith('.ts') ? 'ts' : 'js', format: 'esm' }).code);
}
function assertGroup(owner: string): void {
	const group = chunkGroups.find(candidate => candidate.name === owner); assert.ok(group);
	assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000); assert.equal(group.includeDependenciesRecursively, false);
	// Existing Soundscaper/Framescaper boot domains already consume these owners;
	// Lightscaper reaches file saving and archive bodies only after menu opt-in.
	assert.ok(EAGER_CHUNK_GROUPS.has(owner));
}
