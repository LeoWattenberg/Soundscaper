import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { extractAup4Paths, extractProjectPaths } from '../desktop/file-associations.js';
import { acceptsSystemAudioRequest, selectSystemAudioStreams } from '../desktop/display-capture.js';
import {
	ProtocolError,
	createProtocolHandler,
	inlineScriptHashes,
	parseSingleRange,
	resolveStaticFile,
	securityHeaders,
} from '../desktop/protocol.js';
import {
	assertEditorDocumentUrl,
	acceptsFile,
	isAppUrl,
	isEditorDocumentUrl,
	resolveLocale,
	validateSaveChoice,
} from '../desktop/validation.js';

test('desktop document and locale validation accepts only committed editor routes', () => {
	assert.equal(assertEditorDocumentUrl('soundscaper-app://bundle/').pathname, '/');
	assert.equal(isEditorDocumentUrl('soundscaper-app://bundle/'), true);
	assert.equal(isEditorDocumentUrl('soundscaper-app://bundle/runtime/ffmpeg-core.js'), false);
	assert.equal(isEditorDocumentUrl('soundscaper-app://bundle/?untrusted=1'), false);
	assert.equal(isAppUrl('https://bundle/embed/en/'), false);
	assert.equal(resolveLocale(['fr-CA']), 'fr');
	assert.equal(resolveLocale(['unknown-locale']), 'en');
});

test('static protocol resolution rejects traversal and escaping symlinks', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-protocol-'));
	const outside = await mkdtemp(join(tmpdir(), 'soundscaper-outside-'));
	context.after(async () => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
	await mkdir(join(root, 'embed', 'en'), { recursive: true });
	await writeFile(join(root, 'embed', 'en', 'index.html'), '<html></html>');
	await writeFile(join(outside, 'secret.txt'), 'secret');
	await symlink(join(outside, 'secret.txt'), join(root, 'leak.txt'));

	const resolved = await resolveStaticFile(root, 'embed/en/');
	assert.equal(resolved.size, 13);
	await assert.rejects(() => resolveStaticFile(root, '../secret.txt'), (error) => error instanceof ProtocolError && error.status === 400);
	await assert.rejects(() => resolveStaticFile(root, '%2e%2e/secret.txt'), (error) => error instanceof ProtocolError && error.status === 400);
	await assert.rejects(() => resolveStaticFile(root, 'leak.txt'), (error) => error instanceof ProtocolError && error.status === 403);
});

test('protocol handler serves HTML with hashed inline scripts and blocks other methods', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-handler-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, 'index.html'), '<script>globalThis.ready = true;</script><main>Soundscaper</main>');
	const handler = createProtocolHandler({ rendererRoot: root, runtimeRoot: root, readCapabilities: { get: () => null } });
	const response = await handler(new Request('soundscaper-app://bundle/', { method: 'GET' }));
	assert.equal(response.status, 200);
	assert.equal(await response.text(), '<script>globalThis.ready = true;</script><main>Soundscaper</main>');
	assert.match(response.headers.get('content-security-policy'), /sha256-/u);
	assert.doesNotMatch(response.headers.get('content-security-policy'), /script-src[^;]*unsafe-inline/u);
	assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');

	const blocked = await handler(new Request('soundscaper-app://bundle/', { method: 'POST' }));
	assert.equal(blocked.status, 405);
});

test('CSP hashes exact inline script bodies and byte ranges are bounded', () => {
	const html = '<script type="module"> one();\n</script><script src="/app.js"></script><script>two()</script>';
	assert.equal(inlineScriptHashes(html).length, 2);
	const headers = securityHeaders({ html });
	assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/u);
	assert.deepEqual(parseSingleRange('bytes=2-5', 10), { start: 2, end: 5, length: 4 });
	assert.deepEqual(parseSingleRange('bytes=-3', 10), { start: 7, end: 9, length: 3 });
	assert.throws(() => parseSingleRange('bytes=20-30', 10), (error) => error.status === 416);
	assert.throws(() => parseSingleRange('bytes=1-2,4-5', 10), (error) => error.status === 416);
});

test('file association arguments accept only unique Scape and AUP4 paths', () => {
	const paths = extractProjectPaths(['electron', '--inspect', 'demo.aup4', 'movie.scape', 'track.wav', 'demo.aup4'], '/projects');
	assert.deepEqual(paths, ['/projects/demo.aup4', '/projects/movie.scape']);
	assert.deepEqual(extractAup4Paths(['movie.scape'], '/projects'), ['/projects/movie.scape']);
});

