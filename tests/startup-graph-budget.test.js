/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	PRODUCT_BOOTSTRAPS,
	STARTUP_GRAPH_BUDGETS,
	STARTUP_GRAPH_BUDGET_REASONS,
	STARTUP_GRAPH_REPORT_FILE,
	assertFramescaperBootstrapChunkIsAcyclic,
	assertFramescaperProjectCommandChunkIsAcyclic,
	assertProductGraphOwnership,
	assertProductionStartupGraphs,
	assertTransferArchiveRuntimeDoesNotReachProductBootstrap,
	collectStartupGraph,
	enforceStartupGraphBudgets,
	formatStartupGraphReport,
	startupGraphReport,
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
		() => assertProductionStartupGraphs(bundle, 'soundscaper'),
		/static entry.*editor-shell|static entry.*src\/common\/editor/iu,
	);
});

test('production startup budgets reject either product tree in the static entry graph', () => {
	for (const product of ['soundscaper', 'framescaper']) {
		const bundle = fixtureBundle();
		bundle['assets/shared.js'].modules[`/workspace/src/${product}/startup-helper.ts`] = {};
		assert.throws(
			() => assertProductionStartupGraphs(bundle, 'soundscaper'),
			new RegExp(`static entry.*src/${product}/`, 'iu'),
		);
	}
});

test('each product-ready graph excludes the other product tree', () => {
	assert.doesNotThrow(() => assertProductGraphOwnership('soundscaper', {
		moduleIds: new Set(['/workspace/src/soundscaper/bootstrap.ts', '/workspace/src/common/editor/app.js']),
	}));
	assert.throws(
		() => assertProductGraphOwnership('soundscaper', {
			moduleIds: new Set(['/workspace/src/framescaper/editor-project-assistance.ts']),
		}),
		/soundscaper.*forbidden framescaper product module/iu,
	);
	assert.throws(
		() => assertProductGraphOwnership('framescaper', {
			moduleIds: new Set(['/workspace/src/soundscaper/product.js']),
		}),
		/framescaper.*forbidden soundscaper product module/iu,
	);
});

test('the emitted Framescaper project-command chunk cannot reciprocally import a feature chunk', () => {
	const bundle = fixtureBundle();
	bundle['assets/framescaper-project-commands.js'] = chunk({
		fileName: 'assets/framescaper-project-commands.js',
		imports: ['assets/framescaper-timeline-images.js'],
		modules: {
			'/workspace/src/framescaper/editor-project-assistance-commands.ts': {},
			'/workspace/src/framescaper/editor-project-native-media-commands.ts': {},
		},
	});
	bundle['assets/framescaper-timeline-images.js'] = chunk({
		fileName: 'assets/framescaper-timeline-images.js',
		imports: ['assets/framescaper-project-commands.js'],
		modules: {
			'/workspace/src/framescaper/editor-project-timeline-image-commands.ts': {},
			'/workspace/src/framescaper/editor-project-timeline-image-transition-allocation.ts': {},
		},
	});
	assert.throws(
		() => assertFramescaperProjectCommandChunkIsAcyclic(bundle),
		/Framescaper project-command chunk.*reciprocally imports.*framescaper-timeline-images/iu,
	);

	bundle['assets/framescaper-project-commands.js'].imports = [];
	assert.doesNotThrow(() => assertFramescaperProjectCommandChunkIsAcyclic(bundle));
});

test('the emitted Framescaper bootstrap cannot reciprocally import its timeline-image chunk', () => {
	const bundle = fixtureBundle();
	bundle['assets/framescaper-bootstrap.js'] = chunk({
		fileName: 'assets/framescaper-bootstrap.js',
		imports: ['assets/framescaper-timeline-images.js'],
		modules: {
			'/workspace/src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx': {},
			'/workspace/src/framescaper/editor-project-assistance-runtime.ts': {},
		},
	});
	bundle['assets/framescaper-timeline-images.js'] = chunk({
		fileName: 'assets/framescaper-timeline-images.js',
		imports: ['assets/framescaper-bootstrap.js'],
		modules: {
			'/workspace/src/framescaper/editor-project-timeline-image-runtime.ts': {},
		},
	});
	assert.throws(
		() => assertFramescaperBootstrapChunkIsAcyclic(bundle),
		/Framescaper bootstrap chunk.*reciprocally imports.*framescaper-timeline-images/iu,
	);

	bundle['assets/framescaper-timeline-images.js'].imports = [];
	assert.doesNotThrow(() => assertFramescaperBootstrapChunkIsAcyclic(bundle));
});

