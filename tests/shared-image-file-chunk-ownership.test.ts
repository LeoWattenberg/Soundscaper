/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { MetadataReadError } from '../src/common/editor/imaging/image-metadata-binary.ts';
import { validateIptcDateTextV1, validateIptcTimeTextV1 } from '../src/common/editor/imaging/iptc-metadata-reader-v1.ts';
import { EAGER_CHUNK_GROUPS, resolveRelativeModule, sourceModules, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FILE_READERS = ['static-image-source-admission-v1', 'static-image-native-port-v1', 'image-metadata-reader-v1',
	'exif-metadata-reader-v1', 'exif-entry-traversal-v1', 'exif-color-admission-v1', 'iptc-metadata-reader-v1']
	.map(name => `src/common/editor/imaging/${name}.ts`);
const RESIZE = ['image-export-size-v1', 'pixel-frame-export-resize-v1'].map(name => `src/common/editor/imaging/${name}.ts`);
const PAID = new Set([...EAGER_CHUNK_GROUPS, 'editor-visual-effect-copy', 'lightscaper-develop-copy']);
const COOWNERS = new Map<string, string[]>(), RUNTIME = new Map<string, string>();
for (const path of sourceModules(resolve(ROOT, 'src')).filter(path => !path.endsWith('.d.ts'))) {
	const owner = chunkGroupForModulePath(path);
	if (owner && PAID.has(owner)) { const paths = COOWNERS.get(owner) ?? []; paths.push(path); COOWNERS.set(owner, paths); }
}

for (const [name, leaves] of [['editor-image-file-admission', FILE_READERS], ['editor-image-export-resize', RESIZE]] as const) {
	test(`${name} owns only its exact current leaves and preserves independent dependency placement`, () => {
		for (const leaf of leaves) for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(leaf.replaceAll('/', separator)), name, leaf);
			for (const foreign of [leaf + '.foreign', leaf.replace('-v1.', '-v2.'), leaf.replace('imaging/', 'imaging/nested/')]) {
				assert.notEqual(chunkGroupForModulePath(foreign.replaceAll('/', separator)), name, foreign);
			}
		}
		const owner = chunkGroups.find(group => group.name === name); assert.ok(owner);
		assert.equal(owner.priority, 99); assert.equal(owner.minSize, 0); assert.equal(owner.maxSize, 400_000);
		assert.equal(owner.includeDependenciesRecursively, false); assert.ok(!EAGER_CHUNK_GROUPS.has(name));
	});
}

test('catalog scalar admission stays eager without acquiring file parsers or delivery resizing', () => {
	for (const name of ['image-metadata-model-v1', 'image-metadata-binary', 'image-metadata-normalizer-v1', 'exif-capture-time-v1', 'iptc-capture-fields']) {
		assert.equal(chunkGroupForModulePath(`src/common/editor/imaging/${name}.ts`), 'editor-imaging');
	}
	const reached = closure('src/common/editor/imaging/image-metadata-normalizer-v1.ts');
	assert.ok(reached.has('src/common/editor/imaging/iptc-capture-fields.ts'));
	for (const leaf of [...FILE_READERS, ...RESIZE]) assert.ok(!reached.has(leaf), `scalar admission acquires ${leaf}`);
});

test('IPTC compatibility exports retain literal date/time validation and exact malformed-field errors', async () => {
	const scalar = await import('../src/common/editor/imaging/iptc-capture-fields.ts');
	assert.equal(scalar.validateIptcDateTextV1, validateIptcDateTextV1);
	assert.equal(scalar.validateIptcTimeTextV1, validateIptcTimeTextV1);
	for (const value of ['20240229', '20000229', '20240000', '20240200']) assert.doesNotThrow(() => scalar.validateIptcDateTextV1(value));
	for (const value of ['235959-0430', '000000+0000']) assert.doesNotThrow(() => scalar.validateIptcTimeTextV1(value));
	for (const [validate, values] of [[scalar.validateIptcDateTextV1, ['20230229', '19000229', '20260431', '20260001', '20261301']],
		[scalar.validateIptcTimeTextV1, ['240000+0000', '120000+2460', '120000Z']]] as const) {
		for (const value of values) assert.throws(() => validate(value), error => error instanceof MetadataReadError && error.issue === 'malformed-iptc');
	}
});

for (const entry of ['src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx', 'src/lightscaper/ui/LightscaperBootstrap.tsx',
	'src/common/editor/ui/lightscaper/PhotoImportDialogV2.tsx', 'src/lightscaper/controller/photo-library-backup-v5.ts']) {
	test(`actual ${entry} static imports and paid co-owners leave binary admission and output resizing unopened`, () => {
		const reached = closure(entry);
		for (const leaf of [...FILE_READERS, ...RESIZE]) assert.ok(!reached.has(leaf), `${entry} acquires ${leaf}`);
	});
}

test('actual optional import and graphic sources retain their authenticated file-reader paths without each other’s output features', () => {
	for (const entry of ['src/lightscaper/import/photo-import-preparation-v1.ts', 'src/common/editor/imaging/image-export-graphic-source-v1.ts']) {
		const reached = closure(entry);
		for (const leaf of FILE_READERS) assert.ok(reached.has(leaf), `${entry} loses ${leaf}`);
		for (const leaf of RESIZE) assert.ok(!reached.has(leaf), `${entry} acquires ${leaf}`);
		assert.ok(!reached.has('src/common/editor/imaging/pixel-frame-graphic-watermark-v1.ts'));
	}
});

test('actual raster and graphic delivery retain resizing without opening a selected-file decoder', () => {
	for (const entry of ['src/lightscaper/controller/photo-raster-export.ts', 'src/common/editor/imaging/pixel-frame-graphic-watermark-v1.ts']) {
		const reached = closure(entry);
		for (const leaf of RESIZE) assert.ok(reached.has(leaf), `${entry} loses ${leaf}`);
		for (const leaf of FILE_READERS) assert.ok(!reached.has(leaf), `${entry} acquires ${leaf}`);
	}
});

function runtimeSource(path: string): string {
	let source = RUNTIME.get(path);
	if (source === undefined) {
		source = transformSync(readFileSync(path, 'utf8'), { sourcefile: path,
			loader: path.endsWith('.tsx') ? 'tsx' : path.endsWith('.ts') ? 'ts' : path.endsWith('.jsx') ? 'jsx' : 'js', format: 'esm' }).code;
		RUNTIME.set(path, source);
	}
	return source;
}

// Type erasure and the full paid co-owner inventory model actual emitted static
// chunk edges, including passengers a direct source-only import walk would miss.
function closure(entry: string): ReadonlySet<string> {
	const reached = new Set<string>(), charged = new Set<string>(), pending = [resolve(ROOT, entry)];
	while (pending.length) {
		const path = pending.pop()!, name = relative(ROOT, path).split(sep).join('/');
		if (reached.has(name)) continue;
		reached.add(name); const owner = chunkGroupForModulePath(path);
		if (owner && PAID.has(owner) && !charged.has(owner)) { charged.add(owner); pending.push(...COOWNERS.get(owner) ?? []); }
		for (const specifier of staticRelativeDependencies(runtimeSource(path))) {
			const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); pending.push(target);
		}
	}
	return reached;
}
