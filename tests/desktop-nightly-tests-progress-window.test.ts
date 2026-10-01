/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
	createDesktopNightlyTestsProgressUpdateSource,
	createDesktopNightlyTestsProgressWindow,
	NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL,
	NIGHTLY_TESTS_PROGRESS_SCHEME,
	validateDesktopNightlyTestsProgressUpdateSource,
} from '../desktop/nightly-tests-progress-window.mjs';

test('the attended nightly runner opens a locked-down visible progress window', async () => {
	const observed = {
		url: '', options: null as Record<string, unknown> | null, shown: 0,
		titles: [] as string[], bars: [] as Array<[number, unknown]>, scripts: [] as string[],
	};
	const protocol = protocolFixture();
	let closed = () => undefined;
	let navigate = (_event: { preventDefault(): void }, _url: string) => undefined;
	class FakeWindow {
		webContents = {
			executeJavaScript: async (source: string) => { observed.scripts.push(source); },
			setWindowOpenHandler: () => undefined,
			on: (_event: string, listener: typeof navigate) => { navigate = listener; },
		};
		constructor(options: Record<string, unknown>) { observed.options = options; }
		async loadURL(url: string) {
			observed.url = url;
			assert.equal(protocol.request(url).status, 200, 'serve the document before navigation');
		}
		once(_event: string, listener: () => undefined) { closed = listener; }
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
		protocol,
		initialProgress: { completed: 0, total: 6, label: 'Application launched' },
	});
	window.update({ completed: 2, total: 6, label: 'Performance diagnostics' });
	window.finish({ completed: 6, total: 6, label: 'Tests passed' }, 'passed');

	assert.equal(observed.url, NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL);
	assert.equal(protocol.scheme, NIGHTLY_TESTS_PROGRESS_SCHEME);
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
	assert.deepEqual(observed.bars, [[0, undefined], [1 / 3, undefined], [1, { mode: 'normal' }]]);
	assert.equal(observed.titles.at(-1), 'Soundscaper Nightly Tests — Tests passed');
	const lastSource = observed.scripts.at(-1) ?? '';
	assert.match(lastSource, /"label":"Tests passed"/u);
	assert.match(lastSource,
		/\/\/# sourceURL=soundscaper-nightly-progress:\/\/runner\/__e2e-excluded__\/nightly-progress-update-v1-[a-f\d]{64}\.js$/u);
	assert.deepEqual(validateDesktopNightlyTestsProgressUpdateSource(lastSource), {
		completed: 6, total: 6, label: 'Tests passed',
	});
	let prevented = 0;
	const event = { preventDefault: () => { prevented += 1; } };
	navigate(event, observed.url);
	navigate(event, 'https://example.org/');
	assert.equal(prevented, 1);
	closed();
	assert.deepEqual(protocol.removed, [NIGHTLY_TESTS_PROGRESS_SCHEME]);
});

test('nightly progress updates are a closed data-only named recipe', () => {
	const progress = { completed: 1, total: 4, label: 'Phase <one>\u2028' };
	const source = createDesktopNightlyTestsProgressUpdateSource(progress);
	assert.deepEqual(validateDesktopNightlyTestsProgressUpdateSource(source), progress);
	assert.doesNotMatch(source, /<one>/u);
	assert.match(source, /\\u003cone>/u);
	assert.match(source, /\\u2028/u);
	assert.throws(() => validateDesktopNightlyTestsProgressUpdateSource(
		source.replace('\n//# sourceURL=', '\nvoid 0;\n//# sourceURL='),
	), /attestation failed|closed recipe/u);
	assert.throws(() => validateDesktopNightlyTestsProgressUpdateSource(`${source}\nvoid 0;`),
		/no canonical source URL/u);
	assert.throws(() => createDesktopNightlyTestsProgressUpdateSource({
		...progress, label: 'Phase', sourceURL: 'https://unexpected.invalid/',
	}), /progress/u);
});

test('the progress document is self-contained, script-restricted, and visibly explains the run', async () => {
	const root = new URL('../desktop/', import.meta.url);
	const [html, renderer, stylesheet] = await Promise.all([
		readFile(new URL('nightly-tests-progress.html', root), 'utf8'),
		readFile(new URL('nightly-tests-progress-renderer.js', root), 'utf8'),
		readFile(new URL('nightly-tests-progress.css', root), 'utf8'),
	]);

	assert.match(html, /Content-Security-Policy[^>]+script-src 'self'/u);
	assert.match(html, /<progress[^>]+max="6"/u);
	for (const label of [
		'Browser tests',
		'Dual-origin browser coverage',
		'Performance diagnostics',
		'Packaged app diagnostics',
		'Packaged app coverage',
		'Local model tests',
	]) assert.match(html, new RegExp(`>${label}<`, 'u'));
	assert.match(html, /Application launched/u);
	assert.match(html, /nightly-tests-progress-renderer\.js/u);
	assert.match(html, /nightly-tests-progress\.css/u);
	assert.match(renderer, /renderNightlyTestsProgress/u);
	assert.match(stylesheet, /progress/u);
});

