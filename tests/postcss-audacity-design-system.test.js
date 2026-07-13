import test from 'node:test';
import assert from 'node:assert/strict';

import postcss from 'postcss';

import scopeAudacityDesignSystemCss from '../scripts/postcss-audacity-design-system.mjs';

const PACKAGE_CSS = '/workspace/node_modules/@dilsonspickles/components/dist/style.css';

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
	assert.match(result.css, /html\[data-theme="dark"\] body\.kw-audio-editor-design-system-mounted/);
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
