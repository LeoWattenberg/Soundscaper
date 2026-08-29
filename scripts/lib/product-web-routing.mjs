/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * One web build serves one product.
 *
 * A service worker's script URL bounds the maximum scope it may claim, so a
 * product served from the root of its own origin needs its worker script at
 * that root path. Two products cannot both own `/service-worker.js` in one
 * deployment, so each product is built and deployed separately. This module is
 * the single place that decides which documents a build emits, which origin
 * they canonicalize to, where each worker lives, and which per-route Cloudflare
 * rules accompany them.
 *
 * Each product now owns the root of its own origin. The retired
 * `/framescaper/` document routes are emitted only as finite permanent
 * redirects by the Soundscaper build; no build emits another product's
 * documents, install metadata, or service worker.
 */

const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper']);

const PRODUCT_SITES = Object.freeze({
	soundscaper: Object.freeze({ variable: 'SOUNDSCAPER_SITE', origin: 'https://soundscaper.org' }),
	framescaper: Object.freeze({ variable: 'FRAMESCAPER_SITE', origin: 'https://framescaper.org' }),
});

const RETIRED_PRODUCT_BASE_PATHS = Object.freeze({
	soundscaper: Object.freeze({ framescaper: '/framescaper' }),
	framescaper: Object.freeze({}),
});

const EDITOR_CAPTURE_POLICY =
	'microphone=(self), speaker-selection=(self), display-capture=(self), camera=(), geolocation=()';
const CAMERA_CAPTURE_POLICY =
	'microphone=(self), speaker-selection=(self), display-capture=(self), camera=(self), geolocation=()';
const SEALED_CAPTURE_POLICY =
	'microphone=(), speaker-selection=(), display-capture=(), camera=(), geolocation=()';

/** Per-product document capture policies, by whether the document is embedded. */
const PRODUCT_POLICIES = Object.freeze({
	soundscaper: Object.freeze({ standard: EDITOR_CAPTURE_POLICY, embedded: EDITOR_CAPTURE_POLICY }),
	framescaper: Object.freeze({ standard: CAMERA_CAPTURE_POLICY, embedded: SEALED_CAPTURE_POLICY }),
});

/** The cross-origin isolation every product deployment shares byte for byte. */
const ISOLATION_HEADERS = Object.freeze({
	'cross-origin-opener-policy': 'same-origin',
	'cross-origin-embedder-policy': 'credentialless',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'x-content-type-options': 'nosniff',
});

export const ISOLATION_PATTERN = '/*';
export const DOCUMENT_RULES_MARKER = '# @product-document-rules@';
export const WORKER_RULES_MARKER = '# @product-worker-rules@';

/** Resolves the product a web build serves, refusing an unknown identifier. */
export function webBuildProductId(environment = process.env) {
	const value = environment.SCAPE_PRODUCT;
	if (value === undefined || value === '') return 'soundscaper';
	if (!PRODUCT_IDS.includes(value)) throw new Error(`Unsupported web build product: ${String(value)}.`);
	return value;
}

/** Resolves everything one product's web build emits: documents, site, workers and header rules. */
export function webBuildRouting(environment = process.env) {
	const productId = webBuildProductId(environment);
	const plans = [documentPlan(productId, '')];
	const workers = plans.map((plan) => Object.freeze({
		productId: plan.productId,
		scope: plan.scope,
		scriptUrl: `${plan.basePath}/service-worker.js`,
		fallbacks: Object.freeze({ standard: `${plan.scope}en/`, embedded: `${plan.scope}embed/en/` }),
		// Scopes this worker must decline. A retired product prefix belongs here
		// as much as a co-hosted product's does: the origin answers it with a
		// redirect, and without it the offline navigation fallback reads the
		// prefix as a locale segment and mounts this product's shell under the
		// other product's path, where it reports the wrong product and cannot
		// boot. Declining leaves an honest network error instead.
		foreignScopes: Object.freeze([
			...plans
				.filter(({ scope }) => scope !== plan.scope && scope.startsWith(plan.scope))
				.map(({ scope }) => scope),
			...Object.entries(RETIRED_PRODUCT_BASE_PATHS[plan.productId])
				.filter(([productId]) => !plans.some((hosted) => hosted.productId === productId))
				.map(([, basePath]) => `${basePath}/`),
		].sort()),
		root: plan.root,
	}));
	return Object.freeze({
		productId,
		site: buildSite(productId, environment),
		plans: Object.freeze(plans),
		workers: Object.freeze(workers),
	});
}

/**
 * Finite link-hygiene redirects for documents a product origin retired.
 *
 * Service-worker and asset paths are deliberately absent. Pages applies a
 * redirect before serving a same-path asset, and redirecting an old worker
 * would prevent the browser from observing its removal. A top-level 404
 * document makes those retired non-document paths fail closed instead.
 */
