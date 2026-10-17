/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createSourceFile, forEachChild, isIdentifier, isNewExpression, isStringLiteralLike, ScriptTarget, type Node } from 'typescript';
import { NIGHTLY_TEST_PAYLOAD_INPUTS, stageDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-staging.mjs';
import { createFixture } from './helpers/nightly-tests-staging-fixture.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SPEC = 'tests/browser/lightscaper-develop-dehaze.spec.js';
const REFERENCE = 'tests/helpers/video-dehaze-reference.ts';
const SUPPORT = 'tests/helpers/framescaper-global-export-fixture.ts';
const closures = readClosures();

test('the maintained Dehaze spec and its native URL entry have exact nightly helper custody', async () => {
	const { spec, native } = await closures;
	assert.ok(spec.includes(REFERENCE)); assert.ok(native.includes(SUPPORT));
	assert.ok(native.includes('src/common/editor/video-dehaze-v1.ts'));
	assert.ok(native.includes('src/framescaper/editor-video-exact-browser-effects-finishing.ts'));
	assertAdmitted(spec, NIGHTLY_TEST_PAYLOAD_INPUTS); assertAdmitted(native, NIGHTLY_TEST_PAYLOAD_INPUTS);
	assert.deepEqual(NIGHTLY_TEST_PAYLOAD_INPUTS.filter(input => input.source === REFERENCE)
		.map(({ source, destination, kind }) => ({ source, destination, kind })), [{ source: REFERENCE, destination: REFERENCE, kind: 'file' }]);
	assert.equal(NIGHTLY_TEST_PAYLOAD_INPUTS.some(input => input.source === 'tests/helpers' && input.kind === 'directory'), false);
});

test('omitting either reached support leaf refuses the actual Dehaze graph', async () => {
	const { spec, native } = await closures;
	for (const [graph, path] of [[spec, REFERENCE], [native, SUPPORT]] as const) {
		assert.ok(graph.includes(path));
		assert.throws(() => assertAdmitted(graph, NIGHTLY_TEST_PAYLOAD_INPUTS.filter(input => input.source !== path)),
			error => error instanceof Error && error.message.includes(path));
	}
});

test('the nightly fixture stages the exact independent Dehaze reference and refuses its removal', async context => {
	const fixture = await createFixture(context);
	const expected = await readFile(resolve(ROOT, REFERENCE));
	assert.deepEqual(await readFile(resolve(fixture.repositoryRoot, REFERENCE)), expected);
	await stageDesktopNightlyTests(fixture);
	assert.deepEqual(await readFile(resolve(fixture.outputRoot, REFERENCE)), expected);
	await rm(resolve(fixture.repositoryRoot, REFERENCE));
	await assert.rejects(stageDesktopNightlyTests(fixture), error => error instanceof Error && error.message.includes(REFERENCE));
	assert.deepEqual(await readFile(resolve(fixture.outputRoot, REFERENCE)), expected);
});

async function readClosures(): Promise<{ spec: string[]; native: string[] }> {
	const source = createSourceFile(SPEC, await readFile(resolve(ROOT, SPEC), 'utf8'), ScriptTarget.Latest, true);
	const entries: string[] = [];
	function visit(node: Node): void {
		if (isNewExpression(node) && isIdentifier(node.expression) && node.expression.text === 'URL'
			&& node.arguments?.length === 2) {
			const [path, base] = node.arguments;
			if (path && base && isStringLiteralLike(path) && base.getText() === 'import.meta.url') entries.push(path.text);
		}
		forEachChild(node, visit);
	}
	visit(source); assert.deepEqual(entries, ['./helpers/lightscaper-dehaze-reference.ts']);
	const [entry] = entries; assert.ok(entry);
	const [spec, native] = await Promise.all([
		build({ absWorkingDir: ROOT, entryPoints: [SPEC], bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', packages: 'external', preserveSymlinks: true, logLevel: 'silent' }),
		build({ absWorkingDir: ROOT, entryPoints: [resolve(ROOT, 'tests/browser', entry)], bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', preserveSymlinks: true, logLevel: 'silent' }),
	]);
	for (const output of Object.values(native.metafile.outputs)) assert.deepEqual(output.imports, []);
	assert.equal(Object.keys(native.metafile.inputs).some(path => path.includes('node_modules/@ffmpeg/')), false);
	return { spec: Object.keys(spec.metafile.inputs), native: Object.keys(native.metafile.inputs) };
}

function assertAdmitted(paths: readonly string[], inputs: typeof NIGHTLY_TEST_PAYLOAD_INPUTS): void {
	for (const path of paths.filter(value => !value.startsWith('node_modules/'))) {
		assert.ok(inputs.some(input => input.kind === 'file' ? path === input.source && path === input.destination
			: path.startsWith(`${input.source}/`) && input.source === input.destination && !('exclude' in input && input.exclude.has(path.slice(input.source.length + 1).split('/')[0]!))), `nightly graph omits ${path}`);
	}
}
