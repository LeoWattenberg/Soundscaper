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
	preProcessFile,
	ScriptKind,
	ScriptTarget,
	SyntaxKind,
	type CallExpression,
	type Expression,
	type Node,
	type SourceFile,
} from 'typescript';

const REPOSITORY_ROOT = new URL('../', import.meta.url);
// The register claims every maintained conversion site, so the walk covers every
// maintained tree that can import the shared time helpers: the shared editor and
// both product trees under `src/`, the desktop main process, and the native hosts.
const AUDIT_ROOTS: readonly URL[] = Object.freeze([
	new URL('../src/', import.meta.url),
	new URL('../desktop/', import.meta.url),
	new URL('../native/', import.meta.url),
]);
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
	createSampleFrameBeatProjector: 'exact',
});

interface TimeConversionAudit {
	conversions: Map<string, Map<string, Set<FoundationTimeConversionPolicy>>>;
	rawSampleRateChanges: Map<string, string[]>;
}

// Both inventories inspect the same immutable checkout. Keep only their small
// results, so the second assertion does not parse every maintained source again
// or retain the entire repository's syntax trees in memory.
let audit: Promise<TimeConversionAudit> | undefined;
function timeConversionAudit(): Promise<TimeConversionAudit> {
	return audit ??= collectTimeConversionAudit();
}

