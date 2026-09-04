/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { darkTheme, lightTheme } from '@audacity-ui/tokens';

import { readablePrimaryButtonText } from '../src/common/editor/ui/DesignSystemRuntime.jsx';
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

test('the primary button label clears AA on the resting and hovered fill in both themes', () => {
	// The editor overrides the vendored button label colour, and pointing that
	// override at the inverse token unconditionally painted white text on the
	// light theme's pale blue fill — 2.02:1, which the accessibility scan of
	// every dialog that grew a shared footer reported as a serious violation.
	for (const { name, theme } of THEMES) {
		const label = readablePrimaryButtonText(theme);
		const primary = theme.background.control.button.primary;
		for (const { state, fill } of [
			{ state: 'idle', fill: primary.idle },
			{ state: 'hover', fill: primary.hover },
		]) {
			const ratio = wcagContrastRatio(label, fill);
			assert.ok(ratio >= 4.5, `${name} ${state}: ${label} on ${fill} is ${ratio.toFixed(2)}:1`);
		}
	}
});

test('the primary button label is the best the token pair offers on the pressed fill too', () => {
	// Button.css swaps the fill for :hover and :active but keeps painting the
	// label from one variable, so the pressed state is shown in the same colour
	// the idle state chose. The dark theme's pressed blue (#3a7bc8) is the one
	// fill no text token clears AA on — the chosen #1a1b1e reaches 3.98:1 and
	// the alternative #e4e5e7 only 3.44:1 — so what is asserted for every fill
	// is that nothing in the pair reads better on it. Clearing AA there needs
	// the pressed token itself retuned, not a different label colour.
	for (const { name, theme } of THEMES) {
		const label = readablePrimaryButtonText(theme);
		const primary = theme.background.control.button.primary;
		const candidates = [theme.foreground.text.primary, theme.foreground.text.inverse];
		for (const { state, fill } of [
			{ state: 'idle', fill: primary.idle },
			{ state: 'hover', fill: primary.hover },
			{ state: 'active', fill: primary.active },
		]) {
			const ratio = wcagContrastRatio(label, fill);
			for (const candidate of candidates) {
				const alternative = wcagContrastRatio(candidate, fill);
				assert.ok(
					ratio >= alternative,
					`${name} ${state}: ${label} is ${ratio.toFixed(2)}:1 on ${fill}, ${candidate} reads ${alternative.toFixed(2)}:1`,
				);
			}
		}
	}
});

test('the primary button label is chosen for the worst fill, not for the idle one', () => {
	// A palette where reading the idle fill alone gives the wrong answer: white
	// clears AA on the dark idle fill and then collapses to 1.66:1 on the pale
	// pressed fill, while black never drops below 1.99:1 across the three.
	const primary = { idle: '#3f3f3f', hover: '#9c9c9c', active: '#c9c9c9' };
	const theme = {
		background: { control: { button: { primary } } },
		foreground: { text: { primary: '#ffffff', inverse: '#000000' } },
	};
	assert.equal(readableTextColor(primary.idle, ['#ffffff', '#000000']), '#ffffff');
	assert.equal(readablePrimaryButtonText(theme), '#000000');
});

test('the runtime publishes the primary button label by measurement, not by name', async () => {
	const runtime = await readFile(RUNTIME, 'utf8');
	assert.match(runtime, /'--kw-editor-primary-button-text':\s*readablePrimaryButtonText\(/u);
});
