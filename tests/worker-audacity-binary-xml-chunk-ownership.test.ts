/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

import { workerChunkGroups } from '../scripts/lib/build-chunk-workers.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CODEC = 'src/common/editor/audacity-binary-xml.js';
const OWNER = 'audacity-binary-xml-worker';

function matchingOwners(path: string): readonly string[] {
	return workerChunkGroups.filter(group => group.test instanceof RegExp && group.test.test(path))
		.map(group => String(group.name));
}

function sourceTree(path: string): ts.SourceFile {
	return ts.createSourceFile(path, readFileSync(resolve(ROOT, path), 'utf8'), ts.ScriptTarget.Latest, true);
}

test('the typed Audacity XML codec has its own exact worker owner on native paths', () => {
	for (const prefix of ['', '/checkout/', 'C:\\checkout\\']) {
		const path = prefix + CODEC;
		assert.deepEqual(matchingOwners(path), [OWNER], path);
		assert.deepEqual(matchingOwners(path.replaceAll('/', '\\')), [OWNER], path);
	}
});

test('the XML codec owner refuses database, protocol, text parser and filename neighbors', () => {
	for (const path of [
		CODEC + '.extra', CODEC.replace('audacity-binary-xml', 'foreign-audacity-binary-xml'),
		'src/framescaper/audacity-binary-xml.js', 'src/common/editor/audacity-binary-xml.ts',
		'src/common/editor/aup4-worker.js', 'src/common/editor/aup4-database.js',
		'src/common/editor/aup3-database.ts', 'src/common/editor/aup4-worker-snapshot.js',
		'src/common/editor/aup4-conversion.js', 'node_modules/saxes/saxes.js',
	]) {
		assert.ok(!matchingOwners(path).includes(OWNER), path);
		assert.ok(!matchingOwners(path.replaceAll('/', '\\')).includes(OWNER), path);
	}
});

test('the codec has no runtime imports that could initialize an importing worker entry', () => {
	const dependencies: string[] = [];
	function visit(node: ts.Node): void {
		if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
			dependencies.push(node.getText());
		}
		if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
			|| (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
			dependencies.push(node.getText());
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceTree(CODEC));
	assert.deepEqual(dependencies, [], 'The separate codec must remain a dependency-closed leaf.');
});

test('both database generations and import/save consumers use the actual typed XML codec', () => {
	for (const name of ['aup3-database.ts', 'aup4-database.js', 'aup4-conversion.js', 'aup4-worker-snapshot.js']) {
		const path = 'src/common/editor/' + name;
		const imports = sourceTree(path).statements.filter(ts.isImportDeclaration)
			.filter(statement => ts.isStringLiteral(statement.moduleSpecifier)
				&& statement.moduleSpecifier.text === './audacity-binary-xml.js');
		assert.equal(imports.length, 1, path);
	}
	const entryImports = sourceTree('src/common/editor/aup4-worker.js').statements.filter(ts.isImportDeclaration)
		.map(statement => ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '');
	for (const name of ['aup4-database.js', 'aup4-conversion.js', 'aup4-worker-snapshot.js']) {
		assert.ok(entryImports.includes('./' + name), `${name} must remain an actual AUP4 worker consumer`);
	}
});

test('the nonrecursive codec split preserves earlier semantic owners and bounded chunk sizes', () => {
	const group = workerChunkGroups.find(candidate => candidate.name === OWNER);
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(group.minSize, 0);
	assert.equal(group.maxSize, 400_000);
	assert.equal(group.priority, 96);
	assert.deepEqual(workerChunkGroups.slice(0, 4).map(candidate => candidate.name), [
		'vendor-sqlite-worker', 'vendor-xml-worker', 'editor-effect-contracts-worker', 'editor-video-contracts-worker',
	]);
	for (const earlier of workerChunkGroups.slice(0, 4)) assert.equal(earlier.maxSize, 400_000);
});