export function retiredProductRedirects(routing, locales) {
	if (!routing || !PRODUCT_IDS.includes(routing.productId)) {
		throw new TypeError('Retired product redirects require a valid web-build routing descriptor.');
	}
	if (!Array.isArray(locales) || locales.length < 1) {
		throw new TypeError('Retired product redirects require at least one locale.');
	}
	const normalizedLocales = locales.map((locale) => {
		const value = String(locale);
		if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value)) {
			throw new TypeError(`Retired product redirect locale is invalid: ${value}.`);
		}
		return value;
	});
	if (new Set(normalizedLocales).size !== normalizedLocales.length) {
		throw new TypeError('Retired product redirect locales must be unique.');
	}
	const hosted = new Set(routing.plans.map(({ productId }) => productId));
	const retired = RETIRED_PRODUCT_BASE_PATHS[routing.productId];
	return Object.freeze(Object.entries(retired)
		.filter(([productId]) => !hosted.has(productId))
		.flatMap(([productId, basePath]) => {
			const origin = PRODUCT_SITES[productId].origin;
			return [
				Object.freeze({ source: basePath, destination: `${origin}/`, status: 301 }),
				Object.freeze({ source: `${basePath}/`, destination: `${origin}/`, status: 301 }),
				...normalizedLocales.flatMap((locale) => [
					Object.freeze({
						source: `${basePath}/${locale}/`,
						destination: `${origin}/${locale}/`,
						status: 301,
					}),
					Object.freeze({
						source: `${basePath}/embed/${locale}/`,
						destination: `${origin}/embed/${locale}/`,
						status: 301,
					}),
				]),
			];
		}));
}

/** Renders the static Cloudflare Pages `_redirects` file for one build. */
export function renderProductRedirects(routing, locales) {
	const redirects = retiredProductRedirects(routing, locales);
	return redirects.length === 0
		? '# This product origin has no retired document routes.\n'
		: `${redirects.map(({ source, destination, status }) => (
			`${source} ${destination} ${String(status)}`
		)).join('\n')}\n`;
}

/** The absolute path of one emitted document. */
export function documentRoute(plan, locale, embedded = false) {
	return `${plan.basePath}${embedded ? '/embed' : ''}/${encodeURIComponent(String(locale || 'en'))}/`;
}

function documentPlan(productId, basePath) {
	const scope = `${basePath}/`;
	return Object.freeze({
		productId,
		basePath,
		scope,
		root: basePath === '',
		startUrl: `${scope}en/`,
		policies: PRODUCT_POLICIES[productId],
	});
}

function buildSite(productId, environment) {
	const { variable, origin } = PRODUCT_SITES[productId];
	const configured = environment[variable];
	const site = new URL(configured || origin);
	if (!['http:', 'https:'].includes(site.protocol) || site.pathname !== '/' || site.search || site.hash) {
		throw new Error(`${variable} must be an origin with no path, query or fragment: ${site.href}`);
	}
	return site;
}

/**
 * Substitutes this build's document and worker rules into the shared checked-in
 * `_headers`, which carries the cross-origin isolation block every product
 * deployment shares. The isolation block is never moved, host-scoped or
 * duplicated: the rules composed here only ever add disjoint route patterns.
 */
export function composeProductHeaders(shared, routing) {
	if (typeof shared !== 'string' || !shared.endsWith('\n')) {
		throw new Error('Cloudflare header template is not a newline-terminated document.');
	}
	assertSharedTemplate(shared);
	const composed = replaceMarker(
		replaceMarker(shared, DOCUMENT_RULES_MARKER, documentRules(routing.plans)),
		WORKER_RULES_MARKER,
		workerRules(routing.workers),
	);
	auditComposedHeaders(composed, routing);
	return composed;
}

function assertSharedTemplate(shared) {
	for (const rule of parseHeaderRules(shared)) {
		for (const { name } of rule.directives) {
			if (name === 'permissions-policy' || name === 'service-worker-allowed') {
				throw new Error(`Cloudflare header template must not fix the per-product ${name} on ${rule.pattern}.`);
			}
		}
	}
}

function replaceMarker(text, marker, replacement) {
	const lines = text.split(/\r?\n/u);
	const positions = lines.reduce((found, line, index) => line === marker ? [...found, index] : found, []);
	if (positions.length !== 1) {
		throw new Error(`Cloudflare header template must carry ${marker} exactly once; found ${String(positions.length)}.`);
	}
	lines.splice(positions[0], 1, ...replacement.split('\n'));
	return lines.join('\n');
}

function documentRules(plans) {
	const rules = [];
	for (const plan of plans) {
		if (plan.root) rules.push(documentRule('/', plan.policies.standard));
		rules.push(documentRule(`${plan.basePath}/:locale/`, plan.policies.standard));
		rules.push(documentRule(`${plan.basePath}/embed/:locale/`, plan.policies.embedded));
	}
	rules.push(documentRule('/privacy/:locale/', SEALED_CAPTURE_POLICY));
	return rules.join('\n\n');
}

