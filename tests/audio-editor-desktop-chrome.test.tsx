/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AudioEditorWindowControls, {
	desktopChromeSupportsMenuAccessKeys,
	type AudioEditorDesktopChrome,
} from '../src/common/editor/ui/AudioEditorWindowControls.tsx';

const labels = Object.freeze({
	minimize: 'Minimize',
	maximize: 'Maximize',
	restore: 'Restore',
	quit: 'Quit',
});

function chrome(overrides: Partial<AudioEditorDesktopChrome> = {}): AudioEditorDesktopChrome {
	return {
		platform: 'win32',
		fullscreen: false,
		maximized: false,
		labels,
		onMinimize: () => {},
		onToggleMaximize: () => {},
		onQuit: () => {},
		...overrides,
	};
}

function render(desktopChrome: AudioEditorDesktopChrome | null): string {
	return renderToStaticMarkup(<AudioEditorWindowControls
		desktopChrome={desktopChrome}
		fullscreenLabel="Fullscreen"
		onFullscreen={() => {}}
	/>);
}

test('web chrome renders fullscreen without privileged window controls', () => {
	const markup = render(null);
	assert.match(markup, /aria-label="Fullscreen"/u);
	assert.doesNotMatch(markup, /data-desktop-window-controls/u);
	assert.doesNotMatch(markup, /aria-label="Minimize"/u);
});

test('desktop controls follow fullscreen in minimize, maximize, quit order', () => {
	const markup = render(chrome());
	const labelsInOrder = ['Fullscreen', 'Minimize', 'Maximize', 'Quit'];
	let cursor = -1;
	for (const label of labelsInOrder) {
		const next = markup.indexOf(`aria-label="${label}"`);
		assert.ok(next > cursor, `${label} must follow the previous title-bar control`);
		cursor = next;
	}
	assert.match(markup, /data-desktop-window-controls="true"/u);
	assert.match(markup, /data-window-control="maximize"/u);
});

test('maximized and fullscreen state project an accessible restore control', () => {
	const maximized = render(chrome({ maximized: true }));
	assert.match(maximized, /aria-label="Restore"/u);
	assert.match(maximized, /data-window-control="restore"/u);

	const fullscreen = render(chrome({ fullscreen: true, maximized: true }));
	assert.match(fullscreen, /aria-label="Restore"[^>]*disabled=""/u);
});

test('application-menu access keys are limited to Windows and Linux desktop chrome', () => {
	assert.equal(desktopChromeSupportsMenuAccessKeys('win32'), true);
	assert.equal(desktopChromeSupportsMenuAccessKeys('linux'), true);
	assert.equal(desktopChromeSupportsMenuAccessKeys('darwin'), false);
	assert.equal(desktopChromeSupportsMenuAccessKeys(undefined), false);
});

test('desktop routing owns a full-bleed shell and explicit drag exclusions', async () => {
	const [app, siteCss, editorCss] = await Promise.all([
		readFile(new URL('../src/common/site/App.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/site/site.css', import.meta.url), 'utf8'),
		readFile(new URL(
			'../src/common/editor/ui/audio-editor-design-system/31-desktop-chrome.css',
			import.meta.url,
		), 'utf8'),
	]);
	assert.match(app, /desktop \? ' desktop' : ''/u);
	assert.match(app, /root\.dataset\.desktop = 'true'/u);
	assert.match(siteCss, /\.site-shell\.desktop \.audio-editor-container/u);
	assert.match(siteCss, /\.site-shell\.desktop #kw-audio-editor-design-system/u);
	assert.match(editorCss, /app-region: drag/u);
	assert.match(editorCss, /app-region: no-drag/u);
});
