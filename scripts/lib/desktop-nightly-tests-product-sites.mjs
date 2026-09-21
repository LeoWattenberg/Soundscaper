/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper']);
const PRODUCT_ORIGINS_VARIABLE = 'SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS';

/** Start the two independent production-shaped sites used by browser tests. */
export async function startDesktopNightlyTestsProductSites({
	payloadRoot,
	environment = process.env,
	startStaticServer,
} = {}) {
	if (typeof payloadRoot !== 'string' || !isAbsolute(payloadRoot)) {
		throw new TypeError('Desktop nightly tests payload root must be absolute.');
	}
	if (typeof startStaticServer !== 'function') {
		throw new TypeError('Desktop nightly tests product sites require a static-server factory.');
	}
	const sitePlans = await loadDesktopNightlyTestsProductSitePlans(payloadRoot);
	const servers = [];
	try {
		for (const { host, origin, port, productId, root } of sitePlans) {
			const server = await startStaticServer({ root, host, port });
			if (typeof server?.close !== 'function') {
				throw new TypeError(`The ${productId} browser server cannot be closed.`);
			}
			servers.push({ productId, server });
			if (server.baseURL !== origin) {
				throw new Error(`The ${productId} browser server did not bind its authenticated build origin.`);
			}
		}
		const origins = Object.freeze(Object.fromEntries(sitePlans.map(({ productId, origin }) => (
			[productId, origin]
		))));
		const browserEnvironment = Object.freeze({
			...environment,
			[PRODUCT_ORIGINS_VARIABLE]: JSON.stringify(origins),
			SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify(servers.map(({ productId, server }) => ({
				productId,
				origin: new URL(server.baseURL).origin,
				outputDirectory: join(payloadRoot, 'sites', productId),
			}))),
		});
		let closed = false;
		return Object.freeze({
			origins,
			browserEnvironment,
			async close() {
				if (closed) return;
				closed = true;
				await closeProductServers(servers);
			},
		});
	} catch (error) {
		try {
			await closeProductServers(servers);
		} catch (closeError) {
			throw new AggregateError(
				[error, closeError],
				'Desktop nightly product-site startup and cleanup both failed.',
				{ cause: closeError },
			);
		}
		throw error;
	}
}

export async function loadDesktopNightlyTestsProductSitePlans(payloadRoot) {
	if (typeof payloadRoot !== 'string' || !isAbsolute(payloadRoot)) {
		throw new TypeError('Desktop nightly tests payload root must be absolute.');
	}
	const sites = [];
	for (const productId of PRODUCT_IDS) {
		const root = join(payloadRoot, 'sites', productId);
		let evidence;
		try {
			evidence = JSON.parse(await readFile(join(root, '.browser-product-build.json'), 'utf8'));
		} catch (error) {
			throw new Error(`The ${productId} browser build evidence is unreadable.`, { cause: error });
		}
		if (evidence?.schemaVersion !== 2 || evidence.productId !== productId) {
			throw new Error(`The ${productId} browser build evidence names the wrong product.`);
		}
		const origin = assertLoopbackOrigin(evidence.origin, `${productId} browser build evidence`);
		const parsed = new URL(origin);
		sites.push(Object.freeze({
			host: parsed.hostname, origin, port: Number(parsed.port), productId, root,
		}));
	}
	if (sites[0].origin === sites[1].origin) {
		throw new Error('Desktop nightly tests require distinct product origins.');
	}
	return Object.freeze(sites);
}

async function closeProductServers(servers) {
	const results = await Promise.allSettled(servers.map(({ server }) => server.close()));
	const errors = results.filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, 'Desktop nightly product servers could not be closed.');
}

function assertLoopbackOrigin(value, label) {
	let url;
	try { url = new URL(value); } catch { throw new TypeError(`Desktop nightly tests ${label} is invalid.`); }
	if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
		|| url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new TypeError(`Desktop nightly tests ${label} must be an HTTP 127.0.0.1 origin.`);
	}
	return url.origin;
}