test('the progress renderer keeps every phase determinate while preparing tests', async () => {
	const { render, elements, bar } = await rendererFixture();
	render({ completed: 2, total: 6, label: 'Performance diagnostics' });

	assert.equal(bar('phase-progress-0').value, 1);
	assert.equal(bar('phase-progress-1').value, 1);
	assert.equal(bar('phase-progress-2').value, 0);
	assert.equal(bar('phase-progress-2').hasAttribute('value'), true);
	assert.equal(bar('phase-progress-3').value, 0);
	assert.equal(elements.get('phase-count-2')?.textContent, 'Preparing tests…');
	assert.equal(elements.get('current-item')?.textContent, 'Preparing tests…');

	render({ completed: 6, total: 6, label: 'Tests passed' });
	for (let index = 0; index < 6; index += 1) {
		assert.equal(bar(`phase-progress-${String(index)}`).value, 1);
	}
	assert.equal(elements.get('current-item')?.textContent, '');
});

test('the progress renderer shows per-test counts, current test text, and overall advancement', async () => {
	const { render, elements, bar } = await rendererFixture();
	const label = 'soundscaper > export <script>alert("test")</script>';
	render({ completed: 2, total: 6, label: 'Performance diagnostics',
		items: { completed: 4, total: 10, label } });

	assert.equal(elements.get('status')?.textContent, 'Performance diagnostics');
	assert.equal(elements.get('current-item')?.textContent, label);
	assert.equal(elements.get('phase-count-2')?.textContent, '4 of 10 tests complete');
	assert.equal(bar('phase-progress-2').max, 10);
	assert.equal(bar('phase-progress-2').value, 4);
	assert.equal(bar('phase-progress-2').hasAttribute('value'), true);
	assert.equal(bar('progress').value, 2.4);
	assert.equal(elements.get('count')?.textContent, '2 of 6 phases complete');
});

test('completed phases retain their item counts while the next phase prepares', async () => {
	const { render, elements, bar } = await rendererFixture();
	render({ completed: 0, total: 6, label: 'Browser tests',
		items: { completed: 8, total: 8, label: 'Tests finished' } });
	render({ completed: 1, total: 6, label: 'Dual-origin browser coverage' });

	assert.equal(elements.get('phase-count-0')?.textContent, '8 of 8 tests complete');
	assert.equal(bar('phase-progress-0').max, 8);
	assert.equal(bar('phase-progress-0').value, 8);
	assert.equal(elements.get('phase-count-1')?.textContent, 'Preparing tests…');
	assert.equal(elements.get('current-item')?.textContent, 'Preparing tests…');
});

test('empty test phases and terminal item payloads keep progress bounded', async () => {
	const { render, elements, bar } = await rendererFixture();
	render({ completed: 0, total: 6, label: 'Browser tests',
		items: { completed: 0, total: 0, label: 'Tests finished' } });
	assert.equal(elements.get('phase-count-0')?.textContent, '0 of 0 tests complete');
	assert.equal(bar('phase-progress-0').max, 1);
	assert.equal(bar('phase-progress-0').value, 0);
	assert.equal(bar('progress').value, 0);

	render({ completed: 6, total: 6, label: 'Tests passed',
		items: { completed: 3, total: 3, label: 'Tests finished' } });
	assert.equal(bar('progress').value, 6);
	assert.equal(elements.get('current-item')?.textContent, '');
});

test('an interrupted run retains its fractional progress and completed test counts', async () => {
	const { render, elements, bar } = await rendererFixture();
	const items = { completed: 3, total: 4, label: 'third test' };
	render({ completed: 2, total: 6, label: 'Performance diagnostics', items });
	render({ completed: 2, total: 6, label: 'Tests interrupted', items });

	assert.equal(bar('progress').value, 2.75);
	assert.equal(elements.get('phase-count-2')?.textContent, '3 of 4 tests complete');
	assert.equal(elements.get('current-item')?.textContent, '');
});

test('the progress renderer rejects invalid item counts before changing visible progress', async () => {
	const { render, elements, bar } = await rendererFixture();
	render({ completed: 0, total: 6, label: 'Browser tests' });
	for (const items of [
		{ completed: -1, total: 5, label: 'test' },
		{ completed: 6, total: 5, label: 'test' },
		{ completed: 0, total: -1, label: 'test' },
		{ completed: 1.5, total: 5, label: 'test' },
		{ completed: 0, total: 5, label: '' },
	]) {
		assert.throws(() => render({ completed: 2, total: 6,
			label: 'Performance diagnostics', items }), /progress/u);
	}
	assert.equal(elements.get('status')?.textContent, 'Browser tests');
	assert.equal(bar('progress').value, 0);
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
		async loadURL() {}
		once() {}
		show() { shown = true; }
		setTitle() {}
		setProgressBar() { throw new Error('Native taskbar API failed'); }
		isDestroyed() { return false; }
		destroy() {}
	}
	const window = await createDesktopNightlyTestsProgressWindow({
		BrowserWindow: TaskbarFailureWindow,
		protocol: protocolFixture(),
		initialProgress: { completed: 0, total: 6, label: 'Application launched' },
		onError: (error) => { errors.push(error); },
	});
	window.update({ completed: 2, total: 6, label: 'Performance diagnostics' });
	assert.equal(shown, true);
	assert.equal(errors.length, 2);
	assert.match(scripts.at(-1) ?? '', /Performance diagnostics/u);
});

