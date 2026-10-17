/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { workerChunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONTRACTS = [
	'closed-domain-value.ts', 'stable-id.js', 'video-effects.js', 'video-effect-closed-creation.ts',
	'video-global-develop-v1.ts', 'video-image-geometry-v1.ts', 'video-image-geometry-ffmpeg-v1.ts',
	'video-chroma-develop-v1.ts', 'video-black-white-mix-v1.ts', 'video-hsl-mixer-v1.ts',
	'video-curves-v1.ts', 'video-curve-types-v1.ts', 'video-curve-transfer-v1.ts',
	'video-color-wheels-v1.ts', 'video-color-wheels-scalar-v1.ts',
	'video-sharpen-v1.ts', 'video-sharpen-ffmpeg-v1.ts', 'video-original-alpha-ffmpeg-v1.ts',
	'video-post-crop-vignette-v1.ts', 'video-post-crop-vignette-ffmpeg-v1.ts',
	'video-clarity-v1.ts', 'video-clarity-ffmpeg-v1.ts',
	'video-noise-reduction-v1.ts', 'video-noise-reduction-ffmpeg-v1.ts',
	'video-grain-v1.ts', 'video-grain-ffmpeg-v1.ts',
	'video-texture-v1.ts', 'video-texture-ffmpeg-v1.ts', 'video-dehaze-v1.ts', 'video-dehaze-ffmpeg-v1.ts',
	'imaging/image-geometry-v1.ts', 'imaging/image-geometry-plan-v1.ts', 'imaging/pixel-frame-contract-v1.ts',
];
function owner(path: string): string | null {
	const matching = workerChunkGroups.filter(group => group.test instanceof RegExp && group.test.test(path))
		.sort((first, second) => Number(second.priority) - Number(first.priority));
	return typeof matching[0]?.name === 'string' ? matching[0].name : null;
}

test('worker video contracts have one explicit owner across native path separators', () => {
	for (const name of CONTRACTS) for (const prefix of ['', '/checkout/', 'C:\\checkout\\']) {
		const path = `${prefix}src/common/editor/${name}`;
		assert.equal(owner(path), 'editor-video-contracts-worker', path);
		assert.equal(owner(path.replaceAll('/', '\\')), 'editor-video-contracts-worker', path);
	}
});

test('closed-family extraction and owning serializers keep exact static worker ownership', () => {
	for (const name of ['video-effect-closed-families-v1.ts', ...CONTRACTS.filter(name => name.includes('ffmpeg'))]) {
		assert.equal(owner(`src/common/editor/${name}`), 'editor-video-contracts-worker', name);
	}
});

test('worker video ownership refuses neighboring processing, UI and filename suffixes', () => {
	for (const name of [...CONTRACTS, 'video-effect-closed-families-v1.ts']) {
		assert.notEqual(owner(`src/common/editor/${name}.extra`), 'editor-video-contracts-worker', name);
		assert.notEqual(owner(`src/common/editor/foreign-${name}`), 'editor-video-contracts-worker', name);
	}
	for (const path of ['src/common/editor/imaging/pixel-frame-global-develop-v1.ts',
		'src/common/editor/imaging/pixel-frame-noise-reduction-v1.ts', 'src/common/editor/ui/video-preview-effects-shader.js',
		'src/common/editor/imaging/pixel-frame-grain-v1.ts', 'src/common/editor/imaging/pixel-frame-texture-v1.ts', 'src/common/editor/imaging/pixel-frame-dehaze-v1.ts',
		'src/common/editor/video-color-management-v27.ts', 'src/common/editor/aup4-worker.js',
		'src/common/editor/aup4-database.js', 'src/framescaper/video-effects.js']) {
		assert.notEqual(owner(path), 'editor-video-contracts-worker', path);
	}
});

test('worker contract imports are closed without recursive runtime absorption or larger ceilings', () => {
	const group = workerChunkGroups.find(candidate => candidate.name === 'editor-video-contracts-worker');
	assert.ok(group); assert.equal(group.includeDependenciesRecursively, false); assert.equal(group.minSize, 0);
	assert.equal(group.maxSize, 400_000); assert.equal(group.priority, 97);
	assert.deepEqual(workerChunkGroups.slice(0, 3).map(candidate => candidate.name),
		['vendor-sqlite-worker', 'vendor-xml-worker', 'editor-effect-contracts-worker']);
	const sources = CONTRACTS.map(name => resolve(ROOT, 'src/common/editor', name));
	for (const file of sources) assert.ok(existsSync(file), `Owning contract is absent: ${file}`);
	// The parallel closed-family extraction is not in this base; its exact path
	// must remain dependency-closed when that reviewed packet is later combined.
	const families = resolve(ROOT, 'src/common/editor/video-effect-closed-families-v1.ts');
	if (existsSync(families)) sources.push(families);
	for (const file of sources) {
		const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
		for (const statement of tree.statements) {
			if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
			if (ts.isImportDeclaration(statement)) {
				const clause = statement.importClause;
				if (clause?.isTypeOnly) continue;
				if (!clause?.name && clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
					&& clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(element => element.isTypeOnly)) continue;
			} else if (statement.isTypeOnly) continue;
			const specifier = statement.moduleSpecifier;
			if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue;
			const dependency = resolve(dirname(file), specifier.text);
			assert.ok(existsSync(dependency), `${file} must resolve ${specifier.text}`);
			assert.equal(owner(dependency), 'editor-video-contracts-worker', `${file} -> ${specifier.text}`);
		}
	}
});
