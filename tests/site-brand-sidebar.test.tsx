/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The site chrome around the editor: the brand rail every non-embedded route
 * renders.
 *
 * The sidebar is the only place a visitor changes workspace, theme, language
 * or reaches the privacy policy without entering the editor, and every one of
 * those is a side effect on a global - stored preferences, a dispatched window
 * event, a navigation. They are exercised here through the real component
 * rather than through the browser suite, which mounts the editor and cannot
 * observe a refused storage or a manifest that never answers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { LOCALE_BY_TAG } from '../src/common/i18n/locales.js';
import { MACHINE_CATALOG_LOCALES } from '../src/common/i18n/machine/index.js';
import BrandSidebar from '../src/common/site/BrandSidebar.jsx';
import { PRIVACY_POLICY_REQUEST_EVENT } from '../src/common/site/privacy-policy-links.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

interface ManifestLocale { readonly eligible?: boolean; readonly name?: string }

interface HarnessOptions {
	readonly stored?: Readonly<Record<string, string>>;
	readonly theme?: 'dark' | 'light';
	readonly refuseStorage?: boolean;
	readonly manifest?: { readonly locales?: Readonly<Record<string, ManifestLocale>> } | null;
}

/** Two turns settle the manifest promise chain the language picker starts. */
const settle = async (): Promise<void> => {
	for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
};

/**
 * Mount the sidebar over the shared fake DOM.
 *
 * That DOM is deliberately thin, so the three globals this component needs and
 * it does not carry - a dispatching window, a queryable document, and storage -
 * are added to the instances here rather than to the shared helper, where they
 * would change what every other mounted component sees.
 */
function harness(options: HarnessOptions = {}) {
	const dom = installReactTestDom();
	const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
	// The sidebar is a .jsx module, which compiles to the classic runtime here.
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	const priorFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

	const stored = new Map(Object.entries(options.stored ?? {}));
	const refuse = (): never => { throw new DOMException('The user denied site data.', 'SecurityError'); };
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string): string | null => (options.refuseStorage ? refuse() : stored.get(key) ?? null),
			setItem: (key: string, value: string): void => {
				if (options.refuseStorage) refuse();
				stored.set(key, value);
			},
		},
	});

	const requests: string[] = [];
	Object.defineProperty(globalThis, 'fetch', {
		configurable: true,
		value: (url: string): Promise<unknown> => {
			requests.push(String(url));
			if (!options.manifest) return Promise.resolve({ ok: false, status: 503 });
			return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(options.manifest) });
		},
	});

	const document = dom.container.ownerDocument;
	const root = document.documentElement;
	Object.assign(root, { dataset: { theme: options.theme ?? 'light' } });
	Object.assign(document, {
		querySelector: (selector: string): ReactTestElement | null => root.querySelector(selector),
		querySelectorAll: (selector: string): ReactTestElement[] => root.querySelectorAll(selector),
	});

	const listeners = new EventTarget();
	const navigations: string[] = [];
	const dispatched: Event[] = [];
	Object.assign(globalThis.window, {
		addEventListener: (type: string, listener: EventListener) => listeners.addEventListener(type, listener),
		removeEventListener: (type: string, listener: EventListener) => listeners.removeEventListener(type, listener),
		dispatchEvent: (event: Event): boolean => {
			dispatched.push(event);
			return listeners.dispatchEvent(event);
		},
		location: { protocol: 'http:', assign: (target: string) => { navigations.push(target); } },
	});

	let reactRoot: Root | null = null;
	return {
		dom,
		stored,
		requests,
		navigations,
		dispatched,
		root,
		/** Announce a workspace set the way the editor shell does once it has bound. */
		async announce(detail: unknown): Promise<void> {
			await act(async () => {
				listeners.dispatchEvent(new CustomEvent('scape:workspace-state', { detail }));
			});
		},
		async render(productId = 'soundscaper', locale = 'en'): Promise<void> {
			reactRoot ??= createRoot(dom.container as unknown as Element);
			await act(async () => {
				reactRoot?.render(React.createElement(BrandSidebar, { locale, productId }));
			});
		},
		async close(): Promise<void> {
			if (reactRoot) await act(async () => { reactRoot?.unmount(); });
			actEnvironment.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment;
			for (const [key, descriptor] of [
				['React', priorReact], ['localStorage', priorStorage], ['fetch', priorFetch],
			] as const) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
			dom.restore();
		},
	};
}

type Harness = ReturnType<typeof harness>;

/**
 * The locales the picker offers before any manifest answers: the two bundled
 * catalogs plus every locale a committed machine catalog serves, in the order
 * the picker sorts their names for an English visitor. Manifest-named extras
 * join the same ordering.
 */