function documentRule(pattern, policy) {
	return `${pattern}\n\tPermissions-Policy: ${policy}\n\tCache-Control: no-cache`;
}

function workerRules(workers) {
	return workers
		.map(({ scriptUrl, scope }) => `${scriptUrl}\n\tCache-Control: no-store\n\tService-Worker-Allowed: ${scope}`)
		.join('\n\n');
}

/**
 * Fails closed on a composed `_headers` that would weaken isolation or hand a
 * document two policies: Cloudflare joins same-name headers from every matching
 * rule, and a joined Cross-Origin-Opener-Policy is invalid.
 */
export function auditComposedHeaders(text, routing) {
	const rules = parseHeaderRules(text);
	for (const marker of [DOCUMENT_RULES_MARKER, WORKER_RULES_MARKER]) {
		if (text.includes(marker)) throw new Error(`Cloudflare headers were deployed uncomposed: ${marker} remains.`);
	}
	const isolation = rules.filter(({ pattern }) => pattern === ISOLATION_PATTERN);
	if (isolation.length !== 1 || rules[0] !== isolation[0]) {
		throw new Error('Cloudflare headers must open with exactly one shared cross-origin isolation rule.');
	}
	for (const [name, value] of Object.entries(ISOLATION_HEADERS)) {
		const directive = isolation[0].directives.find((entry) => entry.name === name);
		if (!directive || directive.detached || directive.value !== value) {
			throw new Error(`Cloudflare isolation rule must set ${name}: ${value}.`);
		}
	}
	for (const rule of rules) {
		if (/:\/\/|^https?:/iu.test(rule.pattern)) {
			throw new Error(`Cloudflare header rule must not be host-scoped: ${rule.pattern}.`);
		}
		if (rule.pattern === ISOLATION_PATTERN) continue;
		const opener = rule.directives.filter(({ name }) => name === 'cross-origin-opener-policy');
		if (opener.length > 0 && !opener[0].detached) {
			throw new Error(`Cloudflare rule ${rule.pattern} relaxes Cross-Origin-Opener-Policy without detaching it.`);
		}
	}
	for (const plan of routing.plans) {
		for (const embedded of [false, true]) {
			assertDocumentPolicies(rules, documentRoute(plan, 'en', embedded), plan, embedded);
		}
		if (plan.root) assertDocumentPolicies(rules, '/', plan, false);
	}
	return rules;
}

function assertDocumentPolicies(rules, path, plan, embedded) {
	const headers = matchedHeaders(rules, path);
	const opener = headers.get('cross-origin-opener-policy') ?? [];
	if (opener.length !== 1 || opener[0] !== ISOLATION_HEADERS['cross-origin-opener-policy']) {
		throw new Error(`${path} must receive exactly one Cross-Origin-Opener-Policy: same-origin.`);
	}
	const expected = embedded ? plan.policies.embedded : plan.policies.standard;
	const policies = headers.get('permissions-policy') ?? [];
	if (policies.length !== 1 || policies[0] !== expected) {
		throw new Error(`${path} must receive exactly one Permissions-Policy: ${expected}.`);
	}
}

/** Applies Cloudflare's matching rules to one path: every matching rule contributes, in order. */
export function matchedHeaders(rules, path) {
	const headers = new Map();
	for (const rule of rules) {
		if (!matchesPattern(rule.pattern, path)) continue;
		for (const { name, detached, value } of rule.directives) {
			if (detached) headers.delete(name);
			else headers.set(name, [...headers.get(name) ?? [], value]);
		}
	}
	return headers;
}

function matchesPattern(pattern, path) {
	const expression = pattern.split('/').map((segment) => segment.startsWith(':')
		? '[^/]+'
		: segment.split('*').map(escapeRegExp).join('.*')).join('/');
	return new RegExp(`^${expression}$`, 'u').test(path);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Parses the `_headers` grammar: unindented patterns, indented `Name: value` and `! Name` directives. */
export function parseHeaderRules(text) {
	const rules = [];
	let current = null;
	for (const rawLine of String(text).split(/\r?\n/u)) {
		if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
		if (!/^\s/u.test(rawLine)) {
			current = { pattern: rawLine.trimEnd(), directives: [] };
			rules.push(current);
			continue;
		}
		const detach = /^\s+!\s*([\w-]+)\s*$/u.exec(rawLine);
		const set = /^\s+([\w-]+):\s*(.*)$/u.exec(rawLine);
		if (!current || !(detach || set)) throw new Error(`Cloudflare header line is malformed: ${rawLine}`);
		current.directives.push(detach
			? { name: detach[1].toLowerCase(), detached: true, value: '' }
			: { name: set[1].toLowerCase(), detached: false, value: set[2].trimEnd() });
	}
	return rules;
}
