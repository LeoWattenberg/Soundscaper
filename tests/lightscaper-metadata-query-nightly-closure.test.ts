/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, type Metafile } from 'esbuild';
import { createSourceFile, forEachChild, isIdentifier, isNewExpression, isStringLiteralLike,
	isVariableDeclaration, ScriptTarget, type Node } from 'typescript';

import { NIGHTLY_TEST_PAYLOAD_INPUTS, NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS } from '../scripts/lib/desktop-nightly-tests-staging.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UI_SPEC = 'tests/browser/lightscaper-metadata-query.spec.js';
const STORAGE_SPEC = 'tests/browser/lightscaper-metadata-query-storage.spec.js';
const BUILTINS = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
type PayloadInput = Readonly<{ source: string; destination: string; kind: string; exclude?: ReadonlySet<string> }>;
type Closure = Readonly<{ inputs: readonly string[]; externalPackages: readonly string[] }>;
const closures = readActualClosures();

test('the nightly payload admits the metadata spec and its actual static byte-fixture imports', async () => {
	const { spec } = await closures;
	assert.ok(spec.inputs.includes('tests/helpers/lightscaper-metadata-query-byte-fixture.ts'));
	assert.ok(spec.inputs.includes('tests/helpers/image-metadata-fixtures.ts'));
	await assertAdmitted(spec, NIGHTLY_TEST_PAYLOAD_INPUTS);
});

test('the nightly payload admits the actual new-URL observer entry and its native encoder closure', async () => {
	const { observer } = await closures;
	for (const path of ['lightscaper-metadata-query-native-fixture.ts', 'lightscaper-photo-orientation-native-fixture.ts',
		'lightscaper-photo-orientation-oracle.ts']) assert.ok(observer.inputs.includes(`tests/helpers/${path}`), path);
	await assertAdmitted(observer, NIGHTLY_TEST_PAYLOAD_INPUTS);
});

test('the nightly payload admits the actual storage ENTRY including its external catalog fixture', async () => {
	const { storage } = await closures;
	assert.ok(storage.inputs.includes('tests/helpers/lightscaper-catalog-query-fixture.ts'));
	assert.ok(storage.inputs.includes('src/lightscaper/catalog/photo-stack-query-v2.ts'));
	await assertAdmitted(storage, NIGHTLY_TEST_PAYLOAD_INPUTS);
});

test('each reached helper omission refuses the real graph, including dynamic and inline entries', async () => {
	const { spec, observer, storage } = await closures;
	for (const [graph, paths] of [
		[spec, ['lightscaper-metadata-query-byte-fixture.ts', 'image-metadata-fixtures.ts']],
		[observer, ['lightscaper-metadata-query-native-fixture.ts', 'lightscaper-photo-orientation-native-fixture.ts',
			'lightscaper-photo-orientation-oracle.ts']],
		[storage, ['lightscaper-catalog-query-fixture.ts']],
	] as const) {
		for (const name of paths) {
			const path = `tests/helpers/${name}`;
			const inputs = NIGHTLY_TEST_PAYLOAD_INPUTS.filter(input => input.source !== path);
			await assert.rejects(assertAdmitted(graph, inputs), error => error instanceof Error && error.message.includes(path));
		}
	}
	assert.equal(NIGHTLY_TEST_PAYLOAD_INPUTS.some(input => input.source === 'tests/helpers' && input.kind === 'directory'), false);
});

