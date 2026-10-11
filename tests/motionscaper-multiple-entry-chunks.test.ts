/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { rolldown, type OutputChunk } from 'rolldown';
import { chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

test('Motion and successor main pages do not eagerly load the separate composition-link entry', async () => {
	const main = '/fixture/src/main.jsx';
	const bridge = '/fixture/src/common/editor/ui/composition-link/bridge-page-entry.tsx';
	const wire = '/fixture/src/common/editor/motion-link-wire.ts';
	const copy = '/fixture/src/common/i18n/editor-motion-link-bridge-copy.ts';
	const identity = '/fixture/src/common/product-identities.js';
	// Retained entry payloads exceed the real 20 KB group threshold. Both entries
	// share an initial dependency, but their private code must remain independent.
	const modules: Readonly<Record<string, string>> = {
		[main]: `import { product } from '${identity}'; globalThis.main = product + ${JSON.stringify('main '.repeat(5_000))};`,
		[bridge]: `import { product } from '${identity}'; import { wire } from '${wire}'; import { copy } from '${copy}'; globalThis.bridge = product + wire + copy + ${JSON.stringify('bridge '.repeat(5_000))};`,
		[wire]: 'export const wire = "composition-link-protocol";',
		[copy]: 'export const copy = "composition-link-instructions";',
		[identity]: 'export const product = "shared-product-identity";',
	};
	const bundle = await rolldown({
		input: { index: main, 'composition-link-bridge': bridge },
		preserveEntrySignatures: 'allow-extension',
		plugins: [{
			name: 'bounded-motion-multiple-entry-fixture',
			resolveId: id => Object.hasOwn(modules, id) ? id : null,
			load: id => modules[id] ?? null,
		}],
	});
	try {
		const result = await bundle.generate({
			format: 'es', minify: true, strictExecutionOrder: true,
			codeSplitting: { groups: chunkGroups, minSize: 20_000 },
		});
		const chunks = result.output.filter((chunk): chunk is OutputChunk => chunk.type === 'chunk');
		const reached = (entry: string): Set<string> => {
			const visited = new Set<string>();
			const modules = new Set<string>();
			const visit = (chunk: OutputChunk): void => {
				if (visited.has(chunk.fileName)) return;
				visited.add(chunk.fileName);
				for (const id of Object.keys(chunk.modules)) modules.add(id);
				for (const dependency of chunk.imports) {
					const imported = chunks.find(candidate => candidate.fileName === dependency);
					assert.ok(imported);
					visit(imported);
				}
			};
			const root = chunks.find(chunk => chunk.isEntry && chunk.facadeModuleId === entry);
			assert.ok(root);
			visit(root);
			return modules;
		};
		const mainModules = reached(main);
		const bridgeModules = reached(bridge);
		assert.ok(mainModules.has(identity));
		assert.ok(bridgeModules.has(identity));
		for (const [id, owner] of [[bridge, 'motion-link-page'], [wire, 'motion-link-bridge'], [copy, 'motion-link-copy']]) {
			assert.equal(mainModules.has(id), false, `${id} must not load from the main page`);
			assert.ok(bridgeModules.has(id));
			const chunk = chunks.find(candidate => Object.hasOwn(candidate.modules, id));
			assert.ok(chunk && (chunk.fileName.startsWith(owner) || (id === bridge && chunk.isEntry)), `${id} keeps its semantic owner or entry facade`);
		}
	} finally { await bundle.close(); }
});
