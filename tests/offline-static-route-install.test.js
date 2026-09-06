/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { productWebManifest } from '../scripts/lib/product-web-manifest.mjs';
import { ROUTE_LOCALES } from '../src/common/i18n/locales.js';
import { TRANSFER_ROUTES } from '../src/common/transfer/transfer-routes.js';

const execFileAsync = promisify(execFile);

test('static web routes receive product-specific install manifests and Apple touch icons', async (context) => {
	const outputRoot = await generateRoutes(context, {});

	const root = await readFile(join(outputRoot, 'index.html'), 'utf8');
	const soundscaper = await readFile(join(outputRoot, 'en/index.html'), 'utf8');
	const german = await readFile(join(outputRoot, 'de/index.html'), 'utf8');
	assertInstallLinks(root, 'soundscaper');
	assertInstallLinks(soundscaper, 'soundscaper');
	assert.match(german, /data-initial-load-progress role="progressbar" aria-label="Projekt wird geladen"/u);
	assert.equal(await readFile(join(outputRoot, 'framescaper/en/index.html'), 'utf8').catch(() => null), null);
	// Every build also emits the two cross-origin transfer documents: they
	// belong to the origin rather than to a product, so both builds carry them.
	assert.equal(await documentCount(outputRoot), 1 + ROUTE_LOCALES.length * 2 + TRANSFER_ROUTES.length + 3);
	assert.match(soundscaper, /<link rel="canonical" href="https:\/\/soundscaper\.org\/en\/" \/>/u);
	const redirects = await readFile(join(outputRoot, '_redirects'), 'utf8');
	assert.match(redirects, /^\/framescaper https:\/\/framescaper\.org\/ 301$/mu);
	assert.match(redirects, /^\/framescaper\/en\/ https:\/\/framescaper\.org\/en\/ 301$/mu);
	assert.match(redirects, /^\/framescaper\/embed\/de\/ https:\/\/framescaper\.org\/embed\/de\/ 301$/mu);
	assert.doesNotMatch(redirects, /service-worker|manifest|offline-icons|logo/u);
	assert.match(await readFile(join(outputRoot, '404.html'), 'utf8'), /<meta name="robots" content="noindex, nofollow" \/>/u);
});

test('a Framescaper build serves its own origin root and never the transitional prefix', async (context) => {
	const outputRoot = await generateRoutes(context, { SCAPE_PRODUCT: 'framescaper' });

	assert.equal(await documentCount(outputRoot), 1 + ROUTE_LOCALES.length * 2 + TRANSFER_ROUTES.length + 3);
	assert.equal(await readFile(join(outputRoot, 'framescaper/en/index.html'), 'utf8').catch(() => null), null);
	const root = await readFile(join(outputRoot, 'index.html'), 'utf8');
	const framescaper = await readFile(join(outputRoot, 'en/index.html'), 'utf8');
	const embedded = await readFile(join(outputRoot, 'embed/de/index.html'), 'utf8');
	for (const html of [root, framescaper, embedded]) {
		assertInstallLinks(html, 'framescaper');
		assert.match(html, /<html lang="[\w-]+" dir="\w+" data-product="framescaper">/u);
		assert.match(html, /<title>Framescaper<\/title>/u);
	}
	assert.doesNotMatch(framescaper, /manifest-soundscaper|soundscaper-180|\/framescaper\//u);
});

test('a Framescaper build self-canonicalizes to its own origin on every locale alternate', async (context) => {
	const outputRoot = await generateRoutes(context, { SCAPE_PRODUCT: 'framescaper' });
	const framescaper = await readFile(join(outputRoot, 'en/index.html'), 'utf8');
	const embedded = await readFile(join(outputRoot, 'embed/en/index.html'), 'utf8');

	assert.match(framescaper, /<link rel="canonical" href="https:\/\/framescaper\.org\/en\/" \/>/u);
	assert.match(embedded, /<link rel="canonical" href="https:\/\/framescaper\.org\/embed\/en\/" \/>/u);
	assert.doesNotMatch(framescaper, /soundscaper\.org/u);
	assert.equal(
		await readFile(join(outputRoot, '_redirects'), 'utf8'),
		'# This product origin has no retired document routes.\n',
	);
	const alternates = Array.from(framescaper.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)" \/>/gu));
	assert.equal(alternates.length, ROUTE_LOCALES.length + 1);
	for (const [, hreflang, href] of alternates) {
		const locale = hreflang === 'x-default' ? 'en' : hreflang;
		assert.equal(href, `https://framescaper.org/${locale}/`);
	}
});

test('a configured Framescaper site overrides the default origin without disturbing Soundscaper', async (context) => {
	const framescaperRoot = await generateRoutes(context, {
		SCAPE_PRODUCT: 'framescaper',
		FRAMESCAPER_SITE: 'https://preview.framescaper.org',
		SOUNDSCAPER_SITE: 'https://preview.soundscaper.org',
	});
	const soundscaperRoot = await generateRoutes(context, { SOUNDSCAPER_SITE: 'https://preview.soundscaper.org' });

	assert.match(
		await readFile(join(framescaperRoot, 'en/index.html'), 'utf8'),
		/<link rel="canonical" href="https:\/\/preview\.framescaper\.org\/en\/" \/>/u,
	);
	assert.match(
		await readFile(join(soundscaperRoot, 'en/index.html'), 'utf8'),
		/<link rel="canonical" href="https:\/\/preview\.soundscaper\.org\/en\/" \/>/u,
	);
});

test('an unknown build product is refused rather than silently served as Soundscaper', async (context) => {
	await assert.rejects(
		() => generateRoutes(context, { SCAPE_PRODUCT: 'lightscaper' }),
		/Unsupported web build product: lightscaper/u,
	);
});

test('every product document tells the browser and iOS what an installed launch looks like', async (context) => {
	const roots = {
		soundscaper: await generateRoutes(context, {}),
		framescaper: await generateRoutes(context, { SCAPE_PRODUCT: 'framescaper' }),
	};
	const light = await siteSurfaceColor('light');
	const dark = productWebManifest(installedProduct('soundscaper')).theme_color;

	for (const [productId, root] of Object.entries(roots)) {
		const name = productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
		for (const route of ['index.html', 'en/index.html', 'embed/de/index.html', 'privacy/index.html']) {
			const html = await readFile(join(root, route), 'utf8');
			assert.deepEqual(themeColorMetas(html), [
				{ media: '(prefers-color-scheme: light)', content: light },
				{ media: '(prefers-color-scheme: dark)', content: dark },
			], `${productId} ${route} carries both chrome colours`);
			assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes" data-product-install-standalone \/>/u);
			assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="default" data-product-install-status-bar \/>/u);
			assert.match(html, new RegExp(`<meta name="apple-mobile-web-app-title" content="${name}" data-product-install-title \\/>`, 'u'));
		}
	}
	// The privacy route is the one document whose title is not the product's,
	// which is why the home-screen name is stated rather than inferred from it.
	const privacy = await readFile(join(roots.soundscaper, 'privacy/index.html'), 'utf8');
	assert.match(privacy, /<title>[^<]+ · Soundscaper<\/title>/u);
	assert.match(privacy, /content="Soundscaper" data-product-install-title \/>/u);
});