function expectedLocaleOptions(extra: Readonly<Record<string, string>> = {}): string[] {
	const names = new Map<string, string>();
	for (const tag of ['en', 'de', ...MACHINE_CATALOG_LOCALES]) names.set(tag, LOCALE_BY_TAG[tag]!.nativeName);
	for (const [tag, name] of Object.entries(extra)) names.set(tag, name);
	return [...names.entries()]
		.sort(([, left], [, right]) => left.localeCompare(right, 'en'))
		.map(([tag]) => tag);
}

function optionValues(select: ReactTestElement): string[] {
	return select.querySelectorAll('option').map((option) => option.value);
}

function optionNames(select: ReactTestElement): string[] {
	return select.querySelectorAll('option').map((option) => option.textContent);
}

function press(node: ReactTestElement): unknown {
	return reactProps(node).onClick?.({});
}

async function change(node: ReactTestElement, value: string): Promise<void> {
	await act(async () => { reactProps(node).onChange?.({ target: { value } }); });
}

test('the sidebar offers the built product\'s workspaces and both installed languages', async () => {
	const context = harness();
	try {
		await context.render();
		const sidebar = context.dom.one('[data-sidebar]');
		assert.equal(sidebar.getAttribute('data-product'), 'soundscaper');
		assert.equal(sidebar.getAttribute('data-locale'), 'en');
		assert.equal(sidebar.getAttribute('data-collapsed'), 'false');
		// No workspace set has been announced, so the picker names the presets the
		// product ships with and refuses a choice that could not be honoured yet.
		const workspaces = context.dom.one('[data-workspace-select]');
		assert.deepEqual(optionValues(workspaces), ['modern', 'audacity', 'music', 'classic']);
		assert.ok(workspaces.hasAttribute('disabled'), 'an unbound editor offers a live workspace picker');
		const locales = optionValues(context.dom.one('[data-locale-select]'));
		assert.deepEqual(locales, expectedLocaleOptions());
		assert.ok(locales.includes('de') && locales.includes('en'), 'both bundled catalogs are offered');
	} finally {
		await context.close();
	}
});

test('a Framescaper rail names its own workspace and links across to the other origin', async () => {
	const context = harness();
	try {
		await context.render('framescaper');
		assert.deepEqual(optionValues(context.dom.one('[data-workspace-select]')), ['video-editor']);
		// This build serves Soundscaper, so the peer link is the absolute one.
		const [active, peer] = context.dom.one('.sidebar-nav').querySelectorAll('a');
		assert.equal(active?.getAttribute('href'), 'https://framescaper.org/en/');
		assert.equal(peer?.getAttribute('href'), '/en/');
	} finally {
		await context.close();
	}
});

test('the announced workspaces replace the presets and a choice is requested by event', async () => {
	const context = harness();
	try {
		await context.render();
		await context.announce({
			productId: 'soundscaper',
			activeId: 'audacity',
			// A name-less entry is not a workspace anyone could pick, so it is dropped
			// rather than rendered as a blank option.
			workspaces: [{ id: 'modern', name: 'Soundscaper' }, { id: 'audacity', name: 'Audacity' }, { id: 'broken' }],
		});
		const workspaces = context.dom.one('[data-workspace-select]');
		assert.deepEqual(optionValues(workspaces), ['modern', 'audacity']);
		assert.ok(!workspaces.hasAttribute('disabled'), 'an announced workspace set is still unpickable');
		await change(workspaces, 'modern');
		const request = context.dispatched.at(-1) as CustomEvent<{ productId: string; workspaceId: string }>;
		assert.equal(request.type, 'scape:workspace-request');
		assert.deepEqual(request.detail, { productId: 'soundscaper', workspaceId: 'modern' });
	} finally {
		await context.close();
	}
});

test('a workspace set announced for the other product is ignored', async () => {
	const context = harness();
	try {
		await context.render();
		await context.announce({ productId: 'framescaper', activeId: 'video-editor', workspaces: [{ id: 'video-editor', name: 'Video' }] });
		assert.deepEqual(optionValues(context.dom.one('[data-workspace-select]')), ['modern', 'audacity', 'music', 'classic']);
	} finally {
		await context.close();
	}
});

test('the collapsed rail is remembered per product and falls back to the shared key', async () => {
	const context = harness({ stored: { soundscaper_sidebar_collapsed: 'true' } });
	try {
		// Framescaper has never been collapsed on this machine, so it inherits the
		// choice the visitor made before the products were told apart.
		await context.render('framescaper');
		assert.equal(context.dom.one('[data-sidebar]').getAttribute('data-collapsed'), 'true');
		await act(async () => { press(context.dom.one('[data-sidebar-collapse]')); });
		assert.equal(context.dom.one('[data-sidebar]').getAttribute('data-collapsed'), 'false');
		assert.equal(context.stored.get('framescaper_sidebar_collapsed'), 'false');
	} finally {
		await context.close();
	}
});

