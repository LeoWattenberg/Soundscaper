/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

const require = createRequire(import.meta.url);
const dialog = fileURLToPath(new URL('../src/common/editor/ui/dialogs/VampAnalyzerDialog.tsx', import.meta.url));
const hook = fileURLToPath(new URL('../src/common/editor/ui/dialogs/useAnalyzerLookup.ts', import.meta.url));
const externalModules: Readonly<Record<string, string>> = {
	'@soundscaper/design-system/Footer': 'export function DialogFooter() {}',
	'../../vamp-analysis.ts': 'export function normalizeVampAnalysisRequest() {} export function normalizeVampAnalysisResult() {} export function normalizeVampAnalyzerCatalog() {}',
	'../../vamp-analysis-labels.ts': 'export const MAXIMUM_VAMP_LABELS = 10000;',
	'../AudioEditorDialogShell.tsx': 'export default function DialogShell() {}',
};

test('the actual Vamp dialog and lookup hook cold-import without an owner-entry initializer cycle', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-round4-vamp-chunk-'));
	try {
		// Keep the real dialog/hook source and production owner rules. External
		// rendering/native dependencies are never invoked by this cold import.
		const bundle = await rolldown({
			input: dialog,
			preserveEntrySignatures: 'allow-extension',
			plugins: [{
				name: 'bounded-vamp-dialog-graph',
				resolveId(source) {
					if (source === 'react' || source === 'react/jsx-runtime') {
						return { id: pathToFileURL(require.resolve(source)).href, external: true };
					}
					const code = externalModules[source];
					if (code !== undefined) return { id: 'data:text/javascript;base64,' + Buffer.from(code).toString('base64'), external: true };
					return null;
				},
			}],
		});
		try {
			const result = await bundle.write({
				dir: directory, format: 'es', minify: true,
				entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs',
				codeSplitting: { groups: chunkGroups, minSize: 20_000 },
				strictExecutionOrder: true,
			});
			const chunks = result.output.filter(chunk => chunk.type === 'chunk');
			const owner = chunks.find(chunk => Object.hasOwn(chunk.modules, dialog));
			assert.ok(owner);
			const entry = chunks.find(chunk => chunk.isEntry);
			assert.ok(entry);
			const loaded: unknown = await import(pathToFileURL(join(directory, entry.fileName)).href);
			assert.ok(loaded && typeof loaded === 'object' && 'default' in loaded);
			assert.equal(typeof loaded.default, 'function');
			assert.ok(Object.hasOwn(owner.modules, hook), 'the lookup hook belongs with its actual lazy dialog owner');
		} finally { await bundle.close(); }
	} finally { await rm(directory, { recursive: true, force: true }); }
});
