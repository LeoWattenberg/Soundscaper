/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The per-product half of the document head, rewritten at boot.
 *
 * `scripts/generate-static-routes.mjs` writes one head per served document, and
 * the offline shell hands a cached copy of that document to whatever route is
 * asked for next - including, on a machine with both products installed, the
 * other product's. `applyDocumentRoute` is what corrects the head it arrived
 * with, so every tag in it that names a product has to be reachable from there.
 * The application title is the one iOS reads to name a home-screen launch, and
 * it used to be unreachable: the rewrite created and updated links only.
 *
 * The fake document is hand-rolled and small on purpose. The rewrite's whole
 * contract with the DOM is a handful of calls wide, and a real DOM would hide
 * which of them it depends on.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// The bundler replaces this identifier with a literal, so a bare `import` of
// the module would throw on a reference no build step has substituted here.
globalThis.__SCAPE_PRODUCT__ = 'soundscaper';
const { applyDocumentRoute } = await import('../src/common/site/App.jsx');

/** The install tags a generated Framescaper document carries, in head order. */
const FRAMESCAPER_HEAD = Object.freeze([
	['link', { rel: 'manifest', href: '/manifest-framescaper.webmanifest', 'data-product-manifest': '' }],
	['link', {
		rel: 'apple-touch-icon',
		sizes: '180x180',
		href: '/offline-icons/framescaper-180.png',
		'data-product-install-icon': '',
	}],
	['meta', {
		name: 'theme-color',
		media: '(prefers-color-scheme: light)',
		content: '#ffffff',
		'data-product-theme-color': '',
	}],
	['meta', {
		name: 'theme-color',
		media: '(prefers-color-scheme: dark)',
		content: '#14100d',
		'data-product-theme-color': '',
	}],
	['meta', { name: 'apple-mobile-web-app-capable', content: 'yes', 'data-product-install-standalone': '' }],
	['meta', {
		name: 'apple-mobile-web-app-status-bar-style',
		content: 'default',
		'data-product-install-status-bar': '',
	}],
	['meta', {
		name: 'apple-mobile-web-app-title',
		content: 'Framescaper',
		'data-product-install-title': '',
	}],
]);

test('a document whose head has no application title gains one naming the product it booted as', (context) => {
	const document = installDocument(context);

	applyDocumentRoute(route('soundscaper'));

	assert.deepEqual(installTitles(document), [
		{ name: 'apple-mobile-web-app-title', content: 'Soundscaper', 'data-product-install-title': '' },
	]);
	// The manifest link, the touch icon, the title meta, and the two product
	// icons Soundscaper's mark needs one of per colour scheme.
	assert.deepEqual(
		document.head.children.map((node) => node.tagName),
		['LINK', 'LINK', 'META', 'LINK', 'LINK'],
	);
	assert.equal(document.head.querySelector('meta[data-product-install-title]').tagName, 'META');
});

