/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The document theme, in the browsers that refuse site data.
 *
 * The dark palette is reached only through `:root[data-theme='dark']`, so the
 * theme has to be painted whether or not the visit can be remembered. Reading
 * the stored preference and writing the last-active product used to share one
 * guard, so a private window - where the accessor throws rather than returning
 * nothing - left a visitor whose system asks for dark on the light palette.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyDocumentTheme,
	storeDocumentTheme,
} from '../src/common/site/document-theme.js';

interface FakeRoot {
	dataset: Record<string, string>;
	style: Record<string, string>;
}

function root(): FakeRoot {
	return { dataset: {}, style: {} };
}

function scope(options: Readonly<{
	stored?: Record<string, string>;
	prefersDark?: boolean;
	refuseWrites?: boolean;
	refuseReads?: boolean;
	refuseStorage?: boolean;
}> = {}) {
	const written: Record<string, string> = {};
	const localStorage = {
		getItem(key: string): string | null {
			if (options.refuseReads) throw new DOMException('The operation is insecure.', 'SecurityError');
			return options.stored?.[key] ?? null;
		},
		setItem(key: string, value: string): void {
			if (options.refuseWrites) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
			written[key] = value;
		},
	};
	return {
		written,
		scope: {
			get localStorage() {
				if (options.refuseStorage) throw new DOMException('The operation is insecure.', 'SecurityError');
				return localStorage;
			},
			matchMedia: (query: string) => ({ matches: query.includes('dark') && options.prefersDark === true }),
		},
	};
}

test('a refused write still paints the theme the system asks for', () => {
	const element = root();
	const { scope: refusing } = scope({ prefersDark: true, refuseWrites: true });

	const theme = applyDocumentTheme(element as unknown as HTMLElement, 'soundscaper', refusing as never);

	assert.equal(theme, 'dark');
	assert.equal(element.dataset.theme, 'dark', 'the dark palette is reached only through data-theme');
	assert.equal(element.style.colorScheme, 'dark');
});

test('a storage accessor that throws outright falls back to the system preference', () => {
	for (const prefersDark of [true, false]) {
		const element = root();
		const { scope: refusing } = scope({ prefersDark, refuseStorage: true });
		applyDocumentTheme(element as unknown as HTMLElement, 'framescaper', refusing as never);
		assert.equal(element.dataset.theme, prefersDark ? 'dark' : 'light');
	}
});

test('a stored preference wins over the system, per product then shared', () => {
	const perProduct = root();
	applyDocumentTheme(
		perProduct as unknown as HTMLElement,
		'framescaper',
		scope({ prefersDark: true, stored: { framescaper_theme: 'light' } }).scope as never,
	);
	assert.equal(perProduct.dataset.theme, 'light');

	const shared = root();
	applyDocumentTheme(
		shared as unknown as HTMLElement,
		'framescaper',
		scope({ stored: { soundscaper_theme: 'dark' } }).scope as never,
	);
	assert.equal(shared.dataset.theme, 'dark');

	const nonsense = root();
	applyDocumentTheme(
		nonsense as unknown as HTMLElement,
		'soundscaper',
		scope({ prefersDark: true, stored: { soundscaper_theme: 'aubergine' } }).scope as never,
	);
	assert.equal(nonsense.dataset.theme, 'dark', 'an unrecognized stored value is not a theme');
});

test('the visited product is remembered when storage accepts it', () => {
	const accepting = scope({ prefersDark: false });
	applyDocumentTheme(root() as unknown as HTMLElement, 'framescaper', accepting.scope as never);
	assert.equal(accepting.written.scape_last_active_product, 'framescaper');

	assert.equal(storeDocumentTheme('framescaper', 'dark', accepting.scope as never), true);
	assert.equal(accepting.written.framescaper_theme, 'dark');
});

test('storing a chosen theme reports refusal rather than throwing', () => {
	const refusing = scope({ refuseWrites: true });
	assert.equal(storeDocumentTheme('soundscaper', 'dark', refusing.scope as never), false);
	assert.deepEqual(refusing.written, {});
});
