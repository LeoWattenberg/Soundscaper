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
// These audits change the staging inventory, while their repository sources stay
// fixed. Reuse parsed imports and filesystem resolution, never inventory verdicts.
const sourceImports = new Map();
const resolvedDependencies = new Map();

test('nightly payload production modules have a closed local-import graph', () => {
	const result = inspectLocalImportClosure(NIGHTLY_TEST_PAYLOAD_INPUTS);

	assert.ok(result.visited.has('scripts/lib/desktop-nightly-tests-playwright-child.mjs'));
	assert.ok(result.visited.has('scripts/lib/desktop-nightly-tests-progress-reporter.mjs'));
	assert.ok(result.visited.has('scripts/lib/browser-coverage-profile.mjs'));
	assert.ok(result.visited.has('scripts/lib/browser-dynamic-coverage-sources.mjs'));
	assert.ok(result.visited.has('scripts/lib/browser-target-coverage-state.mjs'));
	assert.ok(result.visited.has('src/common/editor/macro-script/dynamic-source-contract.js'));
	assert.ok(result.visited.has('src/common/editor/native-plugin-realtime-worklet.js'));
	assert.ok(result.visited.has('vendor/audacity-design-system/components/src/utils/roseus-colormap.ts'));
	assert.ok(result.visited.has('tests/helpers/framescaper-native-sidecar-fixture.ts'));
	assert.ok(result.visited.has('tests/helpers/framescaper-ordinary-animation-fixture.ts'));
	assert.ok(result.visited.has('tests/helpers/framescaper-ordinary-high-precision-image-fixture.ts'));
	assert.ok(result.visited.has('tests/helpers/interchange-reference.ts'));
	assert.ok(result.visited.has('desktop/main-file-capability-ipc.mjs'));
	assert.ok(result.queryImports.some(({ specifier }) => specifier.endsWith('?worker&url')));
});

test('nightly payload audit rejects an omitted native sidecar fixture dependency', () => {
	const withoutReadLease = NIGHTLY_TEST_PAYLOAD_INPUTS.filter(({ source }) => (
		source !== 'desktop/read-capability-request-lease.js'
	));
	assert.throws(
		() => inspectLocalImportClosure(withoutReadLease),
		/Unstaged local import .*file-capabilities\.js.*read-capability-request-lease\.js/u,
	);
});

test('nightly payload audit rejects an omitted spectrogram painter dependency', () => {
	const withoutColormap = NIGHTLY_TEST_PAYLOAD_INPUTS.filter(({ source }) => (
		source !== 'vendor/audacity-design-system/components/src/utils/roseus-colormap.ts'
	));
	assert.throws(
		() => inspectLocalImportClosure(withoutColormap),
		/Unstaged local import .*pffft-spectrogram\.js.*roseus-colormap\.ts/u,
	);
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
	const destinationInputs = inputs.map((input) => ({
		...input,
		sourceRoot: resolve(REPOSITORY_ROOT, input.source),
		destinationRoot: resolve(REPOSITORY_ROOT, input.destination),
	}));
	const destinations = new Map();
	const visited = new Set();
	const queryImports = [];
	for (let index = 0; index < pending.length; index += 1) {
		const sourcePath = pending[index];
		const sourceRelative = repositoryPath(sourcePath);
		if (visited.has(sourceRelative)) continue;
		visited.add(sourceRelative);
		const destinationPath = destinationOf(sourcePath);
		if (destinationPath === null) {
			throw new Error(`Unstaged nightly payload entry module ${sourceRelative}.`);
		}
		for (const specifier of importsOf(sourcePath)) {
			const queryless = withoutQueryOrFragment(specifier);
			if (queryless !== specifier) queryImports.push({ importer: sourceRelative, specifier });
			const dependency = resolveLocalDependency(sourcePath, queryless);
			const dependencyDestination = destinationOf(dependency);
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

	function destinationOf(sourcePath) {
		if (!destinations.has(sourcePath)) {
			destinations.set(sourcePath, stagedDestination(sourcePath, destinationInputs));
		}
		return destinations.get(sourcePath);
	}
}

function importsOf(sourcePath) {
	if (!sourceImports.has(sourcePath)) {
		const sourceFile = createSourceFile(
			sourcePath, readFileSync(sourcePath, 'utf8'), ScriptTarget.Latest, true,
		);
		sourceImports.set(sourcePath, localModuleSpecifiers(sourceFile));
	}
	return sourceImports.get(sourcePath);
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
	if (resolvedDependencies.has(base)) return resolvedDependencies.get(base);
	for (const candidate of resolutionCandidates(base)) {
		if (existsSync(candidate) && lstatSync(candidate).isFile()) {
			resolvedDependencies.set(base, candidate);
			return candidate;
		}
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
		const sourceRoot = input.sourceRoot;
		if (input.kind === 'file') {
			if (sourcePath === sourceRoot) destinations.add(input.destinationRoot);
			continue;
		}
		const child = relative(sourceRoot, sourcePath);
		if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) continue;
		if ((input.exclude ?? new Set()).has(child.split(sep)[0])) continue;
		destinations.add(resolve(input.destinationRoot, child));
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
