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

const PRODUCT_BOOTSTRAPS = Object.freeze({
	soundscaper: '/src/soundscaper/ui/SoundscaperAudioEditorBootstrapV30.tsx',
	framescaper: '/src/framescaper/ui/FramescaperAudioEditorBootstrapV31.tsx',
});

/** @param {Record<string, import('rollup').OutputAsset | import('rollup').OutputChunk>} bundle */
export function assertProductionStartupGraphs(bundle) {
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

	const graphs = { initial };
	for (const [product, bootstrapPath] of Object.entries(PRODUCT_BOOTSTRAPS)) {
		const bootstrap = Object.values(bundle).find((output) => output.type === 'chunk'
			&& chunkOwnsModule(output, bootstrapPath));
		if (!bootstrap) throw new Error(`Startup graph budget could not find ${product} bootstrap ${bootstrapPath}.`);
		const graph = collectStartupGraph(bundle, [entry.fileName, bootstrap.fileName]);
		assertBudget(`${product} product-ready`, graph, STARTUP_GRAPH_BUDGETS[product]);
		graphs[product] = graph;
	}
	return Object.freeze(graphs);
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

/** @returns {import('vite').Plugin} */
export function enforceStartupGraphBudgets() {
	return {
		name: 'kw-enforce-startup-graph-budgets',
		apply: 'build',
		generateBundle(_options, bundle) {
			assertProductionStartupGraphs(bundle);
		},
	};
}
