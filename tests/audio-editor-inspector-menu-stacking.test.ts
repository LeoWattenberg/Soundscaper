/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import postcss from 'postcss';

async function styles() {
	const names = ['01-tokens-base', '02-overlays-search', '04-shell-workspace', '04b-video-workspace'];
	const sheets = await Promise.all(names.map(async name => postcss.parse(await readFile(new URL(
		`../src/common/editor/ui/audio-editor-design-system/${name}.css`, import.meta.url,
	), 'utf8'))));
	const declaration = (selector: string, property: string) => {
		let value: string | undefined;
		for (const sheet of sheets) sheet.walkRules(rule => {
			if (rule.selectors.includes(selector)) rule.walkDecls(property, item => { value = item.value; });
		});
		return value;
	};
	const zIndex = (selector: string): number => {
		const value = declaration(selector, 'z-index');
		assert.ok(value, `${selector} has an explicit stacking owner`);
		const token = /^var\((--[a-z-]+)\)$/u.exec(value);
		const result = Number(token ? declaration('#kw-audio-editor-design-system', token[1]!) : value);
		assert.ok(Number.isFinite(result), `${selector} resolves to a finite editor layer`);
		return result;
	};
	return { declaration, zIndex };
}

test('an open Clip properties menu raises its workspace above the sibling Source monitor', async () => {
	const { zIndex } = await styles();
	const workspace = '.kw-audio-editor__workspace';
	const videoWorkspace = '.kw-audio-editor__video-workspace';
	const active = workspace + ':has([data-upstream-clip-properties] .context-menu)';
	assert.ok(zIndex(workspace) < zIndex(videoWorkspace), 'the closed workspace keeps its existing video monitor ordering');
	assert.ok(zIndex(active) > zIndex(videoWorkspace),
		'a menu child cannot escape z-index 0 while the Source ruler is in its sibling at z-index 1');
});

test('the temporary inspector layer leaves the video workspace owner unchanged', async () => {
	const { declaration, zIndex } = await styles();
	const workspace = '.kw-audio-editor__workspace';
	const videoWorkspace = '.kw-audio-editor__video-workspace';
	const active = workspace + ':has([data-upstream-clip-properties] .context-menu)';
	assert.equal(declaration(active, 'z-index'), 'var(--flyout-z)', 'the scoped owner uses the established editor layer');
	assert.ok(zIndex(active) > zIndex(workspace), 'the temporary menu ordering ends when its DOM is retired');
	assert.equal(zIndex(videoWorkspace), 1);
	assert.equal(declaration(videoWorkspace + ':has([data-upstream-clip-properties] .context-menu)', 'z-index'), undefined);
});
