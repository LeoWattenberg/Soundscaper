import test from 'node:test';
import assert from 'node:assert/strict';

import postcss from 'postcss';

import scopeAudacityDesignSystemCss, {
	getScopedDesignSystemFileCount,
	getScopedDesignSystemFiles,
	isDesignSystemCssFile,
	resetScopedDesignSystemFileCount,
} from '../scripts/postcss-audacity-design-system.mjs';

const PACKAGE_CSS = '/workspace/vendor/audacity-design-system/components/src/Dropdown/Dropdown.css';

test('design-system CSS is isolated to the editor and its body portals', async () => {
	const input = `
:root { --surface: white; }
.button, :is(.menu, [data-label="a,b"]) { color: black; }
.dropdown__menu, .dropdown__option:hover { background: white; }
.tooltip__content { color: black; }
@font-face { font-family: MuseScoreIcon; src: url(./MusescoreIcon.ttf); }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }
`;
	const result = await postcss([scopeAudacityDesignSystemCss()]).process(input, {
		from: PACKAGE_CSS,
	});

	assert.match(result.css, /#kw-audio-editor-design-system\s*\{\s*--surface:/);
	assert.match(result.css, /#kw-audio-editor-design-system \.button/);
	assert.match(result.css, /#kw-audio-editor-design-system :is\(\.menu, \[data-label="a,b"\]\)/);
	assert.match(result.css, /body\.kw-audio-editor-design-system-mounted \.dropdown__menu/);
	assert.match(result.css, /body\.kw-audio-editor-design-system-mounted \.tooltip__content/);
	// Dark-theme portal palettes are app-owned CSS now
	// (src/common/editor/ui/audio-editor-design-system/24-portal-dark-theme.css),
	// so the plugin must no longer append them.
	assert.doesNotMatch(result.css, /html\[data-theme="dark"\]/);
	assert.match(result.css, /@font-face\s*\{\s*font-family: MuseScoreIcon/);
	assert.match(result.css, /@keyframes pulse\s*\{\s*from\s*\{/);
	assert.doesNotMatch(result.css, /#kw-audio-editor-design-system from/);
});

test('the prefix transform leaves non-package CSS untouched', async () => {
	const input = ':root { color: red; } .button { color: blue; }';
	const result = await postcss([scopeAudacityDesignSystemCss()]).process(input, {
		from: '/workspace/src/styles/global.css',
	});

	assert.equal(result.css, input);
});

test('the scoped-file counter tracks only design-system stylesheets', async () => {
	resetScopedDesignSystemFileCount();
	const plugin = scopeAudacityDesignSystemCss();
	await postcss([plugin]).process('.a { color: red; }', { from: PACKAGE_CSS });
	await postcss([plugin]).process('.b { color: red; }', {
		from: '/workspace/vendor/audacity-design-system/tokens/src/anything.css',
	});
	await postcss([plugin]).process('.c { color: red; }', {
		from: '/workspace/src/styles/global.css',
	});

	assert.equal(getScopedDesignSystemFileCount(), 2);
	assert.deepEqual(getScopedDesignSystemFiles(), [
		'/workspace/vendor/audacity-design-system/components/src/Dropdown/Dropdown.css',
		'/workspace/vendor/audacity-design-system/tokens/src/anything.css',
	]);
	assert.equal(isDesignSystemCssFile(`${PACKAGE_CSS}?used`), true);
	assert.equal(isDesignSystemCssFile(PACKAGE_CSS.replace(/\.css$/u, '.tsx')), false);
	assert.equal(isDesignSystemCssFile('/workspace/src/styles/global.css'), false);
	resetScopedDesignSystemFileCount();
	assert.equal(getScopedDesignSystemFileCount(), 0);
	assert.deepEqual(getScopedDesignSystemFiles(), []);
});