test('every shared timeline/timebase conversion call is classified under named policies', async () => {
	const actual = (await timeConversionAudit()).conversions;
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

test('raw sample-rate changes of basis cannot bypass shared timeline policy', async () => {
	// Resampler state owns a fractional input phase, so these are DSP buffer
	// geometry rather than integer timeline conversions.
	assert.deepEqual((await timeConversionAudit()).rawSampleRateChanges, new Map([
		['src/common/editor/resample.js', [
			'Math.ceil((combined[0].length + 1) * outputRate / inputRate)',
			'Math.round(totalInputFrames * outputRate / inputRate)',
			'Math.round((totalInputFrames - initialInputPosition) * outputRate / inputRate)',
		]],
	]));
});

test('the source gate preserves escaped helper imports, namespace rejection and raw rate arithmetic', () => {
	assert.equal(needsTimeConversionSyntaxTree('export const unchanged = source.frameCount;'), false);
	assert.equal(needsTimeConversionSyntaxTree('import { unrelated } from "./other.ts";'), false);
	for (const path of ['./timeline-time.ts', './timeline\\x2dtime.ts', './timeline\\u002dtime.ts']) {
		const content = `const view = <span>{\`nested ${'${value}'}\`}</span>;
import { sampleFrameToSeconds as duration } from "${path}";
const seconds = duration(frames, sampleRate);`;
		assert.equal(needsTimeConversionSyntaxTree(content), true, path);
		const parsed = createSourceFile('Fixture.tsx', content, ScriptTarget.Latest, true, ScriptKind.TSX);
		assert.deepEqual(collectConversionSites(parsed), new Map([
			['sampleFrameToSeconds', new Set(['exact'])],
		]));
	}
	const namespace = 'import * as time from "./timeline\\x2dtime.ts";';
	assert.equal(needsTimeConversionSyntaxTree(namespace), true);
	assert.throws(() => collectConversionSites(createSourceFile(
		'Fixture.ts', namespace, ScriptTarget.Latest, true, ScriptKind.TS,
	)), /must use named shared-time imports/u);
	for (const method of ['round', 'ceil', 'floor', 'trunc']) {
		const content = `const frame = Math.${method}(durationFrames * outputRate / inputRate);`;
		assert.equal(needsTimeConversionSyntaxTree(content), true);
		assert.deepEqual(collectRawSampleRateChanges(createSourceFile(
			'Fixture.ts', content, ScriptTarget.Latest, true, ScriptKind.TS,
		)), [`Math.${method}(durationFrames * outputRate / inputRate)`]);
	}
	for (const content of [
		'// Math.round(durationFrames * outputRate / inputRate);',
		'const text = "Math.round(durationFrames * outputRate / inputRate)";',
		'// import { duration } from "./timeline-time.ts";',
		'const text = \'import { duration } from "./timeline-time.ts";\';',
	]) {
		assert.equal(needsTimeConversionSyntaxTree(content), true);
		const parsed = createSourceFile('Fixture.ts', content, ScriptTarget.Latest, true, ScriptKind.TS);
		assert.deepEqual(collectRawSampleRateChanges(parsed), []);
		assert.deepEqual(collectConversionSites(parsed), new Map());
	}
});

function needsTimeConversionSyntaxTree(source: string): boolean {
	// The collectors inspect only these exact expressions and owned imports.
	// Literal paths are cheap to recognize; only escaped paths need the scanner.
	if (/\bMath\.(?:round|ceil|floor|trunc)\b/u.test(source)
		|| source.includes('timeline-time') || source.includes('timeline-tempo-inverse')) return true;
	if (!source.includes('\\')) return false;
	return preProcessFile(source, true, true).importedFiles.some(({ fileName }) => (
		/(?:timeline-time|timeline-tempo-inverse)\.ts$/u.test(fileName)
	));
}

async function collectTimeConversionAudit(): Promise<TimeConversionAudit> {
	const conversions = new Map<string, Map<string, Set<FoundationTimeConversionPolicy>>>();
	const rawSampleRateChanges = new Map<string, string[]>();
	for (const absoluteFile of await auditedSourceFiles()) {
		const source = await readFile(absoluteFile, 'utf8');
		if (!needsTimeConversionSyntaxTree(source)) continue;
		const file = relative(new URL('.', REPOSITORY_ROOT).pathname, absoluteFile).replaceAll('\\', '/');
		const parsed = createSourceFile(file, source, ScriptTarget.Latest, true, scriptKind(file));
		const calls = collectRawSampleRateChanges(parsed);
		if (calls.length) rawSampleRateChanges.set(file, calls);
		const sites = collectConversionSites(parsed);
		if (sites.size) conversions.set(file, sites);
	}
	return { conversions, rawSampleRateChanges };
}

function collectRawSampleRateChanges(parsed: SourceFile): string[] {
	const result: string[] = [];
	visit(parsed, (node) => {
		if (!isCallExpression(node)) return;
		if (!/^Math\.(?:round|ceil|floor|trunc)$/u.test(node.expression.getText(parsed))) return;
		const arithmetic = node.arguments[0]?.getText(parsed) ?? '';
		const rateOccurrences = arithmetic.match(
			/\b(?:inputRate|outputRate|oldRate|newRate|projectSampleRate|sourceSampleRate|sampleRate)\b/gu,
		)?.length ?? 0;
		if (rateOccurrences < 2 || !/(?:frame|length|duration|selection|start|tail|warmup)/iu.test(arithmetic)
			|| !/[*/]/u.test(arithmetic)) return;
		result.push(node.getText(parsed).replace(/\s+/gu, ' '));
	});
	return result;
}

function collectConversionSites(parsed: SourceFile): Map<string, Set<FoundationTimeConversionPolicy>> {
	const conversions = new Map<string, Set<FoundationTimeConversionPolicy>>();
	const aliases = conversionAliases(parsed);
	if (!aliases.size) return conversions;
	visit(parsed, (node) => {
		if (!isCallExpression(node) || !isIdentifier(node.expression)) return;
		const helper = aliases.get(node.expression.text);
		if (!helper) return;
		const policies = conversionPolicies(helper, node);
		const owned = conversions.get(helper) ?? new Set<FoundationTimeConversionPolicy>();
		for (const policy of policies) owned.add(policy);
		conversions.set(helper, owned);
	});
	return conversions;
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

async function auditedSourceFiles(): Promise<string[]> {
	const files: string[] = [];
	for (const root of AUDIT_ROOTS) files.push(...await sourceFiles(new URL('.', root).pathname));
	return files;
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
