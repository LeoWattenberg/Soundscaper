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
const SPEC = 'tests/browser/lightscaper-smart-collections-storage.spec.js';
const BUILTINS = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
type Input = Readonly<{ source: string; destination: string; kind: string; exclude?: ReadonlySet<string> }>;
const graphs = actualGraphs();

test('nightly packaging admits the actual saved-query browser spec and native new-URL entry closure', async () => {
	const { spec, native } = await graphs;
	for (const path of ['tests/helpers/lightscaper-smart-collections-native-fixture.ts',
		'tests/helpers/lightscaper-smart-collections-native-observer.ts', 'tests/helpers/lightscaper-catalog-query-fixture.ts',
		'src/lightscaper/catalog/photo-smart-collection-audit-v1.ts', 'src/lightscaper/catalog/photo-smart-collection-repository-v1.ts']) {
		assert.ok(Object.hasOwn(native.inputs, path), `actual native entry must reach ${path}`);
	}
	await assertAdmitted(spec, NIGHTLY_TEST_PAYLOAD_INPUTS);
	await assertAdmitted(native, NIGHTLY_TEST_PAYLOAD_INPUTS);
});

test('removing either saved-query native helper or its catalog fixture refuses the actual graph', async () => {
	const { native } = await graphs;
	for (const path of ['tests/helpers/lightscaper-smart-collections-native-fixture.ts',
		'tests/helpers/lightscaper-smart-collections-native-observer.ts', 'tests/helpers/lightscaper-catalog-query-fixture.ts']) {
		await assert.rejects(assertAdmitted(native, NIGHTLY_TEST_PAYLOAD_INPUTS.filter(input => input.source !== path)),
			error => error instanceof Error && error.message.includes(path));
	}
	assert.equal(NIGHTLY_TEST_PAYLOAD_INPUTS.some(input => input.source === 'tests/helpers' && input.kind === 'directory'), false);
});

async function actualGraphs(): Promise<Readonly<{ spec: Metafile; native: Metafile }>> {
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
	assert.equal(entries.length, 1, 'qualify the maintained spec’s exact native entry');
	const [spec, native] = await Promise.all([
		build({ absWorkingDir: ROOT, entryPoints: [SPEC], bundle: true, write: false, metafile: true,
			platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' }),
		build({ absWorkingDir: ROOT, entryPoints: [resolve(ROOT, 'tests/browser', entries[0]!)], bundle: true,
			write: false, metafile: true, platform: 'browser', format: 'esm', external: ['module'], logLevel: 'silent' }),
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
		if (!dependency.external || BUILTINS.has(dependency.path) || dependency.path === 'module') continue;
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
