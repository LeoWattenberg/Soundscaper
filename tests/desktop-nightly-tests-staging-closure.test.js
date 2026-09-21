/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
	createSourceFile,
	isCallExpression,
	isExportDeclaration,
	isExternalModuleReference,
	isIdentifier,
	isImportDeclaration,
	isImportEqualsDeclaration,
	isStringLiteralLike,
	ScriptTarget,
	SyntaxKind,
	forEachChild,
} from 'typescript';

import { NIGHTLY_TEST_PAYLOAD_INPUTS } from '../scripts/lib/desktop-nightly-tests-staging.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const MODULE_FILE = /\.[cm]?[jt]sx?$/u;
const TEST_MODULE_DIRECTORIES = Object.freeze([
	'tests/browser',
	'tests/electron',
]);
const EXTENSION_CANDIDATES = Object.freeze([
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
	'.json',
]);
const SOURCE_EXTENSION_SUBSTITUTIONS = Object.freeze({
	'.js': Object.freeze(['.ts', '.tsx']),
	'.jsx': Object.freeze(['.tsx']),
	'.mjs': Object.freeze(['.mts']),
	'.cjs': Object.freeze(['.cts']),
});

test('nightly payload production modules have a closed local-import graph', () => {
	const result = inspectLocalImportClosure(NIGHTLY_TEST_PAYLOAD_INPUTS);

	assert.ok(result.visited.has('scripts/lib/browser-coverage-profile.mjs'));
	assert.ok(result.visited.has('scripts/lib/browser-dynamic-coverage-sources.mjs'));
	assert.ok(result.visited.has('src/common/editor/macro-script/dynamic-source-contract.js'));
	assert.ok(result.visited.has('src/common/editor/native-plugin-realtime-worklet.js'));
	assert.ok(result.queryImports.some(({ specifier }) => specifier.endsWith('?worker&url')));
});

test('nightly payload production-module audit rejects an unstaged local dependency', () => {
	const withoutCoveragePrefixes = NIGHTLY_TEST_PAYLOAD_INPUTS.filter(({ source }) => (
		source !== 'scripts/lib/e2e-coverage-prefixes.mjs'
	));

	assert.throws(
		() => inspectLocalImportClosure(withoutCoveragePrefixes),
		/Unstaged local import .*e2e-coverage-source-maps\.mjs.*e2e-coverage-prefixes\.mjs/u,
	);
});

function inspectLocalImportClosure(inputs) {
	const pending = entryModules(inputs);
	const visited = new Set();
	const queryImports = [];
	while (pending.length > 0) {
		const sourcePath = pending.shift();
		const sourceRelative = repositoryPath(sourcePath);
		if (visited.has(sourceRelative)) continue;
		visited.add(sourceRelative);
		const destinationPath = stagedDestination(sourcePath, inputs);
		if (destinationPath === null) {
			throw new Error(`Unstaged nightly payload entry module ${sourceRelative}.`);
		}
		const sourceFile = createSourceFile(
			sourcePath,
			readFileSync(sourcePath, 'utf8'),
			ScriptTarget.Latest,
			true,
		);
		for (const specifier of localModuleSpecifiers(sourceFile)) {
			const queryless = withoutQueryOrFragment(specifier);
			if (queryless !== specifier) queryImports.push({ importer: sourceRelative, specifier });
			const dependency = resolveLocalDependency(sourcePath, queryless);
			const dependencyDestination = stagedDestination(dependency, inputs);
			if (dependencyDestination === null) {
				throw new Error(
					`Unstaged local import ${sourceRelative} -> ${specifier} `
					+ `(${repositoryPath(dependency)}).`,
				);
			}
			assertReachableDestination({
				dependencyDestination,
				destinationPath,
				importer: sourceRelative,
				specifier,
			});
			if (MODULE_FILE.test(dependency)) pending.push(dependency);
		}
	}
	return { queryImports, visited };
}

function entryModules(inputs) {
	const paths = [];
	for (const input of inputs) {
		const source = resolve(REPOSITORY_ROOT, input.source);
		if (input.kind === 'file') {
			if (MODULE_FILE.test(source)) paths.push(source);
			continue;
		}
		if (!TEST_MODULE_DIRECTORIES.some((directory) => (
			input.destination === directory || input.destination.startsWith(`${directory}/`)
		))) continue;
		paths.push(...moduleFiles(source, input.exclude ?? new Set()));
	}
	return paths;
}