async function readActualClosures(): Promise<Readonly<{ spec: Closure; observer: Closure; storage: Closure }>> {
	const [uiSource, storageSource] = await Promise.all([readFile(resolve(ROOT, UI_SPEC), 'utf8'), readFile(resolve(ROOT, STORAGE_SPEC), 'utf8')]);
	const observerUrls: string[] = [];
	visitSource(UI_SPEC, uiSource, node => {
		if (isNewExpression(node) && isIdentifier(node.expression) && node.expression.text === 'URL'
			&& node.arguments?.length === 2 && isStringLiteralLike(node.arguments[0])
			&& node.arguments[0].text.startsWith('../helpers/') && node.arguments[1].getText() === 'import.meta.url') {
			observerUrls.push(node.arguments[0].text);
		}
	});
	assert.equal(observerUrls.length, 1, 'qualify the exact observer URL used by the maintained spec');
	const storageEntries: string[] = [];
	visitSource(STORAGE_SPEC, storageSource, node => {
		if (isVariableDeclaration(node) && isIdentifier(node.name) && node.name.text === 'ENTRY'
			&& node.initializer && isStringLiteralLike(node.initializer)) storageEntries.push(node.initializer.text);
	});
	assert.equal(storageEntries.length, 1, 'qualify the exact inline ENTRY used by the maintained storage spec');
	const [spec, observer, storage] = await Promise.all([
		build({ absWorkingDir: ROOT, entryPoints: [UI_SPEC], bundle: true, write: false, metafile: true,
			platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' }),
		build({ absWorkingDir: ROOT, entryPoints: [resolve(ROOT, 'tests/browser', observerUrls[0])],
			bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', external: ['module'], logLevel: 'silent' }),
		build({ absWorkingDir: ROOT, stdin: { contents: storageEntries[0], resolveDir: ROOT, sourcefile: 'metadata-storage-native.js' },
			bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', external: ['module'], logLevel: 'silent' }),
	]);
	return { spec: closureOf(spec.metafile), observer: closureOf(observer.metafile), storage: closureOf(storage.metafile) };
}

function visitSource(path: string, contents: string, callback: (node: Node) => void): void {
	const source = createSourceFile(path, contents, ScriptTarget.Latest, true);
	function visit(node: Node): void { callback(node); forEachChild(node, visit); }
	visit(source);
}

function closureOf(metafile: Metafile): Closure {
	const inputs = Object.keys(metafile.inputs).filter(input => input !== 'metadata-storage-native.js')
		.map(input => relative(ROOT, resolve(ROOT, input)).split(sep).join('/'));
	const externalPackages = new Set<string>();
	// Only emitted externals need runtime packages. Input metadata also records
	// erased type imports as external local paths that never reach the runner.
	for (const output of Object.values(metafile.outputs)) {
		for (const dependency of output.imports) {
			if (dependency.external && !BUILTINS.has(dependency.path) && dependency.path !== 'module') {
				assert.ok(!dependency.path.startsWith('.') && !isAbsolute(dependency.path), `unresolved local ${dependency.path}`);
				externalPackages.add(packageOf(dependency.path));
			}
		}
	}
	return { inputs, externalPackages: [...externalPackages] };
}

async function assertAdmitted(closure: Closure, inputs: readonly PayloadInput[]): Promise<void> {
	const { default: config } = await import('../electron-builder.nightly-tests.config.cjs');
	const resources = config.extraResources;
	assert.ok(Array.isArray(resources));
	const payload = resources.find(resource => typeof resource === 'object' && resource.to === 'nightly-tests');
	assert.ok(payload && typeof payload === 'object');
	const filter = payload.filter;
	assert.ok(Array.isArray(filter));
	const missing: string[] = [];
	for (const input of closure.inputs) {
		if (input.startsWith('node_modules/')) {
			assert.ok(NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS.includes(packageOf(input.slice('node_modules/'.length))), input);
			continue;
		}
		const destination = stagedDestination(input, inputs);
		if (destination === null) { missing.push(input); continue; }
		assert.ok(filter.some(pattern => matchesGlob(destination, pattern)), `packaged filter drops ${input}`);
		assert.equal(destination, input, `the actual native entry cannot resolve relocated source ${input}`);
	}
	for (const name of closure.externalPackages) assert.ok(NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS.includes(name), `runtime roots omit ${name}`);
	assert.deepEqual(missing, [], `NIGHTLY_TEST_PAYLOAD_INPUTS is missing ${missing.join(', ')}`);
}

function stagedDestination(path: string, inputs: readonly PayloadInput[]): string | null {
	if (path.startsWith('../') || isAbsolute(path)) return null;
	for (const input of inputs) {
		if (input.kind === 'file') { if (path === input.source) return input.destination; continue; }
		if (!path.startsWith(`${input.source}/`)) continue;
		const child = path.slice(input.source.length + 1);
		if (input.exclude?.has(child.split('/')[0])) continue;
		return `${input.destination}/${child}`;
	}
	return null;
}

function packageOf(specifier: string): string {
	const segments = specifier.split('/');
	return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}
