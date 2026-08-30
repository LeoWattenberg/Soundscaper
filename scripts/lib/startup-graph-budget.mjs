/* SPDX-License-Identifier: AGPL-3.0-only */

import { brotliCompressSync } from 'node:zlib';

export const STARTUP_GRAPH_BUDGETS = Object.freeze({
	initial: Object.freeze({
		requests: 10,
		modulepreloads: 6,
		cssFiles: 2,
		rawBytes: 350_000,
		brotliBytes: 100_000,
	}),
	soundscaper: Object.freeze({
		requests: 75,
		rawBytes: 6_200_000,
		brotliBytes: 1_500_000,
	}),
	framescaper: Object.freeze({
		requests: 80,
		rawBytes: 6_700_000,
		brotliBytes: 1_600_000,
	}),
});

export const PRODUCT_BOOTSTRAPS = Object.freeze({
	soundscaper: '/src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx',
	framescaper: '/src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx',
});

export const BUDGETED_PRODUCT_IDS = Object.freeze(Object.keys(PRODUCT_BOOTSTRAPS));

/**
 * The product a bundle was built for, admitted strictly.
 *
 * There is no default: a caller that cannot name its product cannot be told
 * which budget the build owes, and the failure mode of guessing is a build that
 * enforces nothing.
 *
 * @param {unknown} product
 * @returns {keyof typeof PRODUCT_BOOTSTRAPS}
 */
export function normalizeBudgetedProduct(product) {
	if (typeof product !== 'string' || !Object.hasOwn(PRODUCT_BOOTSTRAPS, product)) {
		throw new RangeError(
			'Startup graph budgets need the product being built '
			+ `(${BUDGETED_PRODUCT_IDS.join(', ')}); received ${JSON.stringify(product) ?? String(product)}.`,
		);
	}
	return product;
}

/**
 * @param {Record<string, import('rollup').OutputAsset | import('rollup').OutputChunk>} bundle
 * @param {string} product the product this bundle was built for
 */
export function assertProductionStartupGraphs(bundle, product) {
	const builtProduct = normalizeBudgetedProduct(product);
	assertOnlyBuiltProductBootstrapEmitted(bundle, builtProduct);
	assertFramescaperBootstrapChunkIsAcyclic(bundle);
	assertFramescaperProjectCommandChunkIsAcyclic(bundle);
	assertTransferArchiveRuntimeDoesNotReachProductBootstrap(bundle);
	const entry = Object.values(bundle).find((output) => output.type === 'chunk'
		&& output.isEntry
		&& (
			chunkOwnsModule(output, '/src/main.jsx')
			|| normalizedModuleId(output.facadeModuleId).endsWith('/index.html')
		));
	if (!entry) {
		const candidates = Object.values(bundle)
			.filter((output) => output.type === 'chunk' && output.isEntry)
			.map((output) => ({
				fileName: output.fileName,
				facadeModuleId: output.facadeModuleId,
				modules: Object.keys(output.modules),
			}));
		throw new Error(`Startup graph budget could not find the src/main.jsx entry chunk: ${JSON.stringify(candidates)}.`);
	}

	const initial = collectStartupGraph(bundle, [entry.fileName]);
	assertBudget('static entry', initial, STARTUP_GRAPH_BUDGETS.initial);
	assertStaticEntryOwnership(initial);

	// A per-product build only carries its own bootstrap, so a product that is not
	// in the bundle cannot be asserted. Skipping is only safe with the closing
	// check below: without it the obvious "if absent, continue" turns a build that
	// emits no bootstrap at all into a build that enforces no product budget at all.
	const graphs = { initial };
	for (const [candidate, bootstrapPath] of Object.entries(PRODUCT_BOOTSTRAPS)) {
		const bootstrap = Object.values(bundle).find((output) => output.type === 'chunk'
			&& chunkOwnsModule(output, bootstrapPath));
		if (!bootstrap) continue;
		const graph = collectStartupGraph(bundle, [entry.fileName, bootstrap.fileName]);
		assertBudget(`${candidate} product-ready`, graph, STARTUP_GRAPH_BUDGETS[candidate]);
		assertProductGraphOwnership(candidate, graph);
		graphs[candidate] = graph;
	}
	if (!graphs[builtProduct]) {
		throw new Error(
			`Startup graph budget asserted no ${builtProduct} product-ready budget: this build's own bootstrap `
			+ `${PRODUCT_BOOTSTRAPS[builtProduct]} is not in the bundle.`,
		);
	}
	return Object.freeze(graphs);
}

