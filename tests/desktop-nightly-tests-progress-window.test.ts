/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createDesktopNightlyTestsProgressWindow,
} from '../desktop/nightly-tests-progress-window.mjs';

test('the attended nightly runner opens a locked-down visible progress window', async () => {
	const observed = {
		file: '', options: null as Record<string, unknown> | null, shown: 0,
		titles: [] as string[], bars: [] as Array<[number, unknown]>, scripts: [] as string[],
	};
	class FakeWindow {
		webContents = {
			executeJavaScript: async (source: string) => { observed.scripts.push(source); },
			setWindowOpenHandler: () => undefined,
			on: () => undefined,
		};
		constructor(options: Record<string, unknown>) { observed.options = options; }
		async loadFile(file: string) { observed.file = file; }
		show() { observed.shown += 1; }
		setTitle(title: string) { observed.titles.push(title); }
		setProgressBar(value: number, ...options: unknown[]) {
			assert.ok(options.length === 0 || options[0] !== undefined, 'omit absent native options');
			observed.bars.push([value, options[0]]);
		}
		isDestroyed() { return false; }
		destroy() { throw new Error('must not destroy a loaded window'); }
	}

	const window = await createDesktopNightlyTestsProgressWindow({
		BrowserWindow: FakeWindow,
		initialProgress: { completed: 0, total: 4, label: 'Application launched' },
	});
	window.update({ completed: 1, total: 4, label: 'Performance diagnostics' });
	window.finish({ completed: 4, total: 4, label: 'Tests passed' }, 'passed');

	assert.match(observed.file, /nightly-tests-progress\.html$/u);
	assert.equal(observed.options?.show, false);
	assert.equal(observed.options?.closable, false);
	assert.deepEqual(observed.options?.webPreferences, {
		nodeIntegration: false,
		contextIsolation: true,
		sandbox: true,
		webSecurity: true,
		allowRunningInsecureContent: false,
		webviewTag: false,
		devTools: false,
	});
	assert.equal(observed.shown, 1);
	assert.deepEqual(observed.bars, [[0, undefined], [0.25, undefined], [1, { mode: 'normal' }]]);
	assert.equal(observed.titles.at(-1), 'Soundscaper Nightly Tests — Tests passed');
	assert.match(observed.scripts.at(-1) ?? '', /"label":"Tests passed"/u);
});

test('the progress document is self-contained, script-restricted, and visibly explains the run', async () => {
	const root = new URL('../desktop/', import.meta.url);
	const [html, renderer, stylesheet] = await Promise.all([
		readFile(new URL('nightly-tests-progress.html', root), 'utf8'),
		readFile(new URL('nightly-tests-progress-renderer.js', root), 'utf8'),
		readFile(new URL('nightly-tests-progress.css', root), 'utf8'),
	]);

	assert.match(html, /Content-Security-Policy[^>]+script-src 'self'/u);
	assert.match(html, /<progress[^>]+max="4"/u);
	assert.match(html, /Application launched/u);
	assert.match(html, /nightly-tests-progress-renderer\.js/u);
	assert.match(html, /nightly-tests-progress\.css/u);
	assert.match(renderer, /renderNightlyTestsProgress/u);
	assert.match(stylesheet, /progress/u);
});

test('a native taskbar error cannot prevent the window from showing its current phase', async () => {
	const errors: unknown[] = [];
	const scripts: string[] = [];
	let shown = false;
	class TaskbarFailureWindow {
		webContents = {
			executeJavaScript: async (source: string) => { scripts.push(source); },
			setWindowOpenHandler: () => undefined, on: () => undefined,
		};
		async loadFile() {}
		show() { shown = true; }
		setTitle() {}
		setProgressBar() { throw new Error('Native taskbar API failed'); }
		isDestroyed() { return false; }
		destroy() {}
	}
	const window = await createDesktopNightlyTestsProgressWindow({
		BrowserWindow: TaskbarFailureWindow,
		initialProgress: { completed: 0, total: 4, label: 'Application launched' },
		onError: (error) => { errors.push(error); },
	});
	window.update({ completed: 1, total: 4, label: 'Performance diagnostics' });
	assert.equal(shown, true);
	assert.equal(errors.length, 2);
	assert.match(scripts.at(-1) ?? '', /Performance diagnostics/u);
});
