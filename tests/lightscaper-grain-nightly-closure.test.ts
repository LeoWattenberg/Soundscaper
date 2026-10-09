/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createSourceFile, forEachChild, isIdentifier, isNewExpression, isStringLiteralLike, ScriptTarget, type Node } from 'typescript';
import { NIGHTLY_TEST_PAYLOAD_INPUTS } from '../scripts/lib/desktop-nightly-tests-staging.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SPEC = 'tests/browser/lightscaper-develop-grain.spec.js';
const REFERENCE = 'tests/helpers/video-grain-reference.ts';
const SUPPORT = 'tests/helpers/framescaper-global-export-fixture.ts';
const closures = readClosures();

test('the maintained Grain spec and its native entry have exact nightly helper custody', async () => {
	const { spec, native } = await closures;
	assert.ok(spec.includes(REFERENCE)); assert.ok(native.includes(SUPPORT));
	assert.ok(native.includes('src/common/editor/ui/video-preview-grain-v1.ts'));
	assert.ok(native.includes('src/common/editor/imaging/pixel-frame-grain-v1.ts'));
	assertAdmitted(spec, NIGHTLY_TEST_PAYLOAD_INPUTS); assertAdmitted(native, NIGHTLY_TEST_PAYLOAD_INPUTS);
	assert.deepEqual(NIGHTLY_TEST_PAYLOAD_INPUTS.filter(input => input.source === REFERENCE)
		.map(({ source, destination, kind }) => ({ source, destination, kind })), [{ source: REFERENCE, destination: REFERENCE, kind: 'file' }]);
	assert.equal(NIGHTLY_TEST_PAYLOAD_INPUTS.some(input => input.source === 'tests/helpers' && input.kind === 'directory'), false);
});

test('omitting either reached support leaf refuses the actual Grain graph', async () => {
	const { spec, native } = await closures;
	for (const [graph, path] of [[spec, REFERENCE], [native, SUPPORT]] as const) {
		assert.throws(() => assertAdmitted(graph, NIGHTLY_TEST_PAYLOAD_INPUTS.filter(input => input.source !== path)), error => error instanceof Error && error.message.includes(path));
	}
});

async function readClosures(): Promise<{ spec: string[]; native: string[] }> {
	const source = createSourceFile(SPEC, await readFile(resolve(ROOT, SPEC), 'utf8'), ScriptTarget.Latest, true);
	const entries: string[] = [];
	function visit(node: Node): void {
		if (isNewExpression(node) && isIdentifier(node.expression) && node.expression.text === 'URL'
			&& node.arguments?.length === 2 && isStringLiteralLike(node.arguments[0]) && node.arguments[1].getText() === 'import.meta.url') entries.push(node.arguments[0].text);
		forEachChild(node, visit);
	}
	visit(source); assert.deepEqual(entries, ['./helpers/lightscaper-grain-reference.ts']);
	const [spec, native] = await Promise.all([
		build({ absWorkingDir: ROOT, entryPoints: [SPEC], bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' }),
		build({ absWorkingDir: ROOT, entryPoints: [resolve(ROOT, 'tests/browser', entries[0]!)], bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent' }),
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
