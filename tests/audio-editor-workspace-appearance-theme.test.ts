/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which palette the editor paints, and where "system" gets its answer.
 *
 * The site paints a theme before the editor mounts: the visitor's stored
 * choice from the sidebar toggle, or the system preference when they have
 * made none. The editor's own appearance preference then paints over it, so
 * an appearance of "system" that consulted only the media query discarded a
 * stored choice on every load - the toggle appeared to do nothing at all
 * across a reload. The preferences dialog has always read "system" as
 * whatever the document already carries; this is the same reading.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWorkspaceAppearanceTheme } from '../src/common/editor/ui/workspace/useWorkspaceThemePreference.js';

function scope(options: Readonly<{ stored?: Record<string, string>; prefersDark?: boolean }> = {}) {
	return {
		localStorage: {
			getItem: (key: string) => options.stored?.[key] ?? null,
			setItem: () => undefined,
		},
		matchMedia: (query: string) => ({ matches: query.includes('dark') && options.prefersDark === true }),
	};
}

test('a system appearance keeps the theme the visitor chose from the sidebar', () => {
	assert.equal(
		resolveWorkspaceAppearanceTheme('system', 'soundscaper', scope({
			stored: { soundscaper_theme: 'dark' },
		}) as never),
		'dark',
	);
	assert.equal(
		resolveWorkspaceAppearanceTheme('system', 'framescaper', scope({
			prefersDark: true,
			stored: { framescaper_theme: 'light' },
		}) as never),
		'light',
	);
});

test('a system appearance still follows the system when nothing was chosen', () => {
	assert.equal(resolveWorkspaceAppearanceTheme('system', 'soundscaper', scope({ prefersDark: true }) as never), 'dark');
	assert.equal(resolveWorkspaceAppearanceTheme('system', 'soundscaper', scope() as never), 'light');
});

test('an explicit appearance overrides both, high contrast included', () => {
	const stored = scope({ stored: { soundscaper_theme: 'dark' }, prefersDark: true });
	assert.equal(resolveWorkspaceAppearanceTheme('light', 'soundscaper', stored as never), 'light');
	assert.equal(resolveWorkspaceAppearanceTheme('high-contrast-light', 'soundscaper', stored as never), 'light');
	assert.equal(resolveWorkspaceAppearanceTheme('dark', 'soundscaper', scope() as never), 'dark');
	assert.equal(resolveWorkspaceAppearanceTheme('high-contrast-dark', 'soundscaper', scope() as never), 'dark');
});
