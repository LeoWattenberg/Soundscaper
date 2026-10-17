/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { createSourceFile, forEachChild, isIdentifier, isNewExpression, isStringLiteralLike, ScriptTarget, type Node } from 'typescript';
import { NIGHTLY_TEST_PAYLOAD_INPUTS } from '../scripts/lib/desktop-nightly-tests-staging.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HELPER = 'tests/helpers/framescaper-global-export-fixture.ts';

test('native selected-finishing helper is exactly admitted and bundles no Node/WASM fixture code', async () => {
	for (const spec of ['framescaper-global-export-pipeline.spec.js','framescaper-post-crop-vignette.spec.js']) {
		const source = createSourceFile(spec, await readFile(new URL(`./browser/${spec}`, import.meta.url), 'utf8'), ScriptTarget.Latest, true);
		const entries: string[] = [];
		function visit(node: Node): void {
			if (isNewExpression(node) && isIdentifier(node.expression) && node.expression.text === 'URL'
				&& node.arguments?.length === 2 && isStringLiteralLike(node.arguments[0]) && node.arguments[1].getText() === 'import.meta.url') entries.push(node.arguments[0].text);
			forEachChild(node, visit);
		}
		visit(source); assert.deepEqual(entries, ['../helpers/framescaper-global-export-fixture.ts']);
		assert.deepEqual(NIGHTLY_TEST_PAYLOAD_INPUTS.filter(input => input.source === HELPER).map(input => ({ source: input.source,
			destination: input.destination, kind: input.kind })), [{ source: HELPER, destination: HELPER, kind: 'file' }]);
		const config = JSON.parse(await readFile(new URL('../tsconfig.tests.json', import.meta.url), 'utf8')) as { include: string[] };
		assert.ok(config.include.includes(HELPER));
		assert.equal(NIGHTLY_TEST_PAYLOAD_INPUTS.some(input => input.source === 'tests/helpers' && input.kind === 'directory'), false);
		const bundle = await build({ absWorkingDir: ROOT, entryPoints: [fileURLToPath(new URL(entries[0]!, new URL('./browser/', import.meta.url)))], bundle: true, write: false,
			format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' });
		for (const source of ['src/framescaper/selected-finishing-exact-frame-execution.ts',
			'src/framescaper/editor-video-exact-browser-effects-finishing.ts', 'src/common/editor/ui/video-preview-straight-rgba.ts',
			'src/common/editor/imaging/pixel-frame-geometry-v1.ts']) assert.ok(Object.hasOwn(bundle.metafile.inputs, source), source);
		assert.deepEqual(Object.keys(bundle.metafile.inputs).filter(path => path.startsWith('tests/helpers/')), [HELPER]);
		for (const path of ['src/common/editor/video-post-crop-vignette-v1.ts','src/common/editor/imaging/pixel-frame-post-crop-vignette-v1.ts',
			'src/common/editor/ui/video-preview-post-crop-vignette-v1.ts']) assert.ok(Object.hasOwn(bundle.metafile.inputs,path),path);
		for (const output of Object.values(bundle.metafile.outputs)) assert.deepEqual(output.imports, []);
	}
});
