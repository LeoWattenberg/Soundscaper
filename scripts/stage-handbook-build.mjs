#!/usr/bin/env node

/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Places the built handbook inside the product build that serves it.
 *
 * The handbook is a path on a product origin rather than a subdomain of its
 * own, so it ships in the same Cloudflare Pages deployment as the editor it
 * documents instead of a second project with a custom domain of its own. That
 * makes staging a build step: `handbook/dist` is copied under the base path
 * `scripts/lib/product-web-routing.mjs` assigns it, and only for the product
 * that hosts it.
 *
 * The copy is a copy on purpose. The handbook keeps its own `outDir` so
 * `npm run docs:dev`, `npm run docs:preview` and the handbook browser suite
 * stay usable without a product build, and so an Astro build never empties a
 * directory the product build owns.
 */

import { access, cp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { webBuildRouting } from './lib/product-web-routing.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const outputRoot = resolve(repositoryRoot, process.argv[2] || 'dist');
const source = resolve(repositoryRoot, process.argv[3] || 'handbook/dist');
const routing = webBuildRouting();

if (!routing.handbook) {
	console.log(`The ${routing.productId} build hosts no handbook; nothing was staged.`);
} else {
	const target = resolve(outputRoot, `.${routing.handbook.scope}`);
	await assertHandbookBuiltForBase(routing.handbook);
	// The product build owns `dist`, so a directory already standing at the
	// handbook's base path is either an earlier run of this step or a product
	// route that collides with it. Astro's hashed asset directory is what tells
	// the two apart: no product route emits one. Removing a collision would
	// delete a product document, so it is refused instead of overwritten.
	if (await exists(target) && !await exists(resolve(outputRoot, `.${routing.handbook.assetScope}`))) {
		throw new Error(
			`The ${routing.productId} build already emits ${routing.handbook.scope}, so the handbook cannot be `
			+ 'staged there. Move the handbook base path or the colliding product route.',
		);
	}
	await rm(target, { force: true, recursive: true });
	await cp(source, target, { recursive: true });
	console.log(`Staged the handbook at ${routing.handbook.scope} of the ${routing.productId} build.`);
}

/**
 * Fails closed on a handbook built for a different base than the one being staged.
 *
 * Astro resolves the base at build time and bakes it into every emitted asset
 * URL, so a `handbook/dist` left over from an earlier base would be copied into
 * place looking complete and answer every request with a broken stylesheet.
 *
 * @param {{ scope: string, assetScope: string }} handbook
 * @returns {Promise<void>}
 */
async function assertHandbookBuiltForBase(handbook) {
	let document;
	try {
		document = await readFile(resolve(source, 'index.html'), 'utf8');
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
		throw new Error(`There is no handbook build at ${source}. Run \`npm run docs:build\` first.`, {
			cause: error,
		});
	}
	if (!document.includes(`"${handbook.assetScope}`)) {
		throw new Error(
			`The handbook build at ${source} was not built for the base path ${handbook.scope}. `
			+ 'Rebuild it with `npm run docs:build`.',
		);
	}
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
