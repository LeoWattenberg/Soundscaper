/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPffftNodeModuleBrowserShim } from '../scripts/vite-pffft-browser-shim.mjs';

test('PFFFT browser shim resolves only the vendor Node module import', async () => {
	const plugin = createPffftNodeModuleBrowserShim();
	const importer = '/workspace/node_modules/@echogarden/pffft-wasm/dist/simd/pffft.js';
	const virtualId = plugin.resolveId('module', importer);

	assert.equal(typeof virtualId, 'string');
	assert.equal(plugin.enforce, 'pre');
	assert.equal(plugin.resolveId('module', '/workspace/src/common/editor/pffft.js'), null);
	assert.equal(plugin.resolveId('node:module', importer), null);
	assert.equal(plugin.resolveId('module', undefined), null);
	assert.equal(
		plugin.resolveId('module', 'C:\\workspace\\node_modules\\@echogarden\\pffft-wasm\\dist\\non-simd\\pffft.js'),
		virtualId,
	);

	const source = plugin.load(virtualId);
	assert.equal(typeof source, 'string');
	assert.equal(plugin.load('\0unrelated'), null);
	const shim = await import(`data:text/javascript,${encodeURIComponent(source)}`);
	assert.throws(
		() => shim.createRequire(),
		/Node-only createRequire path cannot run in a browser build/u,
	);
});
