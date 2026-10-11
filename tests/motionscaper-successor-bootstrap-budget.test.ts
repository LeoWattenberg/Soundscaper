/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { OutputBundle, OutputChunk } from 'rollup';
import { PRODUCT_BOOTSTRAPS, assertProductionStartupGraphs, assertTransferArchiveRuntimeDoesNotReachProductBootstrap } from '../scripts/lib/startup-graph-budget.mjs';
const successor = '/src/common/editor/ui/FramescaperSuccessorBootstrap.tsx';
function chunk(name: string, module: string, imports: string[] = []): OutputChunk {
	return { type: 'chunk', fileName: name, name, code: 'export{}', modules: { [module]: {} }, imports, dynamicImports: [], isEntry: name === 'entry.js', facadeModuleId: module, exports: [], importedBindings: {}, referencedFiles: [], implicitlyLoadedBefore: [], isDynamicEntry: false, map: null, sourcemapFileName: null, preliminaryFileName: name, moduleIds: [module] } as OutputChunk;
}
function bundle(path = successor): OutputBundle { return { 'entry.js': chunk('entry.js', '/repo/src/main.jsx'), 'bootstrap.js': chunk('bootstrap.js', path) }; }
test('Motionscaper links use the explicitly selected successor bootstrap with the unchanged Framescaper budget', () => {
	const value = bundle();
	assert.ok(assertProductionStartupGraphs(value, 'framescaper', { framescaperLine: 'successor' }).framescaper);
	assert.throws(() => assertProductionStartupGraphs(value, 'framescaper'), /bootstrap|successor/u);
	assert.throws(() => assertProductionStartupGraphs(bundle(PRODUCT_BOOTSTRAPS.framescaper), 'framescaper', { framescaperLine: 'successor' }), /bootstrap/u);
	assert.throws(() => assertProductionStartupGraphs(value, 'motionscaper', { framescaperLine: 'successor' }), /Framescaper|framescaper/u);
	value['baseline.js'] = chunk('baseline.js', PRODUCT_BOOTSTRAPS.framescaper);
	assert.throws(() => assertProductionStartupGraphs(value, 'framescaper', { framescaperLine: 'successor' }), /bootstrap/u);
});
test('successor bootstrap remains outside transfer archives and rejects static cycles', () => {
	const value = bundle(); value['bootstrap.js'] = chunk('bootstrap.js', successor, ['feature.js']); value['feature.js'] = chunk('feature.js', '/repo/src/common/feature.ts', ['bootstrap.js']);
	assert.throws(() => assertProductionStartupGraphs(value, 'framescaper', { framescaperLine: 'successor' }), /static import cycle/u);
	value['transfer.js'] = chunk('transfer.js', '/repo/src/common/transfer/transfer-archive-runtime.ts', ['bootstrap.js']);
	assert.throws(() => assertTransferArchiveRuntimeDoesNotReachProductBootstrap(value), /bootstrap/u);
});

test('successor composition roots have explicit chunk ownership outside their bootstrap facade', async () => {
	const { chunkGroupForModulePath } = await import('../scripts/lib/build-chunk-groups.mjs');
	assert.equal(chunkGroupForModulePath('/repo/src/common/editor/ui/FramescaperSuccessorBootstrap.tsx'), 'framescaper-successor-bootstrap');
	assert.equal(chunkGroupForModulePath('/repo/src/framescaper/editor-successor-controller.ts'), 'framescaper-successor-runtime');
});

test('successor offline activation targets the explicit successor bootstrap', async () => {
	const { offlineProductBootstrapEntry } = await import('../scripts/lib/offline-application-shell.mjs');
	assert.equal(offlineProductBootstrapEntry('framescaper', { SCAPE_FRAMESCAPER_LINE: 'successor' }), successor.slice(1));
	assert.equal(offlineProductBootstrapEntry('framescaper'), PRODUCT_BOOTSTRAPS.framescaper.slice(1));
	assert.throws(() => offlineProductBootstrapEntry('motionscaper', { SCAPE_FRAMESCAPER_LINE: 'successor' }), /Framescaper|framescaper/u);
});
