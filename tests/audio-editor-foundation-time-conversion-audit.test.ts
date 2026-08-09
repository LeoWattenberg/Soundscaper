/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';

import {
	FOUNDATION_TIME_CONVERSION_HELPERS,
	FOUNDATION_TIME_CONVERSION_SITES,
	type FoundationTimeConversionPolicy,
} from '../src/common/editor/foundation-time-conversion-audit.ts';
import {
	createSourceFile,
	forEachChild,
	isCallExpression,
	isConditionalExpression,
	isFunctionDeclaration,
	isIdentifier,
	isImportDeclaration,
	isNamedImports,
	isNamespaceImport,
	isStringLiteral,
	ScriptKind,
	ScriptTarget,
	SyntaxKind,
	type CallExpression,
	type Expression,
	type Node,
	type SourceFile,
} from 'typescript';

const REPOSITORY_ROOT = new URL('../', import.meta.url);
const EDITOR_ROOT = new URL('../src/common/editor/', import.meta.url);
const POLICY_ARGUMENT = Object.freeze<Record<string, number | FoundationTimeConversionPolicy>>({
	roundRational: 2,
	secondsToSampleFrame: 2,
	sampleFrameToSeconds: 'exact',
	scaleSampleFrame: 3,
	videoFrameToSampleFrame: 3,
	sampleFrameToVideoFrame: 3,
	videoFrameRangeToSampleRange: 'point',
	beatToSampleFrame: 3,
	countInSampleFrames: 'point',
	sampleFrameToBeat: 'exact',
});

test('every shared timeline/timebase conversion call is classified under named policies', async () => {
	const actual = await collectConversionSites();
	const expected = new Map(FOUNDATION_TIME_CONVERSION_SITES.map((site) => [site.file, site]));
	assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort());
	for (const [file, conversions] of actual) {
		const site = expected.get(file);
		assert.ok(site, `Unclassified timeline/timebase conversion owner: ${file}`);
		assert.ok(site.behavior.length > 20, `${site.id} must explain its semantic behavior`);
		assert.deepEqual(
			Object.fromEntries([...conversions].sort().map(([helper, policies]) => [helper, [...policies].sort()])),
			Object.fromEntries(site.conversions.map((conversion) => [conversion.helper, [...conversion.policies].sort()])),
			`${file} conversion policies drifted`,
		);
	}
});

test('the conversion audit is uniquely identified, deeply frozen, and limited to owned helpers', () => {
	assert.equal(new Set(FOUNDATION_TIME_CONVERSION_SITES.map(({ id }) => id)).size, FOUNDATION_TIME_CONVERSION_SITES.length);
	assert.ok(Object.isFrozen(FOUNDATION_TIME_CONVERSION_SITES));
	for (const site of FOUNDATION_TIME_CONVERSION_SITES) {
		assert.ok(Object.isFrozen(site));
		assert.ok(Object.isFrozen(site.conversions));
		for (const conversion of site.conversions) {
			assert.ok(FOUNDATION_TIME_CONVERSION_HELPERS.includes(conversion.helper));
			assert.ok(Object.isFrozen(conversion.policies));
		}
	}
});

test('the helper inventory is discovered from exported frame-conversion APIs', async () => {
	const discovered = new Set<string>();
	for (const file of ['src/common/editor/timeline-time.ts', 'src/common/editor/timeline-tempo-inverse.ts']) {
		const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
		const parsed = createSourceFile(file, source, ScriptTarget.Latest, true, ScriptKind.TS);
		for (const statement of parsed.statements) {
			if (!isFunctionDeclaration(statement) || !statement.name
				|| !statement.modifiers?.some(({ kind }) => kind === SyntaxKind.ExportKeyword)) continue;
			const name = statement.name.text;
			const ownsNamedPolicy = statement.parameters.some((parameter) => (
				parameter.type?.getText(parsed) === 'TimeRoundingPolicy'
			));
			const isFrameConversion = /frame.*to|to.*frame|scale.*frame|countin.*frame/iu.test(name);
			if (ownsNamedPolicy || isFrameConversion) discovered.add(name);
		}
	}
	assert.deepEqual([...FOUNDATION_TIME_CONVERSION_HELPERS].sort(), [...discovered].sort());
});