test('the progress protocol serves only its three bundled assets with restricted response headers', async () => {
	const protocol = protocolFixture();
	class Window {
		webContents = {
			executeJavaScript: async () => undefined,
			setWindowOpenHandler: () => undefined, on: () => undefined,
		};
		async loadURL() {}
		once() {}
		show() {}
		setTitle() {}
		setProgressBar() {}
		isDestroyed() { return false; }
		destroy() {}
	}
	await createDesktopNightlyTestsProgressWindow({
		BrowserWindow: Window, protocol,
		initialProgress: { completed: 0, total: 6, label: 'Application launched' },
	});
	for (const [path, filename, contentType] of [
		['', 'nightly-tests-progress.html', 'text/html'],
		['nightly-tests-progress-renderer.js', 'nightly-tests-progress-renderer.js', 'text/javascript'],
		['nightly-tests-progress.css', 'nightly-tests-progress.css', 'text/css'],
	]) {
		const response = protocol.request(`${NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL}${path}`);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('Content-Type'), `${contentType}; charset=utf-8`);
		assert.equal(response.headers.get('Cache-Control'), 'no-store');
		assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
		assert.match(response.headers.get('Content-Security-Policy') ?? '', /script-src 'self'/u);
		assert.equal(await response.text(), await readFile(new URL(`../desktop/${filename}`, import.meta.url), 'utf8'));
	}
	for (const url of [
		`${NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL}../nightly-tests-main.mjs`,
		`${NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL}%2e%2e%2fnightly-tests-main.mjs`,
		`${NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL}nightly-tests-progress.css?file=secret`,
		`${NIGHTLY_TESTS_PROGRESS_SCHEME}://elsewhere/`,
		'file:///C:/secret.txt', 'https://example.org/',
	]) assert.equal(protocol.request(url).status, 404, url);
	const denied = protocol.request(NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL, 'POST');
	assert.equal(denied.status, 405);
	assert.equal(denied.headers.get('Allow'), 'GET');
});

test('a progress navigation failure destroys the window and removes its protocol handler', async () => {
	const protocol = protocolFixture();
	let destroyed = false;
	class Window {
		webContents = { setWindowOpenHandler: () => undefined, on: () => undefined,
			executeJavaScript: async () => undefined };
		async loadURL() { throw new Error('Navigation failed'); }
		once() {}
		show() {}
		setTitle() {}
		setProgressBar() {}
		isDestroyed() { return destroyed; }
		destroy() { destroyed = true; }
	}
	await assert.rejects(createDesktopNightlyTestsProgressWindow({
		BrowserWindow: Window, protocol,
		initialProgress: { completed: 0, total: 6, label: 'Application launched' },
	}), /Navigation failed/u);
	assert.equal(destroyed, true);
	assert.deepEqual(protocol.removed, [NIGHTLY_TESTS_PROGRESS_SCHEME]);
});

function protocolFixture() {
	let handler = (_request: { url: string; method: string }): Response => { throw new Error('Protocol not registered'); };
	return {
		scheme: '', removed: [] as string[],
		handle(scheme: string, listener: typeof handler) { this.scheme = scheme; handler = listener; },
		unhandle(scheme: string) { this.removed.push(scheme); },
		request(url: string, method = 'GET') { return handler({ url, method }); },
	};
}

async function rendererFixture() {
	class Element {
		textContent = '';
	}
	class ProgressElement extends Element {
		max = 1;
		value = 0;
		#attributes = new Set<string>(['value']);
		removeAttribute(name: string) { this.#attributes.delete(name); }
		setAttribute(name: string) { this.#attributes.add(name); }
		hasAttribute(name: string) { return this.#attributes.has(name); }
	}
	const elements = new Map<string, Element>([
		['status', new Element()], ['count', new Element()],
		['current-item', new Element()], ['progress', new ProgressElement()],
	]);
	for (let index = 0; index < 6; index += 1) {
		elements.set(`phase-progress-${String(index)}`, new ProgressElement());
		elements.set(`phase-count-${String(index)}`, new Element());
	}
	const context = {
		document: { getElementById: (id: string) => elements.get(id) ?? null },
		HTMLElement: Element, HTMLProgressElement: ProgressElement,
	};
	const renderer = await readFile(new URL('../desktop/nightly-tests-progress-renderer.js', import.meta.url), 'utf8');
	vm.runInNewContext(renderer, context);
	const render = (context as typeof context & {
		renderNightlyTestsProgress(value: { completed: number; total: number; label: string;
			items?: { completed: number; total: number; label: string } }): void;
	}).renderNightlyTestsProgress;
	return { render, elements, bar: (id: string) => elements.get(id) as ProgressElement };
}