/**
 * One deployed origin owns one editor bootstrap. A dormant peer bootstrap is
 * still shipped code and can be revived by a future runtime selector, so this
 * assertion examines the complete final bundle rather than only the selected
 * product's reachable startup graph.
 *
 * @param {Record<string, import('rollup').OutputAsset | import('rollup').OutputChunk>} bundle
 * @param {keyof typeof PRODUCT_BOOTSTRAPS} builtProduct
 */
function assertOnlyBuiltProductBootstrapEmitted(bundle, builtProduct) {
	const otherProduct = builtProduct === 'framescaper' ? 'soundscaper' : 'framescaper';
	const otherBootstrap = Object.values(bundle).find((output) => output.type === 'chunk'
		&& chunkOwnsModule(output, PRODUCT_BOOTSTRAPS[otherProduct]));
	if (otherBootstrap) {
		throw new Error(
			`${builtProduct} build emitted the ${otherProduct} bootstrap ${otherBootstrap.fileName}; `
			+ 'select the editor bootstrap from the compile-time product only.',
		);
	}
}

/**
 * The selected bootstrap may import the timeline-image feature chunk, but that
 * feature chunk must never import the bootstrap back. Cross-product transfer
 * loads the peer bootstrap from a different dynamic entry order than the editor
 * page and makes an otherwise latent uninitialized binding observable.
 *
 * @param {Record<string, import('rollup').OutputAsset | import('rollup').OutputChunk>} bundle
 */
export function assertFramescaperBootstrapChunkIsAcyclic(bundle) {
	const bootstrap = Object.values(bundle).find((output) => output.type === 'chunk'
		&& chunkOwnsModule(output, PRODUCT_BOOTSTRAPS.framescaper));
	if (!bootstrap) return;
	for (const importedName of bootstrap.imports) {
		const imported = bundle[importedName];
		if (imported?.type !== 'chunk' || !imported.imports.includes(bootstrap.fileName)) continue;
		throw new Error(
			`Framescaper bootstrap chunk ${bootstrap.fileName} reciprocally imports ${imported.fileName}; `
			+ 'give the shared feature boundary one dependency-closed semantic owner.',
		);
	}
}

/**
 * Reject a generated import cycle around the Framescaper command authority.
 *
 * Source imports are layered, but a command module placed by reachability can
 * share a chunk with a lower layer. A feature chunk that imports that lower
 * layer then imports the command chunk, while the upper command imports the
 * feature chunk back. The binding failure exists only after code splitting, so
 * this assertion deliberately reads the final emitted chunk graph.
 *
 * @param {Record<string, import('rollup').OutputAsset | import('rollup').OutputChunk>} bundle
 */
export function assertFramescaperProjectCommandChunkIsAcyclic(bundle) {
	const commandChunk = Object.values(bundle).find((output) => output.type === 'chunk'
		&& chunkOwnsModule(output, '/src/framescaper/editor-project-assistance-commands.ts'));
	if (!commandChunk) return;
	for (const importedName of commandChunk.imports) {
		const imported = bundle[importedName];
		if (imported?.type !== 'chunk' || !imported.imports.includes(commandChunk.fileName)) continue;
		throw new Error(
			`Framescaper project-command chunk ${commandChunk.fileName} reciprocally imports `
			+ `${imported.fileName}; keep the command inheritance in one non-recursive semantic owner.`,
		);
	}
}

/**
 * Keep the standalone transfer archive runtime outside either editor UI graph.
 *
 * Product-selected aliases and reachability placement can create multi-chunk
 * cycles that no reciprocal-edge check sees. Transfer pages initialize archive
 * authority before an editor bootstrap, so reaching one statically exposes an
 * uninitialized binding even when the normal editor entry happens to work.
 *
 * @param {Record<string, import('rollup').OutputAsset | import('rollup').OutputChunk>} bundle
 */
export function assertTransferArchiveRuntimeDoesNotReachProductBootstrap(bundle) {
	const transfer = Object.values(bundle).find((output) => output.type === 'chunk'
		&& chunkOwnsModule(output, '/src/common/transfer/transfer-archive-runtime.ts'));
	if (!transfer) return;
	const bootstrapProducts = new Map();
	for (const [product, moduleId] of Object.entries(PRODUCT_BOOTSTRAPS)) {
		const bootstrap = Object.values(bundle).find((output) => output.type === 'chunk'
			&& chunkOwnsModule(output, moduleId));
		if (bootstrap) bootstrapProducts.set(bootstrap.fileName, product);
	}
	const pending = [{ fileName: transfer.fileName, path: [transfer.fileName] }];
	const seen = new Set();
	while (pending.length) {
		const { fileName, path } = pending.pop();
		if (seen.has(fileName)) continue;
		seen.add(fileName);
		const product = bootstrapProducts.get(fileName);
		if (product) {
			throw new Error(
				`Transfer archive runtime statically reaches the ${product} bootstrap through `
				+ path.join(' -> ') + '.',
			);
		}
		const output = bundle[fileName];
		if (output?.type !== 'chunk') continue;
		for (const imported of output.imports) {
			pending.push({ fileName: imported, path: [...path, imported] });
		}
	}
}