function moduleFiles(root, excludedRootNames, current = root) {
	const paths = [];
	for (const entry of readdirSync(current, { withFileTypes: true })) {
		const path = resolve(current, entry.name);
		const child = relative(root, path);
		if (!child.includes(sep) && excludedRootNames.has(entry.name)) continue;
		if (entry.isDirectory()) paths.push(...moduleFiles(root, excludedRootNames, path));
		else if (entry.isFile() && MODULE_FILE.test(entry.name)) paths.push(path);
	}
	return paths;
}

function localModuleSpecifiers(sourceFile) {
	const specifiers = [];
	visit(sourceFile);
	return specifiers;

	function visit(node) {
		if ((isImportDeclaration(node) || isExportDeclaration(node))
			&& node.moduleSpecifier !== undefined && isStringLiteralLike(node.moduleSpecifier)) {
			retain(node.moduleSpecifier.text);
		} else if (isImportEqualsDeclaration(node)
			&& isExternalModuleReference(node.moduleReference)
			&& node.moduleReference.expression !== undefined
			&& isStringLiteralLike(node.moduleReference.expression)) {
			retain(node.moduleReference.expression.text);
		} else if (isCallExpression(node) && node.arguments.length === 1
			&& isStringLiteralLike(node.arguments[0])
			&& (node.expression.kind === SyntaxKind.ImportKeyword
				|| (isIdentifier(node.expression) && node.expression.text === 'require'))) {
			retain(node.arguments[0].text);
		}
		forEachChild(node, visit);
	}

	function retain(specifier) {
		if (specifier.startsWith('./') || specifier.startsWith('../')) specifiers.push(specifier);
	}
}

function resolveLocalDependency(importer, specifier) {
	const base = resolve(importer, '..', specifier);
	for (const candidate of resolutionCandidates(base)) {
		if (existsSync(candidate) && lstatSync(candidate).isFile()) return candidate;
	}
	throw new Error(
		`Local import ${repositoryPath(importer)} -> ${specifier} does not resolve in the repository.`,
	);
}

function resolutionCandidates(base) {
	const extension = extname(base);
	const paths = [base];
	if (extension === '' || !EXTENSION_CANDIDATES.includes(extension)) {
		paths.push(...EXTENSION_CANDIDATES.map((candidate) => `${base}${candidate}`));
	}
	if (extension === '') {
		paths.push(...EXTENSION_CANDIDATES.map((candidate) => resolve(base, `index${candidate}`)));
	} else {
		for (const replacement of SOURCE_EXTENSION_SUBSTITUTIONS[extension] ?? []) {
			paths.push(`${base.slice(0, -extension.length)}${replacement}`);
		}
	}
	return paths;
}

function stagedDestination(sourcePath, inputs) {
	const destinations = new Set();
	for (const input of inputs) {
		const sourceRoot = resolve(REPOSITORY_ROOT, input.source);
		if (input.kind === 'file') {
			if (sourcePath === sourceRoot) destinations.add(resolve(REPOSITORY_ROOT, input.destination));
			continue;
		}
		const child = relative(sourceRoot, sourcePath);
		if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) continue;
		if ((input.exclude ?? new Set()).has(child.split(sep)[0])) continue;
		destinations.add(resolve(REPOSITORY_ROOT, input.destination, child));
	}
	if (destinations.size > 1) {
		throw new Error(`Nightly payload stages ${repositoryPath(sourcePath)} at conflicting destinations.`);
	}
	return destinations.values().next().value ?? null;
}

function assertReachableDestination({ dependencyDestination, destinationPath, importer, specifier }) {
	const expectedBase = resolve(destinationPath, '..', withoutQueryOrFragment(specifier));
	if (resolutionCandidates(expectedBase).includes(dependencyDestination)) return;
	throw new Error(
		`Nightly payload local import ${importer} -> ${specifier} is relocated to `
		+ `${repositoryPath(dependencyDestination)}, where the staged importer cannot resolve it.`,
	);
}

function withoutQueryOrFragment(specifier) {
	const suffix = specifier.search(/[?#]/u);
	return suffix < 0 ? specifier : specifier.slice(0, suffix);
}

function repositoryPath(path) {
	return relative(REPOSITORY_ROOT, path).split(sep).join('/');
}
