import assert from 'node:assert/strict';
import test from 'node:test';
import { appearancePreview } from '../src/common/editor/ui/skins/appearance-previews.ts';
import { resolveSkinTheme } from '../src/common/editor/ui/skins/skin-themes.ts';

function previewColors(svg: string) {
	return {
		background: /<rect width="88" height="64" rx="2" fill="([^"]+)"\/>/u.exec(svg)?.[1],
		text: /<g fill="([^"]+)">/u.exec(svg)?.[1],
		accent: /<rect x="52" y="48" width="32" height="12" rx="2" fill="([^"]+)"/u.exec(svg)?.[1],
	};
}

for (const skin of ['default', 'sakura', 'lilac', 'techno'] as const) {
	for (const mode of ['light', 'dark'] as const) test(`${skin}/${mode} previews the actual surface, text and accent tokens`, () => {
		const svg = decodeURIComponent(appearancePreview(skin, mode).split(',')[1]!);
		const theme = resolveSkinTheme(skin, mode);
		assert.deepEqual(previewColors(svg), {
			background: theme.background.surface.default,
			text: theme.foreground.text.primary,
			accent: theme.accent.primary,
		});
		assert.ok(svg.includes('viewBox="0 0 88 64"'));
	});
}
test('the high contrast skin previews black and white in both modes', () => {
	for (const mode of ['light', 'dark'] as const) {
		const svg = decodeURIComponent(appearancePreview('high-contrast', mode).split(',')[1]!);
		assert.deepEqual(previewColors(svg), {
			background: mode === 'dark' ? '#000' : '#fff',
			text: mode === 'dark' ? '#fff' : '#000',
			accent: mode === 'dark' ? '#fff' : '#000',
		});
		assert.notEqual(appearancePreview('high-contrast', mode), appearancePreview('default', mode));
	}
});
