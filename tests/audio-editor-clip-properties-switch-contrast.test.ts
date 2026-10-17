/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import postcss from 'postcss';

import { resolveSkinTheme } from '../src/common/editor/ui/skins/skin-themes.ts';
import { wcagContrastRatio } from '../src/common/editor/ui/theme-contrast.ts';

test('the actual Reverse switch stylesheet keeps its thumb and track distinguishable in every theme', async () => {
	const css = postcss.parse(await readFile(new URL(
		'../vendor/audacity-design-system/components/src/ClipPropertiesPanel/ClipPropertiesPanel.css', import.meta.url,
	), 'utf8'));
	const declaration = (selector: string, property: string): string | undefined => {
		let value: string | undefined;
		css.walkRules((rule) => {
			if (rule.selectors.includes(selector)) rule.walkDecls(property, (decl) => { value = decl.value; });
		});
		return value;
	};
	const selector = '.clip-properties__switch';
	const checked = '.clip-properties__field--toggle[aria-checked="true"] ';
	for (const skin of ['default', 'sakura', 'lilac', 'techno'] as const) {
		for (const mode of ['light', 'dark'] as const) {
			const theme = resolveSkinTheme(skin, mode);
			const tokens: Readonly<Record<string, string>> = {
				'--text-secondary': theme.foreground.text.secondary,
				'--stage-raised': theme.background.surface.inset,
				'--accent': theme.accent.primary,
			};
			const resolve = (value: string | undefined): string => {
				assert.ok(value, 'the stylesheet defines the switch color');
				const token = /^var\((--[\w-]+),\s*([^)]*)\)$/u.exec(value);
				return token ? tokens[token[1]!] ?? token[2]! : value;
			};
			for (const state of ['off', 'on']) {
				const track = resolve((state === 'on' ? declaration(checked + selector, 'background') : undefined)
					?? declaration(selector, 'background'));
				const thumb = resolve((state === 'on' ? declaration(checked + selector + '::after', 'background') : undefined)
					?? declaration(selector + '::after', 'background'));
				const contrast = wcagContrastRatio(thumb, track);
				assert.ok(contrast >= 3, `${skin}/${mode}/${state}: thumb ${thumb} against track ${track} is ${contrast.toFixed(2)}:1`);
			}
		}
	}
});