test('a Framescaper document booted as Soundscaper is renamed rather than left under the other name', (context) => {
	const document = installDocument(context, FRAMESCAPER_HEAD);
	const untouched = document.querySelectorAll('meta[data-product-theme-color]')
		.concat(document.querySelectorAll('meta[data-product-install-standalone]'))
		.concat(document.querySelectorAll('meta[data-product-install-status-bar]'));

	applyDocumentRoute(route('soundscaper'));

	assert.deepEqual(installTitles(document), [
		{ name: 'apple-mobile-web-app-title', content: 'Soundscaper', 'data-product-install-title': '' },
	]);
	// Corrected in place, beside the manifest and touch icon it is the sibling
	// of, rather than a second title appended after the one that arrived.
	assert.equal(document.head.querySelectorAll('meta[name="apple-mobile-web-app-title"]').length, 1);
	assert.equal(
		attributesOf(document.head.querySelector('link[data-product-manifest]')).href,
		'/manifest-soundscaper.webmanifest',
	);
	assert.equal(
		attributesOf(document.head.querySelector('link[data-product-install-icon]')).href,
		'/offline-icons/soundscaper-180.png',
	);
	// The theme colours and the Apple capability tags say the same thing for
	// both products, so the rewrite must leave those very elements alone.
	assert.deepEqual(untouched.map(attributesOf), [
		{ name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#ffffff', 'data-product-theme-color': '' },
		{ name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#14100d', 'data-product-theme-color': '' },
		{ name: 'apple-mobile-web-app-capable', content: 'yes', 'data-product-install-standalone': '' },
		{ name: 'apple-mobile-web-app-status-bar-style', content: 'default', 'data-product-install-status-bar': '' },
	]);
	assert.deepEqual(
		untouched.map((node) => node.parent === document.head),
		[true, true, true, true],
		'the product-independent metas are the same elements the document arrived with',
	);
});

test('a Soundscaper document booted as Framescaper takes the other product name', (context) => {
	const document = installDocument(context, [
		['meta', {
			name: 'apple-mobile-web-app-title',
			content: 'Soundscaper',
			'data-product-install-title': '',
		}],
	]);

	applyDocumentRoute(route('framescaper'));

	assert.deepEqual(installTitles(document), [
		{ name: 'apple-mobile-web-app-title', content: 'Framescaper', 'data-product-install-title': '' },
	]);
});

test('a head carrying two application titles keeps the one a browser would read', (context) => {
	// A browser reads the first of two, so the duplicate is dropped rather than
	// left behind holding a name nothing corrects.
	const document = installDocument(context, [
		['meta', { name: 'apple-mobile-web-app-title', content: 'Framescaper', 'data-product-install-title': '' }],
		['meta', { name: 'apple-mobile-web-app-title', content: 'Stale', 'data-product-install-title': '' }],
	]);

	applyDocumentRoute(route('soundscaper'));

	assert.deepEqual(installTitles(document), [
		{ name: 'apple-mobile-web-app-title', content: 'Soundscaper', 'data-product-install-title': '' },
	]);
});

test('the privacy route names the launch after the product while the document title names the page', (context) => {
	// This is why iOS is told the name rather than left to read `<title>`: on
	// this route the title is not the product's name.
	const document = installDocument(context, FRAMESCAPER_HEAD);

	applyDocumentRoute({ ...route('soundscaper'), privacyPolicy: true });

	assert.equal(document.title, 'Privacy policy · Soundscaper');
	assert.deepEqual(installTitles(document), [
		{ name: 'apple-mobile-web-app-title', content: 'Soundscaper', 'data-product-install-title': '' },
	]);
});

test('an embedded desktop route marks the root for both and labels the boot progress', (context) => {
	// The desktop shell and the embed both boot through this rewrite, and the
	// progress element is the only thing on screen until the editor binds, so it
	// has to be named in the locale the route asked for rather than in English.
	const document = installDocument(context);
	const progress = document.createElement('div');
	progress.setAttribute('data-initial-load-progress', '');
	document.body.append(progress);

	applyDocumentRoute({ productId: 'soundscaper', locale: 'de', direction: 'ltr', embedded: true, desktop: true });

	assert.equal(progress.getAttribute('aria-label'), 'Projekt wird geladen');
	assert.equal(document.documentElement.lang, 'de');
	assert.equal(document.documentElement.dataset.embedded, 'true');
	assert.equal(document.documentElement.dataset.desktop, 'true');
});

test('a standalone browser route clears the marks a cached embedded document arrived with', (context) => {
	const document = installDocument(context);
	Object.assign(document.documentElement.dataset, { embedded: 'true', desktop: 'true' });

	applyDocumentRoute(route('soundscaper'));

	assert.equal(document.documentElement.dataset.embedded, undefined);
	assert.equal(document.documentElement.dataset.desktop, undefined);
});

function route(productId) {
	return { productId, locale: 'en', direction: 'ltr', embedded: false, desktop: false };
}

/** Every application-title meta the head holds, as the attributes it carries. */
function installTitles(document) {
	return document.querySelectorAll('meta[data-product-install-title]').map(attributesOf);
}

function attributesOf(element) {
	return Object.fromEntries(element.attributes);
}

/**
 * Install a fake document holding `tags`, and take it down again when the test
 * that asked for it ends. The rewrite reads the ambient `document`, exactly as
 * it does in a browser, so the global is what a test has to provide.
 */
function installDocument(context, tags = []) {
	const document = new FakeDocument();
	for (const [tagName, attributes] of tags) {
		const element = document.createElement(tagName);
		for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
		document.head.append(element);
	}
	// The theme the route paints is remembered in storage, which node exposes
	// only behind a flag; a stub keeps the rewrite under test from depending on
	// which of the two node was started with.
	const store = new Map();
	const localStorage = {
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => store.set(key, String(value)),
	};
	const prior = Object.entries({ document, localStorage })
		.map(([name, value]) => {
			const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
			Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
			return [name, descriptor];
		});
	context.after(() => {
		for (const [name, descriptor] of prior) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
	});
	return document;
}

class FakeElement {
	constructor(tagName) {
		this.tagName = tagName.toUpperCase();
		this.attributes = new Map();
		this.children = [];
		this.dataset = {};
		this.style = {};
		this.parent = null;
	}

	get isConnected() {
		return this.parent !== null;
	}

	append(...nodes) {
		for (const node of nodes) {
			node.parent = this;
			this.children.push(node);
		}
	}

	remove() {
		const at = this.parent?.children.indexOf(this) ?? -1;
		if (at >= 0) this.parent.children.splice(at, 1);
		this.parent = null;
	}

	setAttribute(name, value) {
		this.attributes.set(name, String(value));
	}

	getAttribute(name) {
		return this.attributes.get(name) ?? datasetValue(this, name) ?? null;
	}

	matches(selector) {
		const parsed = /^([a-z]*)(?:\[([^\]=]+)(?:="([^"]*)")?\])?$/u.exec(selector.trim());
		assert.ok(parsed, `unsupported selector ${selector}`);
		const [, tagName, attribute, value] = parsed;
		if (tagName && this.tagName !== tagName.toUpperCase()) return false;
		if (!attribute) return true;
		const held = this.getAttribute(attribute);
		if (held === null) return false;
		return value === undefined || held === value;
	}

	descendants() {
		return this.children.flatMap((child) => [child, ...child.descendants()]);
	}

	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}

	querySelectorAll(selector) {
		return this.descendants().filter((node) => node.matches(selector));
	}
}

class FakeDocument {
	constructor() {
		this.documentElement = new FakeElement('html');
		this.head = new FakeElement('head');
		this.body = new FakeElement('body');
		this.documentElement.append(this.head, this.body);
		this.documentElement.parent = this;
		this.title = 'Soundscaper';
	}

	createElement(tagName) {
		return new FakeElement(tagName);
	}

	querySelector(selector) {
		return this.documentElement.querySelector(selector);
	}

	querySelectorAll(selector) {
		return this.documentElement.querySelectorAll(selector);
	}
}

/** `link.dataset.productIcon = ''` is how the icon links mark themselves. */
function datasetValue(element, name) {
	if (!name.startsWith('data-')) return undefined;
	const key = name.slice(5).replace(/-(\w)/gu, (_match, letter) => letter.toUpperCase());
	return element.dataset[key];
}
