/* SPDX-License-Identifier: AGPL-3.0-only */

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
	const servers = [];
	try {
		for (const productId of PRODUCT_IDS) {
			const server = await startStaticServer({ root: join(payloadRoot, 'sites', productId) });
			if (typeof server?.close !== 'function') {
				throw new TypeError(`The ${productId} browser server cannot be closed.`);
			}
			servers.push({ productId, server });
			assertLoopbackOrigin(server.baseURL, `${productId} browser origin`);
		}
		const origins = Object.freeze(Object.fromEntries(servers.map(({ productId, server }) => (
			[productId, new URL(server.baseURL).origin]
		))));
		if (origins.soundscaper === origins.framescaper) {
			throw new Error('Desktop nightly tests require distinct product origins.');
		}
		const browserEnvironment = Object.freeze({
			...environment,
			[PRODUCT_ORIGINS_VARIABLE]: JSON.stringify(origins),
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
}