test('a browser that refuses site data still renders an expanded rail', async () => {
	const context = harness({ refuseStorage: true });
	try {
		await context.render();
		assert.equal(context.dom.one('[data-sidebar]').getAttribute('data-collapsed'), 'false');
		// The press must still fold the rail: only the remembering is refused.
		await act(async () => { press(context.dom.one('[data-sidebar-collapse]')); });
		assert.equal(context.dom.one('[data-sidebar]').getAttribute('data-collapsed'), 'true');
	} finally {
		await context.close();
	}
});

test('the theme toggle paints the document root and stores the choice', async () => {
	const context = harness({ theme: 'dark' });
	try {
		await context.render();
		const toggle = context.dom.one('[data-theme-toggle]');
		assert.equal(toggle.getAttribute('aria-pressed'), 'true');
		await act(async () => { press(toggle); });
		assert.equal(context.dom.one('[data-theme-toggle]').getAttribute('aria-pressed'), 'false');
		assert.equal((context.root as unknown as { dataset: Record<string, string> }).dataset.theme, 'light');
		assert.equal(context.stored.get('soundscaper_theme'), 'light');
	} finally {
		await context.close();
	}
});

test('the language picker navigates to a served locale and ignores anything else', async () => {
	const context = harness();
	try {
		await context.render();
		const locales = context.dom.one('[data-locale-select]');
		await change(locales, 'de');
		assert.deepEqual(context.navigations, ['/de/']);
		await change(locales, 'kl');
		assert.deepEqual(context.navigations, ['/de/']);
	} finally {
		await context.close();
	}
});

test('opening the picker names the locales the translation manifest declares eligible', async () => {
	const context = harness({
		manifest: {
			locales: {
				fr: { eligible: true, name: '  Français  ' },
				// Declared but not deployed, ineligible, and not a descriptor at all:
				// none of the three may reach the picker through the manifest (a
				// committed machine catalog offers its locale on its own).
				kl: { eligible: true, name: 'Kalaallisut' },
				ja: { eligible: false, name: '日本語' },
				ko: { eligible: true },
			},
		},
	});
	try {
		await context.render();
		const locales = context.dom.one('[data-locale-select]');
		await act(async () => {
			reactProps(locales).onFocus?.({});
			await settle();
		});
		assert.equal(context.requests.length, 1);
		assert.match(context.requests[0]!, /\/latest\.json$/u);
		const picker = context.dom.one('[data-locale-select]');
		assert.deepEqual(optionValues(picker), expectedLocaleOptions({ fr: 'Français' }));
		assert.ok(!optionValues(picker).includes('kl'));
		assert.ok(optionNames(picker).includes('Français'), 'the manifest name reaches the picker untrimmed');
	} finally {
		await context.close();
	}
});

test('a refused manifest leaves the shipped languages alone', async () => {
	const context = harness({ manifest: null });
	try {
		await context.render();
		const locales = context.dom.one('[data-locale-select]');
		await act(async () => {
			reactProps(locales).onPointerDown?.({});
			await settle();
		});
		assert.equal(context.requests.length, 1);
		assert.deepEqual(optionValues(context.dom.one('[data-locale-select]')), expectedLocaleOptions());
	} finally {
		await context.close();
	}
});

test('the legal link opens the dialog in place once an editor is bound', async () => {
	const context = harness();
	try {
		await context.render();
		const legal = context.dom.one('[data-sidebar]').querySelectorAll('a')
			.find((anchor) => anchor.getAttribute('href')?.includes('/privacy/'));
		assert.ok(legal);
		// Nothing has bound yet, so the anchor is left to navigate on its own.
		let prevented = 0;
		reactProps(legal).onClick?.({ button: 0, preventDefault: () => { prevented += 1; } });
		assert.equal(prevented, 0);
		assert.equal(context.dispatched.filter((event) => event.type === PRIVACY_POLICY_REQUEST_EVENT).length, 0);

		bind(context);
		reactProps(legal).onClick?.({ button: 0, preventDefault: () => { prevented += 1; } });
		assert.equal(prevented, 1);
		const opened = context.dispatched.at(-1) as CustomEvent<{ productId: string }>;
		assert.equal(opened.type, PRIVACY_POLICY_REQUEST_EVENT);
		assert.deepEqual(opened.detail, { productId: 'soundscaper' });

		// A modified press is a deliberate request for a second tab, and the
		// in-place dialog would swallow it.
		reactProps(legal).onClick?.({ button: 0, metaKey: true, preventDefault: () => { prevented += 1; } });
		reactProps(legal).onClick?.({ button: 1, preventDefault: () => { prevented += 1; } });
		assert.equal(prevented, 1);
	} finally {
		await context.close();
	}
});

/** Mark the document the way the editor shell does once its surface is live. */
function bind(context: Harness): void {
	const bound = context.dom.container.ownerDocument.createElement('div');
	bound.setAttribute('data-audio-editor-bound', 'true');
	context.dom.container.appendChild(bound);
}
