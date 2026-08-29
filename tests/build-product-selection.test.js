/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PRODUCT_BOOTSTRAPS } from '../scripts/lib/startup-graph-budget.mjs';

test('an unset SCAPE_PRODUCT still builds Soundscaper', async () => {
	const config = await loadViteConfig(undefined, 'unset');
	assert.equal(config.define.__SCAPE_PRODUCT__, JSON.stringify('soundscaper'));
	const empty = await loadViteConfig('', 'empty');
	assert.equal(empty.define.__SCAPE_PRODUCT__, JSON.stringify('soundscaper'));
});

test('SCAPE_PRODUCT names the product the web build emits', async () => {
	const config = await loadViteConfig('framescaper', 'framescaper');
	assert.equal(config.define.__SCAPE_PRODUCT__, JSON.stringify('framescaper'));
});

test('an unrecognized SCAPE_PRODUCT fails the build instead of building Soundscaper', async () => {
	for (const [index, product] of ['lightscaper', 'Framescaper', 'framescaper ', 'true'].entries()) {
		await assert.rejects(
			() => loadViteConfig(product, `rejected-${index}`),
			/SCAPE_PRODUCT/u,
			product,
		);
	}
});

test('the built product reaches the startup-graph budget plugin', async () => {
	const framescaperBudgets = budgetPlugin(await loadViteConfig('framescaper', 'plugin-framescaper'));
	assert.doesNotThrow(
		() => framescaperBudgets.generateBundle.handler({}, bundleWithBootstrap('framescaper')),
	);

	const soundscaperBudgets = budgetPlugin(await loadViteConfig(undefined, 'plugin-soundscaper'));
	assert.throws(
		() => soundscaperBudgets.generateBundle.handler({}, bundleWithBootstrap('framescaper')),
		/soundscaper build emitted the framescaper bootstrap/iu,
	);
	assert.doesNotThrow(
		() => soundscaperBudgets.generateBundle.handler({}, bundleWithBootstrap('soundscaper')),
	);
});

async function loadViteConfig(product, cacheKey) {
	const previous = process.env.SCAPE_PRODUCT;
	if (product === undefined) delete process.env.SCAPE_PRODUCT;
	else process.env.SCAPE_PRODUCT = product;
	try {
		return (await import(`../vite.config.mjs?built=${cacheKey}`)).default;
	} finally {
		if (previous === undefined) delete process.env.SCAPE_PRODUCT;
		else process.env.SCAPE_PRODUCT = previous;
	}
}

function budgetPlugin(config) {
	const plugin = config.plugins.find((candidate) => candidate?.name === 'kw-enforce-startup-graph-budgets');
	assert.ok(plugin, 'the build must install the startup-graph budget plugin');
	return plugin;
}

function bundleWithBootstrap(product) {
	const bootstrapModule = `/workspace${PRODUCT_BOOTSTRAPS[product]}`;
	return {
		'assets/index.js': chunk({
			fileName: 'assets/index.js',
			code: 'entry-code',
			isEntry: true,
			facadeModuleId: '/workspace/src/main.jsx',
			modules: { '/workspace/src/main.jsx': {} },
		}),
		[`assets/${product}-bootstrap.js`]: chunk({
			fileName: `assets/${product}-bootstrap.js`,
			code: `${product}-bootstrap-code`,
			facadeModuleId: bootstrapModule,
			modules: { [bootstrapModule]: {} },
		}),
	};
}

function chunk({ fileName, code, isEntry = false, facadeModuleId = null, modules = {} }) {
	return {
		type: 'chunk',
		fileName,
		code,
		isEntry,
		facadeModuleId,
		imports: [],
		dynamicImports: [],
		modules,
		viteMetadata: { importedCss: new Set(), importedAssets: new Set() },
	};
}