test('the emitted transfer archive runtime cannot statically reach a product bootstrap', () => {
	for (const product of ['soundscaper', 'framescaper']) {
		const bundle = fixtureBundle();
		const bootstrap = addProductBootstrap(bundle, product);
		bundle['assets/transfer-archive-runtime.js'] = chunk({
			fileName: 'assets/transfer-archive-runtime.js',
			imports: ['assets/project-domain.js'],
			modules: { '/workspace/src/common/transfer/transfer-archive-runtime.ts': {} },
		});
		bundle['assets/project-domain.js'] = chunk({
			fileName: 'assets/project-domain.js',
			imports: [bootstrap.fileName],
			modules: { '/workspace/src/common/editor/project-v17-validation.ts': {} },
		});
		assert.throws(
			() => assertTransferArchiveRuntimeDoesNotReachProductBootstrap(bundle),
			new RegExp(`transfer archive runtime.*${product} bootstrap.*project-domain`, 'iu'),
		);
		bundle['assets/project-domain.js'].imports = [];
		assert.doesNotThrow(() => assertTransferArchiveRuntimeDoesNotReachProductBootstrap(bundle));
	}
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
		requests: 84,
		rawBytes: 7_000_000,
		brotliBytes: 1_650_000,
	});
});

test('the ceilings are read from the maintained budget configuration with their reasons', () => {
	const configuration = JSON.parse(readFileSync(
		new URL('../config/startup-graph-budgets.json', import.meta.url),
		'utf8',
	));
	assert.deepEqual(Object.keys(configuration).sort(), ['framescaper', 'initial', 'soundscaper']);
	for (const [graph, budget] of Object.entries(STARTUP_GRAPH_BUDGETS)) {
		assert.deepEqual(budget, configuration[graph].ceilings, graph);
	}
	assert.match(configuration.framescaper.reasons.rawBytes, /Raised from 6_700_000 by the project owner\./u);
	assert.match(configuration.framescaper.reasons.brotliBytes, /raised from 1_600_000 for the same reason/u);
	assert.match(configuration.framescaper.reasons.requests, /Requests raised from 80 by the same reasoning\./u);
	assert.deepEqual(STARTUP_GRAPH_BUDGET_REASONS.framescaper, configuration.framescaper.reasons);
});

test('every build reports the observed graph sizes rather than only breaking on them', () => {
	const bundle = fixtureBundle();
	addProductBootstrap(bundle, 'soundscaper');
	const report = startupGraphReport('soundscaper', assertProductionStartupGraphs(bundle, 'soundscaper'));
	assert.equal(report.product, 'soundscaper');
	assert.deepEqual(Object.keys(report.graphs).sort(), ['initial', 'soundscaper']);
	for (const observation of Object.values(report.graphs)) {
		assert.deepEqual(Object.keys(observation).sort(), ['brotliBytes', 'rawBytes', 'requests']);
		assert.ok(observation.requests > 0);
		assert.ok(observation.rawBytes > 0);
		assert.ok(observation.brotliBytes > 0);
	}
	const lines = formatStartupGraphReport(report);
	assert.equal(lines.length, 2);
	assert.match(lines.join('\n'), /startup graph initial: requests \d+\/10, rawBytes [\d,]+\/350,000/u);
	assert.match(lines.join('\n'), /soundscaper: requests \d+\/75, rawBytes [\d,]+\/6,200,000 \([\d.]+% slack\)/u);
});

