/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The two cross-origin project transfer documents.
 *
 * Browser storage is partitioned by top-level site, so a project held under
 * soundscaper.org is unreachable from framescaper.org. These two routes are the
 * only place the two origins meet: each one reads its own storage first-party,
 * in its own top-level context, and complete projects cross as `.scape`
 * archives - either downloaded and re-uploaded by hand, or handed over a popup
 * handshake in one click.
 *
 * They are deliberately not products. No web app manifest, no product icon, no
 * offline install inventory, no editor bundle: a transfer document holds no
 * audio, mounts no timeline, and must stay loadable on an origin whose editor
 * the visitor may never have opened. That is also why the markup lives here as
 * one renderer rather than as a template under the application entry - the
 * production pages and the dev-server pages are the same document, differing
 * only in which URL serves the page module.
 *
 * Imported by `scripts/generate-static-routes.mjs` (plain node, no loader) and
 * by `src/common/site/route.js` (browser), so this module stays dependency-free
 * JavaScript.
 */

/** Source path of the page module, as the Vite build manifest keys it. */
export const TRANSFER_PAGE_ENTRY_MODULE = 'src/common/transfer/transfer-page-entry.ts';

/** URL the dev server serves that same module from. */
export const TRANSFER_PAGE_DEV_MODULE_URL = `/${TRANSFER_PAGE_ENTRY_MODULE}`;

export const TRANSFER_ROUTE_PREFIX = '/transfer/';

/** @typedef {'send' | 'receive'} TransferRole */

/**
 * @typedef {object} TransferRoute
 * @property {TransferRole} role
 * @property {string} path
 * @property {string} title
 * @property {string} summary
 */

/** @type {readonly TransferRoute[]} */
export const TRANSFER_ROUTES = Object.freeze([
	Object.freeze({
		role: /** @type {TransferRole} */ ('send'),
		path: '/transfer/send/',
		title: 'Send projects to the other product',
		summary: 'Export every project stored on this origin as a .scape archive, then download the'
			+ ' archives or hand them straight to the other product in one click. Nothing stored here'
			+ ' is changed or removed.',
	}),
	Object.freeze({
		role: /** @type {TransferRole} */ ('receive'),
		path: '/transfer/receive/',
		title: 'Receive projects from the other product',
		summary: 'Accept .scape archives from the other product - over the transfer handshake, or from'
			+ ' files you downloaded - and import them into this origin\'s storage.',
	}),
]);

/**
 * @param {unknown} pathname
 * @returns {TransferRoute | null}
 */
export function transferRouteForPath(pathname) {
	if (typeof pathname !== 'string') return null;
	const normalized = normalizeTransferPath(pathname);
	if (normalized === null) return null;
	return TRANSFER_ROUTES.find((route) => route.path === normalized) || null;
}

/**
 * @param {unknown} pathname
 * @returns {boolean}
 */
export function isTransferRoutePath(pathname) {
	return transferRouteForPath(pathname) !== null;
}

/**
 * @param {unknown} role
 * @returns {TransferRoute}
 */
export function transferRouteForRole(role) {
	const route = TRANSFER_ROUTES.find((candidate) => candidate.role === role);
	if (!route) throw new RangeError(`Unknown project transfer role: ${String(role)}.`);
	return route;
}

/**
 * Reduce a location pathname to the exact route shape, or refuse it.
 *
 * Only a missing trailing slash is forgiven. Case, `.`/`..` segments, repeated
 * slashes and any deeper path are refused rather than guessed at, because the
 * response policy in `public/_headers` is bound to these two exact paths: a
 * document served under some other path would not carry the opener policy the
 * handshake needs, and silently mounting the page there would produce a
 * transfer that can never reach its peer.
 *
 * @param {string} pathname
 * @returns {string | null}
 */
function normalizeTransferPath(pathname) {
	if (!pathname.startsWith('/') || pathname.includes('//')) return null;
	const withSlash = pathname.endsWith('/') ? pathname : `${pathname}/`;
	const segments = withSlash.split('/').slice(1, -1);
	if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
	return `/${segments.join('/')}/`;
}

/**
 * @param {object} options
 * @param {unknown} options.role
 * @param {string} options.moduleUrl
 * @param {readonly string[]} [options.modulePreloads]
 * @param {readonly string[]} [options.stylesheets]
 * @param {string | null} [options.canonical]
 * @returns {string}
 */
export function renderTransferDocument({
	role,
	moduleUrl,
	modulePreloads = [],
	stylesheets = [],
	canonical = null,
}) {
	const route = transferRouteForRole(role);
	if (typeof moduleUrl !== 'string' || !moduleUrl.startsWith('/')) {
		throw new TypeError('A transfer document needs a root-relative page module URL.');
	}
	const head = [
		'<meta charset="utf-8" />',
		'<meta name="viewport" content="width=device-width, initial-scale=1" />',
		'<meta name="color-scheme" content="light dark" />',
		'<meta name="robots" content="noindex, nofollow" />',
		`<meta name="description" content="${escapeHtml(route.summary)}" />`,
		...(canonical ? [`<link rel="canonical" href="${escapeHtml(canonical)}" />`] : []),
		...stylesheets.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}" />`),
		...modulePreloads.map((href) => `<link rel="modulepreload" href="${escapeHtml(href)}" />`),
		`<title>${escapeHtml(route.title)}</title>`,
		`<style>${TRANSFER_PAGE_STYLES}</style>`,
	].join('\n\t\t');
	return `<!doctype html>
<html lang="en" dir="ltr" data-transfer-role="${escapeHtml(route.role)}">
	<head>
		${head}
	</head>
	<body>
		<main id="transfer" data-transfer-role="${escapeHtml(route.role)}">
			<h1>${escapeHtml(route.title)}</h1>
			<p>${escapeHtml(route.summary)}</p>
			<p data-transfer-boot role="status">Loading the transfer tools&#8230;</p>
		</main>
		<script type="module" src="${escapeHtml(moduleUrl)}"></script>
	</body>
</html>
`;
}

/** Deliberately tiny: the transfer documents ship no design system. */
export const TRANSFER_PAGE_STYLES = [
	':root{color-scheme:light dark}',
	'body{margin:0;font:16px/1.5 system-ui,sans-serif;background:Canvas;color:CanvasText}',
	'#transfer{max-width:48rem;margin:0 auto;padding:2rem 1rem 4rem}',
	'h1{font-size:1.5rem;margin:0 0 .5rem}',
	'button{font:inherit;padding:.5rem 1rem;margin:0 .5rem .5rem 0}',
	'ul{padding-inline-start:1.25rem}',
	'li[data-outcome="failed"]{color:#b3261e}',
	'@media (prefers-color-scheme:dark){li[data-outcome="failed"]{color:#f2b8b5}}',
].join('');

/**
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}