test('the head states the manifest colour and the document background rather than copies of them', async (context) => {
	const html = await readFile(join(await generateRoutes(context, {}), 'en/index.html'), 'utf8');
	const [light, dark] = themeColorMetas(html);

	// The dark value is the field the manifest generator emits, not a literal
	// spelled a second time in the route generator, so the two cannot drift.
	assert.equal(dark.content, productWebManifest(installedProduct('soundscaper')).theme_color);
	assert.equal(dark.content, productWebManifest(installedProduct('framescaper')).theme_color);
	assert.match(dark.content, /^#[0-9a-f]{6}$/u);
	// The light value has no manifest counterpart - a manifest declares one
	// theme colour - so it is held to the surface the site actually paints.
	assert.equal(light.content, await siteSurfaceColor('light'));
	assert.notEqual(light.content, dark.content);
});

test('both product manifests declare the colours the stylesheet actually paints', async () => {
	// An installed window shows these two: `theme_color` around the page and
	// `background_color` under the splash. Neither is a value the manifest may
	// invent - a chrome colour the page never paints draws a seam along the top
	// of the window, and a splash colour the page never paints flashes at the
	// moment the document takes over - so both are held to `--color-surface`.
	const light = await siteSurfaceColor('light');
	const dark = await siteSurfaceColor('dark');
	assert.match(light, /^#[0-9a-f]{6}$/u);
	assert.match(dark, /^#[0-9a-f]{6}$/u);
	assert.notEqual(light, dark);

	for (const productId of ['soundscaper', 'framescaper']) {
		const manifest = productWebManifest(installedProduct(productId));
		// The splash hands over to a document that paints the light surface
		// until the theme script has read the visitor's preference, and the icon
		// it draws is the plateless `any` raster the black Soundscaper mark
		// would disappear from over a dark ground.
		assert.equal(manifest.background_color, light, `${productId} splash colour`);
		// One declared chrome colour, and the head states the light one itself,
		// so the manifest carries the surface a dark window would seam against.
		assert.equal(manifest.theme_color, dark, `${productId} chrome colour`);
	}
});

test('the install tags are emitted once each and leave the metadata the template carries alone', async (context) => {
	const html = await readFile(join(await generateRoutes(context, {}), 'en/index.html'), 'utf8');

	assert.equal(occurrences(html, 'name="theme-color"'), 2);
	assert.equal(occurrences(html, 'name="apple-mobile-web-app-capable"'), 1);
	assert.equal(occurrences(html, 'name="apple-mobile-web-app-status-bar-style"'), 1);
	assert.equal(occurrences(html, 'name="apple-mobile-web-app-title"'), 1);
	assert.equal(occurrences(html, 'rel="manifest"'), 1);
	assert.equal(occurrences(html, 'rel="apple-touch-icon"'), 1);
	assert.equal(occurrences(html, 'name="color-scheme"'), 1);
	// `black-translucent` would need `viewport-fit=cover`; the status bar style
	// emitted here is the one that works with the viewport the template states.
	assert.equal(occurrences(html, 'content="width=device-width, initial-scale=1"'), 1);
	assert.doesNotMatch(html, /viewport-fit/u);
	assert.equal(occurrences(html, '<title>'), 1);
});

test('stable install metadata and icon URLs require revalidation', async (context) => {
	const shared = await readFile('public/_headers', 'utf8');
	assert.match(shared, /\/offline-icons\/\*\n\tCache-Control: no-cache/u);
	assert.match(shared, /\/logo\/\*\n\tCache-Control: no-cache/u);
	assert.match(shared, /\/manifest-\*\.webmanifest\n\tCache-Control: no-cache/u);

	const soundscaper = await readFile(join(await generateRoutes(context, {}), '_headers'), 'utf8');
	assert.match(soundscaper, /\/service-worker\.js\n\tCache-Control: no-store\n\tService-Worker-Allowed: \/\n/u);
	assert.doesNotMatch(soundscaper, /\/framescaper\/service-worker\.js/u);

	const framescaper = await readFile(
		join(await generateRoutes(context, { SCAPE_PRODUCT: 'framescaper' }), '_headers'),
		'utf8',
	);
	assert.match(framescaper, /\/service-worker\.js\n\tCache-Control: no-store\n\tService-Worker-Allowed: \/\n/u);
	assert.doesNotMatch(framescaper, /\/framescaper\/service-worker\.js/u);
	assert.equal(framescaper.includes('@product-document-rules@'), false);
});

async function generateRoutes(context, environment) {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-install-routes-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	await mkdir(outputRoot, { recursive: true });
	await writeFile(join(outputRoot, 'index.html'), `<!doctype html>
<html lang="en" dir="ltr" data-product="soundscaper">
	<head>
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="color-scheme" content="light dark" />
		<!-- route-head --><title>Soundscaper</title>
	</head>
	<body>
		<div data-initial-load-progress role="progressbar" aria-label="Loading project"></div>
		<div id="app"></div>
	</body>
</html>`);
	await writeFile(join(outputRoot, '_headers'), await readFile('public/_headers', 'utf8'));
	await execFileAsync(process.execPath, ['scripts/generate-static-routes.mjs', outputRoot], {
		cwd: process.cwd(),
		env: { ...process.env, SCAPE_PRODUCT: '', SOUNDSCAPER_SITE: '', FRAMESCAPER_SITE: '', ...environment },
	});
	return outputRoot;
}

async function documentCount(root) {
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	return entries.filter((entry) => entry.isFile() && entry.name === 'index.html').length;
}

function themeColorMetas(html) {
	return [...html.matchAll(/<meta name="theme-color" media="([^"]+)" content="([^"]+)" data-product-theme-color \/>/gu)]
		.map(([, media, content]) => ({ media, content }));
}

/**
 * A surface `src/common/site/site.css` paints behind every route, read from the
 * stylesheet rather than restated here: the head's theme colours and the
 * manifest's two colours are all colours of the page itself, and a literal in
 * this test would only prove the generators agree with the test.
 */
async function siteSurfaceColor(theme) {
	const css = await readFile('src/common/site/site.css', 'utf8');
	const root = theme === 'dark' ? String.raw`:root\[data-theme='dark'\]` : ':root';
	const declaration = new RegExp(`${root}\\s*\\{[^}]*?--color-surface:\\s*([^;]+);`, 'u').exec(css);
	assert.ok(declaration, `site.css declares a ${theme} --color-surface`);
	return declaration[1].trim();
}

/** A product as the offline shell hands it to the manifest generator. */
function installedProduct(productId) {
	const name = productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	return {
		id: productId,
		name,
		description: `Local-first ${productId} editor`,
		startUrl: '/en/',
		scope: '/',
		categories: ['productivity'],
		media: productId === 'framescaper' ? ['audio', 'video'] : ['audio'],
	};
}

function occurrences(html, needle) {
	return html.split(needle).length - 1;
}

function assertInstallLinks(html, productId) {
	assert.match(html, new RegExp(`<link rel="manifest" href="/manifest-${productId}\\.webmanifest" data-product-manifest \\/>`, 'u'));
	assert.match(html, new RegExp(`<link rel="apple-touch-icon" sizes="180x180" href="/offline-icons/${productId}-180\\.png" data-product-install-icon \\/>`, 'u'));
	const name = productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	assert.match(html, new RegExp(`<meta name="apple-mobile-web-app-title" content="${name}" data-product-install-title \\/>`, 'u'));
}
