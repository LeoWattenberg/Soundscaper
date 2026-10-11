/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'vite';
import { isTransferRoutePath, TRANSFER_ROUTE_PATHS } from '../src/common/transfer/transfer-route-path.ts';
import { transferRouteForPath } from '../src/common/transfer/transfer-routes.js';

test('successor startup keeps the exact transfer route admission without loading transfer-document copy', async () => {
	for (const path of Object.values(TRANSFER_ROUTE_PATHS)) for (const candidate of [path, path.slice(0, -1)]) { assert.equal(isTransferRoutePath(candidate), true); assert.equal(transferRouteForPath(candidate)?.path, path); }
	for (const path of [null, undefined, 42, '', '/', '/transfer/', '/transfer/send/more', '/transfer//send/', '/transfer/send?token=x', '/Transfer/send/', '/composition-link/send/']) assert.equal(isTransferRoutePath(path), false);
	const output = await build({ configFile: false, publicDir: false, logLevel: 'silent', build: { write: false, minify: false, lib: { entry: 'src/common/transfer/transfer-route-path.ts', formats: ['es'] }, rolldownOptions: { output: { codeSplitting: false } } } });
	assert.ok(!('on' in output)); const bundles = Array.isArray(output) ? output : [output]; const code = bundles.flatMap((bundle) => bundle.output).filter((chunk) => chunk.type === 'chunk').map((chunk) => chunk.code).join('\n');
	assert.doesNotMatch(code, /Export every project|Receive projects|renderTransferDocument/u); assert.ok(code.length < 1000);
});

test('successor startup copy and archive filename helpers retain focused chunk owners', async () => {
	const { motionChunkGroups } = await import('../scripts/lib/build-motion-chunks.mjs');
	const { PROJECT_INTERCHANGE_FOUNDATION_CHUNK_TEST } = await import('../scripts/lib/build-chunk-tests.mjs');
	const owner = (path: string) => motionChunkGroups.filter((group) => group.test.test(path)).sort((a, b) => b.priority - a.priority)[0]?.name;
	assert.equal(owner('/repo/src/common/i18n/editor-motion-link-bridge-copy.ts'), 'motion-link-copy');
	assert.equal(owner('/repo/src/common/editor/ui/composition-link/bridge-page-entry.tsx'), 'motion-link-page');
	assert.equal(owner('/repo/src/common/editor/motion-link-wire.ts'), 'motion-link-bridge');
	assert.equal(PROJECT_INTERCHANGE_FOUNDATION_CHUNK_TEST.test('/repo/src/common/project-file-extensions.ts'), true);
});