test('a build logs its observed graphs and writes them next to the bundle', async (context) => {
	const logged = [];
	context.mock.method(console, 'log', (line) => logged.push(String(line)));
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-startup-graph-'));
	context.after(() => rm(directory, { recursive: true, force: true }));

	const plugin = enforceStartupGraphBudgets('framescaper');
	const bundle = fixtureBundle();
	addProductBootstrap(bundle, 'framescaper');
	plugin.generateBundle.handler({}, bundle);
	assert.equal(logged.length, 2);
	assert.ok(logged.some((line) => line.includes('framescaper: requests')), logged.join('\n'));

	plugin.writeBundle({ dir: directory });
	const written = JSON.parse(readFileSync(join(directory, STARTUP_GRAPH_REPORT_FILE), 'utf8'));
	assert.equal(written.product, 'framescaper');
	assert.deepEqual(Object.keys(written.graphs).sort(), ['framescaper', 'initial']);
	assert.equal(written.graphs.framescaper.requests, 5);
});

test('production startup budgets inspect Vite final import-analysis output', () => {
	const plugin = enforceStartupGraphBudgets('soundscaper');
	assert.equal(plugin.generateBundle.order, 'post');
	assert.equal(typeof plugin.generateBundle.handler, 'function');
});

test('the product being built is admitted strictly, never defaulted', () => {
	for (const product of [undefined, null, '', 'lightscaper', 'Soundscaper']) {
		assert.throws(
			() => assertProductionStartupGraphs(fixtureBundle(), product),
			/product being built/iu,
			String(product),
		);
	}
});

test('a build asserts its own product budget rather than silently asserting none', () => {
	for (const product of ['soundscaper', 'framescaper']) {
		const bundle = fixtureBundle();
		addProductBootstrap(bundle, product);
		const graphs = assertProductionStartupGraphs(bundle, product);
		assert.ok(graphs[product], `${product} build returned no ${product} product-ready graph`);
		assert.ok(graphs[product].requests > 0);
	}
});

test('a build whose own bootstrap is absent fails instead of asserting nothing', () => {
	// The wrong fix for a per-product bundle is to skip a product that is not in
	// it: a build would then pass while enforcing no product budget at all.
	assert.throws(
		() => assertProductionStartupGraphs(fixtureBundle(), 'framescaper'),
		/no framescaper product-ready budget/iu,
	);
	const otherProductOnly = fixtureBundle();
	addProductBootstrap(otherProductOnly, 'soundscaper');
	assert.throws(
		() => assertProductionStartupGraphs(otherProductOnly, 'framescaper'),
		/framescaper build emitted the soundscaper bootstrap/iu,
	);
});

test('a production build refuses to emit the other product bootstrap', () => {
	for (const product of ['soundscaper', 'framescaper']) {
		const otherProduct = product === 'soundscaper' ? 'framescaper' : 'soundscaper';
		const bundle = fixtureBundle();
		addProductBootstrap(bundle, product);
		addProductBootstrap(bundle, otherProduct);
		assert.throws(
			() => assertProductionStartupGraphs(bundle, product),
			new RegExp(`${product} build emitted the ${otherProduct} bootstrap`, 'iu'),
		);
	}
});

test('the enforcement plugin carries the built product into the assertion', () => {
	const plugin = enforceStartupGraphBudgets('framescaper');
	assert.throws(
		() => plugin.generateBundle.handler({}, fixtureBundle()),
		/no framescaper product-ready budget/iu,
	);
	const bundle = fixtureBundle();
	addProductBootstrap(bundle, 'framescaper');
	assert.doesNotThrow(() => plugin.generateBundle.handler({}, bundle));
});

function addProductBootstrap(bundle, product) {
	const fileName = `assets/${product}-bootstrap.js`;
	bundle[fileName] = chunk({
		fileName,
		code: `${product}-bootstrap-code`,
		facadeModuleId: `/workspace${PRODUCT_BOOTSTRAPS[product]}`,
		modules: { [`/workspace${PRODUCT_BOOTSTRAPS[product]}`]: {} },
	});
	return bundle[fileName];
}

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
