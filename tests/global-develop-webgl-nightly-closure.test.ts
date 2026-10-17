/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createSourceFile, forEachChild, isIdentifier, isNewExpression, isStringLiteralLike, ScriptTarget, type Node } from 'typescript';
import test from 'node:test';
import { build } from 'esbuild';
import { NIGHTLY_TEST_PAYLOAD_INPUTS } from '../scripts/lib/desktop-nightly-tests-staging.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HELPER = 'tests/helpers/global-develop-webgl-native-fixture.ts';
const SPEC = 'tests/browser/framescaper-global-develop-parity.spec.js';

test('native global renderer entry bundles the real Frame authoring and compositor with no external browser imports', async () => {
	const source = createSourceFile(SPEC, await readFile(resolve(ROOT, SPEC), 'utf8'), ScriptTarget.Latest, true), entries: string[] = [];
	function visit(node: Node): void {
		if (isNewExpression(node) && isIdentifier(node.expression) && node.expression.text === 'URL'
			&& node.arguments?.length === 2 && isStringLiteralLike(node.arguments[0])
			&& node.arguments[1].getText() === 'import.meta.url') entries.push(node.arguments[0].text);
		forEachChild(node, visit);
	}
	visit(source); assert.deepEqual(entries, ['../helpers/global-develop-webgl-native-fixture.ts']);
	const bundle = await build({ absWorkingDir: ROOT, entryPoints: [resolve(ROOT, 'tests/browser', entries[0]!)], bundle: true, write: false,
		format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' });
	for (const path of ['src/framescaper/editor-project-finishing-commands.ts',
		'src/framescaper/editor-video-exact-browser-effects-finishing.ts', 'src/common/editor/ui/video-preview-compositor.js',
		'src/common/editor/ui/video-preview-effects-shader.js', 'src/common/editor/imaging/pixel-frame-global-develop-v1.ts']) {
		assert.ok(Object.hasOwn(bundle.metafile.inputs, path), `native entry does not reach ${path}`);
	}
	assert.deepEqual(Object.keys(bundle.metafile.inputs).filter(path => path.startsWith('tests/helpers/')), [HELPER]);
	for (const output of Object.values(bundle.metafile.outputs)) assert.deepEqual(output.imports, []);
});

test('the focused native helper has exact nightly and strict roots without a broad helper-directory allowance', async () => {
	assert.deepEqual(NIGHTLY_TEST_PAYLOAD_INPUTS.filter(input => input.source === HELPER).map(input => ({ source: input.source,
		destination: input.destination, kind: input.kind })), [{ source: HELPER, destination: HELPER, kind: 'file' }]);
	assert.equal(NIGHTLY_TEST_PAYLOAD_INPUTS.some(input => input.source === 'tests/helpers' && input.kind === 'directory'), false);
	const config = JSON.parse(await readFile(new URL('../tsconfig.tests.json', import.meta.url), 'utf8')) as { include: string[] };
	assert.ok(config.include.includes(HELPER)); assert.equal(config.include.includes('tests/helpers/**/*.ts'), false);
});