test('native file filters cover the editor import and export formats', () => {
	assert.equal(acceptsFile('audio', '/tmp/session.AUP3'), true);
	assert.equal(acceptsFile('audio', '/tmp/take.wv'), true);
	assert.equal(acceptsFile('media', '/tmp/captions.srt'), true);
	assert.equal(acceptsFile('media', '/tmp/labels.TXT'), true);
	assert.equal(acceptsFile('labels', '/tmp/captions.vtt'), true);
	assert.equal(acceptsFile('labels', '/tmp/captions.csv'), false);
	assert.equal(validateSaveChoice({ purpose: 'audio', suggestedName: 'stems.zip' }).suggestedName, 'stems.zip');
	assert.equal(validateSaveChoice({ purpose: 'project', suggestedName: 'session' }).suggestedName, 'session.scape');
	assert.equal(validateSaveChoice({ purpose: 'aup4', suggestedName: 'session' }).suggestedName, 'session.aup4');
	assert.equal(validateSaveChoice({ purpose: 'audio', suggestedName: 'custom.caf' }).filters.at(-1).extensions[0], '*');
	assert.equal(validateSaveChoice({ purpose: 'labels', suggestedName: 'captions.srt' }).suggestedName, 'captions.srt');
	assert.equal(validateSaveChoice({ purpose: 'macro', suggestedName: 'cleanup' }).suggestedName, 'cleanup.txt');
});

test('Windows system-audio capture requires a trusted user gesture and selects loopback', () => {
	const request = {
		securityOrigin: 'soundscaper-app://bundle/',
		frame: { url: 'soundscaper-app://bundle/' },
		userGesture: true,
		audioRequested: true,
		videoRequested: true,
	};
	const source = { id: 'screen:0:0', name: 'Entire Screen' };
	assert.equal(acceptsSystemAudioRequest(request, { platform: 'win32' }), true);
	assert.deepEqual(selectSystemAudioStreams(request, [source], { platform: 'win32' }), { video: source, audio: 'loopback' });
	assert.equal(acceptsSystemAudioRequest({ ...request, userGesture: false }, { platform: 'win32' }), false);
	assert.equal(acceptsSystemAudioRequest({ ...request, frame: { url: 'https://example.com/' } }, { platform: 'win32' }), false);
	assert.equal(acceptsSystemAudioRequest(request, { platform: 'darwin' }), false);
});

test('sandbox preload exposes only the versioned narrow bridge', async () => {
	const calls = [];
	const exposed = new Map();
	const ipcRenderer = {
		invoke: (channel, value) => {
			calls.push({ method: 'invoke', channel, value });
			return Promise.resolve(null);
		},
		send: (channel, value) => calls.push({ method: 'send', channel, value }),
		on: () => {},
		removeListener: () => {},
	};
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		ArrayBuffer,
		Object,
		Promise,
		RangeError,
		String,
		TypeError,
		Uint8Array,
		URL,
		require: (specifier) => {
			assert.equal(specifier, 'electron');
			return {
				contextBridge: { exposeInMainWorld: (name, value) => { exposed.set(name, value); } },
				ipcRenderer,
			};
		},
	});
	assert.deepEqual([...exposed.keys()], ['scapeDesktop', 'soundscaperDesktop', 'framescaperDesktop']);
	assert.equal(exposed.get('scapeDesktop'), exposed.get('soundscaperDesktop'));
	assert.equal(exposed.get('scapeDesktop'), exposed.get('framescaperDesktop'));
	const bridge = exposed.get('scapeDesktop');
	assert.deepEqual(
		Object.keys(bridge.v1).sort(),
		[
			'abortWrite', 'beginWrite', 'checkForUpdates', 'chooseFiles', 'chooseSaveTarget',
			'editText', 'finishWrite', 'getEnvironment', 'onCloseRequested', 'onFullscreenChanged',
			'onMenuCommand', 'onOpenProject', 'openExternal', 'releaseRead', 'respondToClose',
			'setFullscreen', 'setLocale', 'signalReady', 'writeChunk',
		].sort(),
	);
	assert.equal(Object.isFrozen(bridge.v1), true);
	bridge.v1.signalReady();
	assert.deepEqual(calls[0], { method: 'send', channel: 'soundscaper:v1:renderer:ready', value: undefined });
	await bridge.v1.editText('copy');
	assert.deepEqual(calls[1], { method: 'invoke', channel: 'soundscaper:v1:text:edit', value: 'copy' });
	await bridge.v1.editText('selectAll');
	assert.deepEqual(calls[2], { method: 'invoke', channel: 'soundscaper:v1:text:edit', value: 'selectAll' });
	assert.throws(() => bridge.v1.editText('select-all'), /Unsupported text edit command/);
});