export function assertProductGraphOwnership(product, graph) {
	const otherProduct = product === 'framescaper' ? 'soundscaper' : 'framescaper';
	const forbiddenModule = [...graph.moduleIds].find((moduleId) => (
		moduleId.includes(`/src/${otherProduct}/`)
	));
	if (forbiddenModule) {
		throw new Error(`${product} product-ready graph owns forbidden ${otherProduct} product module ${forbiddenModule}.`);
	}
}

/**
 * @param {Record<string, import('rollup').OutputAsset | import('rollup').OutputChunk>} bundle
 * @param {readonly string[]} roots
 */
export function collectStartupGraph(bundle, roots) {
	const javascript = new Set();
	const css = new Set();
	const moduleIds = new Set();
	const pending = [...roots];
	while (pending.length) {
		const fileName = pending.pop();
		if (javascript.has(fileName)) continue;
		const output = bundle[fileName];
		if (!output || output.type !== 'chunk') {
			throw new Error(`Startup graph references a missing JavaScript chunk: ${fileName}.`);
		}
		javascript.add(fileName);
		for (const imported of output.imports) pending.push(imported);
		for (const moduleId of Object.keys(output.modules)) moduleIds.add(normalizedModuleId(moduleId));
		for (const stylesheet of output.viteMetadata?.importedCss || []) css.add(stylesheet);
	}

	let rawBytes = 0;
	let brotliBytes = 0;
	for (const fileName of [...javascript, ...css]) {
		const bytes = outputBytes(bundle[fileName], fileName);
		rawBytes += bytes.byteLength;
		brotliBytes += brotliCompressSync(bytes).byteLength;
	}
	return Object.freeze({
		javascript,
		css,
		moduleIds,
		requests: javascript.size + css.size,
		modulepreloads: Math.max(0, javascript.size - roots.filter((root) => javascript.has(root)).length),
		cssFiles: css.size,
		rawBytes,
		brotliBytes,
	});
}

function assertBudget(label, graph, budget) {
	const violations = [];
	for (const [metric, ceiling] of Object.entries(budget)) {
		if (graph[metric] > ceiling) violations.push(`${metric} ${graph[metric]} > ${ceiling}`);
	}
	if (violations.length) throw new Error(`${label} startup graph exceeds its budget: ${violations.join(', ')}.`);
}

function assertStaticEntryOwnership(graph) {
	const forbiddenFile = [...graph.javascript, ...graph.css]
		.find((fileName) => /(?:^|\/)(?:editor-|vendor-design-system)/u.test(fileName));
	if (forbiddenFile) throw new Error(`static entry startup graph owns forbidden editor asset ${forbiddenFile}.`);
	const forbiddenModule = [...graph.moduleIds].find((moduleId) => (
		moduleId.includes('/src/common/editor/')
		|| moduleId.includes('/src/soundscaper/')
		|| moduleId.includes('/src/framescaper/')
	));
	if (forbiddenModule) throw new Error(`static entry startup graph owns forbidden editor module ${forbiddenModule}.`);
}

function outputBytes(output, fileName) {
	if (!output) throw new Error(`Startup graph references a missing output asset: ${fileName}.`);
	if (output.type === 'chunk') return Buffer.from(output.code);
	if (typeof output.source === 'string') return Buffer.from(output.source);
	return Buffer.from(output.source.buffer, output.source.byteOffset, output.source.byteLength);
}

function normalizedModuleId(moduleId) {
	return typeof moduleId === 'string' ? moduleId.replaceAll('\\', '/') : '';
}

function chunkOwnsModule(chunk, suffix) {
	return normalizedModuleId(chunk.facadeModuleId).endsWith(suffix)
		|| Object.keys(chunk.modules).some((moduleId) => normalizedModuleId(moduleId).endsWith(suffix));
}

/**
 * @param {string} product the product this build emits
 * @returns {import('vite').Plugin}
 */
export function enforceStartupGraphBudgets(product) {
	const builtProduct = normalizeBudgetedProduct(product);
	return {
		name: 'kw-enforce-startup-graph-budgets',
		apply: 'build',
		generateBundle: {
			order: 'post',
			handler(_options, bundle) {
				assertProductionStartupGraphs(bundle, builtProduct);
			},
		},
	};
}