async function collectConversionSites(): Promise<Map<string, Map<string, Set<FoundationTimeConversionPolicy>>>> {
	const result = new Map<string, Map<string, Set<FoundationTimeConversionPolicy>>>();
	for (const absoluteFile of await sourceFiles(new URL('.', EDITOR_ROOT).pathname)) {
		const source = await readFile(absoluteFile, 'utf8');
		const file = relative(new URL('.', REPOSITORY_ROOT).pathname, absoluteFile).replaceAll('\\', '/');
		const parsed = createSourceFile(file, source, ScriptTarget.Latest, true, scriptKind(file));
		const aliases = conversionAliases(parsed);
		if (!aliases.size) continue;
		const conversions = new Map<string, Set<FoundationTimeConversionPolicy>>();
		visit(parsed, (node) => {
			if (!isCallExpression(node) || !isIdentifier(node.expression)) return;
			const helper = aliases.get(node.expression.text);
			if (!helper) return;
			const policies = conversionPolicies(helper, node);
			const owned = conversions.get(helper) ?? new Set<FoundationTimeConversionPolicy>();
			for (const policy of policies) owned.add(policy);
			conversions.set(helper, owned);
		});
		if (conversions.size) result.set(file, conversions);
	}
	return result;
}

function conversionAliases(source: SourceFile): Map<string, string> {
	const aliases = new Map<string, string>();
	for (const statement of source.statements) {
		if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) continue;
		if (!/(?:timeline-time|timeline-tempo-inverse)\.ts$/u.test(statement.moduleSpecifier.text)) continue;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings) continue;
		if (isNamespaceImport(bindings)) {
			throw new TypeError(`${source.fileName} must use named shared-time imports so conversion policy discovery remains exhaustive.`);
		}
		if (!isNamedImports(bindings)) continue;
		for (const element of bindings.elements) {
			if (element.isTypeOnly) continue;
			const imported = (element.propertyName ?? element.name).text;
			if (FOUNDATION_TIME_CONVERSION_HELPERS.includes(imported)) aliases.set(element.name.text, imported);
		}
	}
	return aliases;
}

function conversionPolicies(helper: string, call: CallExpression): readonly FoundationTimeConversionPolicy[] {
	const declaration = POLICY_ARGUMENT[helper];
	if (typeof declaration === 'string') return [declaration];
	assert.equal(typeof declaration, 'number', `Missing policy contract for ${helper}`);
	return expressionPolicies(call.arguments[declaration]);
}

function expressionPolicies(expression: Expression | undefined): readonly FoundationTimeConversionPolicy[] {
	if (expression === undefined) return ['point'];
	if (isStringLiteral(expression)) return [assertPolicy(expression.text)];
	if (isConditionalExpression(expression)) {
		return [...expressionPolicies(expression.whenTrue), ...expressionPolicies(expression.whenFalse)];
	}
	throw new TypeError(`A timeline conversion policy must be statically named: ${expression.getText()}`);
}

function assertPolicy(value: string): FoundationTimeConversionPolicy {
	assert.ok(['point', 'enclosingStart', 'enclosingEnd', 'directional', 'exact'].includes(value));
	return value as FoundationTimeConversionPolicy;
}

async function sourceFiles(directory: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...await sourceFiles(path));
		else if (/\.(?:[cm]?[jt]sx?)$/u.test(entry.name)) files.push(path);
	}
	return files;
}

function scriptKind(file: string): ScriptKind {
	if (/\.tsx$/u.test(file)) return ScriptKind.TSX;
	if (/\.jsx$/u.test(file)) return ScriptKind.JSX;
	if (/\.ts$/u.test(file)) return ScriptKind.TS;
	return ScriptKind.JS;
}

function visit(node: Node, callback: (node: Node) => void): void {
	callback(node);
	forEachChild(node, (child) => visit(child, callback));
}
