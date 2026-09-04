/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { darkTheme, lightTheme } from '@audacity-ui/tokens';

import { readableTextColor, relativeLuminance, wcagContrastRatio } from '../src/common/editor/ui/theme-contrast.ts';

const RUNTIME = new URL('../src/common/editor/ui/DesignSystemRuntime.jsx', import.meta.url);
const THEMES = Object.freeze([
	{ name: 'light', theme: lightTheme },
	{ name: 'dark', theme: darkTheme },
]);

test('contrast is measured the way WCAG defines it', () => {
	assert.equal(relativeLuminance('#000000'), 0);
	assert.equal(relativeLuminance('#ffffff'), 1);
	assert.equal(Math.round(wcagContrastRatio('#000000', '#ffffff')), 21);
	assert.equal(wcagContrastRatio('#000', '#000000'), 1);
	// A colour the tokens could never carry is unreadable rather than a wrong number.
	assert.equal(wcagContrastRatio('rgb(0 0 0)', '#ffffff'), 0);
});

test('the primary button label clears AA against its fill in both themes', () => {
	// The editor overrides the vendored button label colour, and pointing that
	// override at the inverse token unconditionally painted white text on the
	// light theme's pale blue fill — 2.02:1, which the accessibility scan of
	// every dialog that grew a shared footer reported as a serious violation.
	for (const { name, theme } of THEMES) {
		const fill = theme.background.control.button.primary.idle;
		const label = readableTextColor(fill, [theme.foreground.text.primary, theme.foreground.text.inverse]);
		assert.ok(
			wcagContrastRatio(label, fill) >= 4.5,
			`${name}: ${label} on ${fill} is ${wcagContrastRatio(label, fill).toFixed(2)}:1`,
		);
	}
});

test('the runtime publishes the primary button label by measurement, not by name', async () => {
	const runtime = await readFile(RUNTIME, 'utf8');
	assert.match(runtime, /'--kw-editor-primary-button-text':\s*readableTextColor\(/u);
});
