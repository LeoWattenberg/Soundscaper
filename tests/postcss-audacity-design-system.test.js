import test from 'node:test';
import assert from 'node:assert/strict';

import postcss from 'postcss';

import layerAudacityDesignSystemCss, {
	getLayeredDesignSystemFileCount,
	getLayeredDesignSystemFiles,
	isDesignSystemCssFile,
	resetLayeredDesignSystemFileCount,
} from '../scripts/postcss-audacity-design-system.mjs';

const PACKAGE_CSS = '/workspace/vendor/audacity-design-system/components/src/Dropdown/Dropdown.css';

test('design-system selectors stay global inside their base cascade layer', async () => {
	const input = `
:root { --surface: white; }
.button, :is(.menu, [data-label="a,b"]) { color: black; }
.dropdown__menu, .dropdown__option:hover { background: white; }
.tooltip__content { color: black; }
@font-face { font-family: MuseScoreIcon; src: url(./MusescoreIcon.ttf); }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }
`;
	const result = await postcss([layerAudacityDesignSystemCss()]).process(input, {
		from: PACKAGE_CSS,
	});
	const layer = result.root.first;
	assert.equal(layer.type, 'atrule');
	assert.equal(layer.name, 'layer');
	assert.equal(layer.params, 'design-system');
	assert.equal(layer.nodes.map((node) => node.toString()).join('\n'), postcss.parse(input).nodes.map((node) => node.toString()).join('\n'));
	assert.doesNotMatch(result.css, /#kw-audio-editor-design-system|design-system-mounted/u);
});

test('the layer transform leaves non-package CSS untouched', async () => {
	const input = ':root { color: red; } .button { color: blue; }';
	const result = await postcss([layerAudacityDesignSystemCss()]).process(input, {
		from: '/workspace/src/styles/global.css',
	});

	assert.equal(result.css, input);
});

test('the layered-file counter tracks only design-system stylesheets', async () => {
	resetLayeredDesignSystemFileCount();
	const plugin = layerAudacityDesignSystemCss();
	await postcss([plugin]).process('.a { color: red; }', { from: PACKAGE_CSS });
	await postcss([plugin]).process('.b { color: red; }', {
		from: '/workspace/vendor/audacity-design-system/tokens/src/anything.css',
	});
	await postcss([plugin]).process('.c { color: red; }', {
		from: '/workspace/src/styles/global.css',
	});

	assert.equal(getLayeredDesignSystemFileCount(), 2);
	assert.deepEqual(getLayeredDesignSystemFiles(), [
		'/workspace/vendor/audacity-design-system/components/src/Dropdown/Dropdown.css',
		'/workspace/vendor/audacity-design-system/tokens/src/anything.css',
	]);
	assert.equal(isDesignSystemCssFile(`${PACKAGE_CSS}?used`), true);
	assert.equal(isDesignSystemCssFile(PACKAGE_CSS.replace(/\.css$/u, '.tsx')), false);
	assert.equal(isDesignSystemCssFile('/workspace/src/styles/global.css'), false);
	resetLayeredDesignSystemFileCount();
	assert.equal(getLayeredDesignSystemFileCount(), 0);
	assert.deepEqual(getLayeredDesignSystemFiles(), []);
});
