import assert from 'node:assert/strict';
import test from 'node:test';
import { appearancePreview } from '../src/common/editor/ui/skins/appearance-previews.ts';
import { resolveSkinTheme } from '../src/common/editor/ui/skins/skin-themes.ts';

for (const skin of ['default', 'sakura', 'lilac', 'techno'] as const) {
	for (const mode of ['light', 'dark'] as const) test(`${skin}/${mode} previews the actual surface, text and accent tokens`, () => {
		const svg = decodeURIComponent(appearancePreview(skin, mode).split(',')[1]!);
		const theme = resolveSkinTheme(skin, mode);
		for (const color of [theme.background.surface.default, theme.foreground.text.primary, theme.accent.primary]) {
			assert.ok(svg.includes(color));
		}
		assert.ok(svg.includes('viewBox="0 0 88 64"'));
	});
}
test('high contrast samples use high contrast colors independently of the skin', () => {
	for (const mode of ['light', 'dark'] as const) {
		assert.equal(appearancePreview('sakura', mode, true), appearancePreview('default', mode, true));
	}
});
