/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	STARTUP_GRAPH_BUDGETS,
	assertProductionStartupGraphs,
	collectStartupGraph,
} from '../scripts/lib/startup-graph-budget.mjs';

test('startup graph collection follows static imports and deduplicates CSS', () => {
	const bundle = fixtureBundle();
	const graph = collectStartupGraph(bundle, ['assets/index.js']);
	assert.deepEqual([...graph.javascript].sort(), ['assets/index.js', 'assets/shared.js']);
	assert.deepEqual([...graph.css].sort(), ['assets/application.css', 'assets/shared.css']);
	assert.equal(graph.requests, 4);
	assert.equal(graph.modulepreloads, 1);
	assert.equal(graph.rawBytes, 46);
	assert.ok(graph.brotliBytes > 0);
	assert.deepEqual([...graph.moduleIds].sort(), ['/workspace/src/common/site/App.jsx', '/workspace/src/main.jsx']);
});

test('production startup budgets reject editor ownership in the static entry graph', () => {
	const bundle = fixtureBundle();
	bundle['assets/index.js'].imports.push('assets/editor-shell.js');
	bundle['assets/editor-shell.js'] = chunk({
		fileName: 'assets/editor-shell.js',
		code: 'editor',
		modules: { '/workspace/src/common/editor/ui/AudioEditorApp.jsx': {} },
	});
	assert.throws(
		() => assertProductionStartupGraphs(bundle),
		/static entry.*editor-shell|static entry.*src\/common\/editor/iu,
	);
});

test('approved graph ceilings remain hard limits', () => {
	assert.deepEqual(STARTUP_GRAPH_BUDGETS.initial, {
		requests: 10,
		modulepreloads: 6,
		cssFiles: 2,
		rawBytes: 350_000,
		brotliBytes: 100_000,
	});
	assert.deepEqual(STARTUP_GRAPH_BUDGETS.soundscaper, {
		requests: 75,
		rawBytes: 6_200_000,
		brotliBytes: 1_500_000,
	});
	assert.deepEqual(STARTUP_GRAPH_BUDGETS.framescaper, {
		requests: 80,
		rawBytes: 6_700_000,
		brotliBytes: 1_600_000,
	});
});

function fixtureBundle() {
	return {
		'assets/index.js': chunk({
			fileName: 'assets/index.js',
			code: 'entry-code',
			isEntry: true,
			facadeModuleId: '/workspace/src/main.jsx',
			imports: ['assets/shared.js'],
			modules: { '/workspace/src/main.jsx': {} },
			css: ['assets/application.css'],
		}),
		'assets/shared.js': chunk({
			fileName: 'assets/shared.js',
			code: 'shared-code',
			modules: { '/workspace/src/common/site/App.jsx': {} },
			css: ['assets/application.css', 'assets/shared.css'],
		}),
		'assets/application.css': asset('assets/application.css', 'application-css'),
		'assets/shared.css': asset('assets/shared.css', 'shared-css'),
	};
}

function chunk({
	fileName,
	code,
	isEntry = false,
	facadeModuleId = null,
	imports = [],
	modules = {},
	css = [],
}) {
	return {
		type: 'chunk',
		fileName,
		code,
		isEntry,
		facadeModuleId,
		imports,
		dynamicImports: [],
		modules,
		viteMetadata: { importedCss: new Set(css), importedAssets: new Set() },
	};
}

function asset(fileName, source) {
	return { type: 'asset', fileName, source };
}
