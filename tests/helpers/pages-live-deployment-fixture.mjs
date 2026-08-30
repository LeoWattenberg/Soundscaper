/* SPDX-License-Identifier: AGPL-3.0-only */

import { pagesCachePolicyDescriptors } from '../../scripts/lib/pages-deploy-preflight.mjs';

/**
 * Model a live Pages deployment with the route metadata its audit requires.
 *
 * The fixture publishes its content-hashed asset inventory at
 * `/offline-shell.json`. `zoneBrowserTtl` models a zone that rewrites
 * `no-cache` on the way out, as the product zones do in production.
 */
export function livePagesDeployment({
	routing,
	assetPath,
	inventory = [assetPath],
	redirects: configuredRedirects,
	zoneBrowserTtl,
	includeRetired = true,
}) {
	const descriptors = pagesCachePolicyDescriptors({ routing, assetPath, includeRetired });
	const redirects = configuredRedirects ?? new Map(descriptors
		.filter(({ expectation }) => expectation === 'redirected')
		.map(({ path, location }) => [path, location]));
	const served = new Map(descriptors
		.filter(({ expectation }) => expectation === 'served')
		.map((descriptor) => [descriptor.path, {
			...descriptor,
			cacheControl: zoneBrowserTtl !== undefined && descriptor.cacheControl === 'no-cache'
				? zoneBrowserTtl
				: descriptor.cacheControl,
		}]));
	const bodies = new Map();
	const requests = [];
	const fetchImpl = async (url, init) => {
		const pathname = decodeURIComponent(new URL(url).pathname);
		requests.push({ pathname, redirect: init.redirect });
		if (redirects.has(pathname)) {
			// Cloudflare carries a request query onto a redirect target that has none.
			const search = new URL(url).search;
			return Response.redirect(`${redirects.get(pathname)}${search}`, 301);
		}
		const descriptor = served.get(pathname);
		if (!descriptor) return new Response(null, { status: 404 });
		return new Response(bodies.get(pathname) ?? liveBody(pathname, descriptor, inventory), {
			status: 200,
			headers: {
				'cache-control': descriptor.cacheControl,
				...(descriptor.serviceWorkerAllowed ? { 'service-worker-allowed': descriptor.serviceWorkerAllowed } : {}),
			},
		});
	};
	return {
		descriptors,
		served,
		redirects,
		bodies,
		requests,
		fetchImpl,
		paths: () => requests.map(({ pathname }) => pathname),
	};
}

function liveBody(pathname, descriptor, inventory) {
	if (pathname === '/offline-shell.json') return JSON.stringify({ assets: inventory.map((url) => ({ url })) });
	return descriptor.bodyIncludes
		? `/* SPDX-License-Identifier: AGPL-3.0-only */\n${descriptor.bodyIncludes} {};\n`
		: 'ok';
}
