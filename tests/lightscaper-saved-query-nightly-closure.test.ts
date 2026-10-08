/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, type Metafile } from 'esbuild';
import { createSourceFile, forEachChild, isIdentifier, isNewExpression,
	isStringLiteralLike, ScriptTarget, type Node } from 'typescript';
import { NIGHTLY_TEST_PAYLOAD_INPUTS, NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS } from '../scripts/lib/desktop-nightly-tests-staging.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SPEC = 'tests/browser/lightscaper-saved-query-execution.spec.js';
const NEW_HELPERS = ['tests/helpers/lightscaper-saved-query-native-fixture.ts',
	'tests/helpers/lightscaper-saved-query-native-observer.ts'] as const;
const REUSED_HELPERS = ['tests/helpers/lightscaper-catalog-query-fixture.ts',
	'tests/helpers/lightscaper-smart-collections-native-observer.ts'] as const;
const BUILTINS = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
type Input = Readonly<{ source: string; destination: string; kind: string; exclude?: ReadonlySet<string> }>;
type Graphs = Readonly<{ spec: Metafile; native: Metafile }>;
let graphs: Promise<Graphs> | undefined;

test('nightly packaging admits the actual saved-query execution spec and native new-URL entry closure', async () => {
	const { spec, native } = await actualGraphs();
	assert.deepEqual(Object.keys(native.inputs).filter(path => path.startsWith('tests/helpers/')).sort(),
		[...NEW_HELPERS, ...REUSED_HELPERS].sort(), 'native qualification keeps its exact four-helper closure');
	for (const path of ['src/lightscaper/catalog/photo-smart-collection-query-v1.ts',
		'src/lightscaper/catalog/photo-query-page-kernel-v2.ts', 'src/lightscaper/catalog/photo-stack-query-kernel.ts']) {
		assert.ok(Object.hasOwn(native.inputs, path), `actual native entry must reach ${path}`);
	}
	await assertAdmitted(spec, NIGHTLY_TEST_PAYLOAD_INPUTS);
	await assertAdmitted(native, NIGHTLY_TEST_PAYLOAD_INPUTS);
});

test('removing either new saved-query helper or a reused native helper refuses the actual graph', async () => {
	const { native } = await actualGraphs();
	for (const path of [...NEW_HELPERS, ...REUSED_HELPERS]) {
		await assert.rejects(assertAdmitted(native, NIGHTLY_TEST_PAYLOAD_INPUTS.filter(input => input.source !== path)),
			error => error instanceof Error && error.message.includes(path));
	}
	assert.equal(NIGHTLY_TEST_PAYLOAD_INPUTS.some(input => input.source === 'tests/helpers' && input.kind === 'directory'), false);
});

test('the actual routed saved-query entry emits no Node or unresolved local runtime imports', async () => {
	const { native } = await actualGraphs();
	for (const output of Object.values(native.outputs)) for (const dependency of output.imports) {
		if (!dependency.external) continue;
		assert.equal(BUILTINS.has(dependency.path), false, `browser entry emits Node import ${dependency.path}`);
		assert.ok(!dependency.path.startsWith('.') && !isAbsolute(dependency.path), `unresolved browser local ${dependency.path}`);
		assert.ok(NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS.includes(packageOf(dependency.path)), `unregistered browser runtime ${dependency.path}`);
	}
});

test('both saved-query native helpers are exact strict test roots', async () => {
	const config = JSON.parse(await readFile(resolve(ROOT, 'tsconfig.tests.json'), 'utf8')) as { include: unknown };
	assert.ok(Array.isArray(config.include));
	for (const path of NEW_HELPERS) assert.ok(config.include.includes(path), `strict test roots omit ${path}`);
	assert.equal(config.include.includes('tests/helpers/**/*.ts'), false);
	assert.equal(config.include.includes('tests/**/*.ts'), false);
});

function actualGraphs(): Promise<Graphs> {
	graphs ??= readActualGraphs();
	return graphs;
}

async function readActualGraphs(): Promise<Graphs> {
	const source = createSourceFile(SPEC, await readFile(resolve(ROOT, SPEC), 'utf8'), ScriptTarget.Latest, true);
	const entries: string[] = [];
	function visit(node: Node): void {
		if (isNewExpression(node) && isIdentifier(node.expression) && node.expression.text === 'URL'
			&& node.arguments?.length === 2 && isStringLiteralLike(node.arguments[0])
			&& node.arguments[0].text.startsWith('../helpers/') && node.arguments[1].getText() === 'import.meta.url') {
			entries.push(node.arguments[0].text);
		}
		forEachChild(node, visit);
	}
	visit(source);
	assert.deepEqual(entries, ['../helpers/lightscaper-saved-query-native-fixture.ts'],
		'qualify the maintained spec’s exact native entry');
	const [spec, native] = await Promise.all([
		build({ absWorkingDir: ROOT, entryPoints: [SPEC], bundle: true, write: false, metafile: true,
			platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' }),
		build({ absWorkingDir: ROOT, entryPoints: [resolve(ROOT, 'tests/browser', entries[0]!)], bundle: true,
			write: false, metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent' }),
	]);
	return { spec: spec.metafile, native: native.metafile };
}

async function assertAdmitted(graph: Metafile, inputs: readonly Input[]): Promise<void> {
	const { default: config } = await import('../electron-builder.nightly-tests.config.cjs');
	assert.ok(Array.isArray(config.extraResources));
	const payload = config.extraResources.find(resource => typeof resource === 'object' && resource.to === 'nightly-tests');
	assert.ok(payload && typeof payload === 'object' && Array.isArray(payload.filter));
	const missing: string[] = [];
	for (const input of Object.keys(graph.inputs)) {
		const path = relative(ROOT, resolve(ROOT, input)).split(sep).join('/');
		if (path.startsWith('node_modules/')) {
			assert.ok(NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS.includes(packageOf(path.slice('node_modules/'.length))), path);
			continue;
		}
		const destination = stagedDestination(path, inputs);
		if (destination === null) { missing.push(path); continue; }
		assert.equal(destination, path, `native entry cannot resolve relocated ${path}`);
		assert.ok(payload.filter.some(pattern => matchesGlob(destination, pattern)), `packaged filter drops ${path}`);
	}
	for (const output of Object.values(graph.outputs)) for (const dependency of output.imports) {
		if (!dependency.external || BUILTINS.has(dependency.path)) continue;
		assert.ok(!dependency.path.startsWith('.') && !isAbsolute(dependency.path), `unresolved local ${dependency.path}`);
		assert.ok(NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS.includes(packageOf(dependency.path)), `runtime roots omit ${dependency.path}`);
	}
	assert.deepEqual(missing, [], `NIGHTLY_TEST_PAYLOAD_INPUTS is missing ${missing.join(', ')}`);
}

function stagedDestination(path: string, inputs: readonly Input[]): string | null {
	if (path.startsWith('../') || isAbsolute(path)) return null;
	for (const input of inputs) {
		if (input.kind === 'file') { if (path === input.source) return input.destination; continue; }
		if (!path.startsWith(`${input.source}/`)) continue;
		const child = path.slice(input.source.length + 1);
		if (input.exclude?.has(child.split('/')[0]!)) continue;
		return `${input.destination}/${child}`;
	}
	return null;
}

function packageOf(path: string): string {
	return path.startsWith('@') ? path.split('/').slice(0, 2).join('/') : path.split('/')[0]!;
}
