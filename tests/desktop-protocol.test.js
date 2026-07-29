import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import vm from 'node:vm';

import { PendingProjectQueue, extractAup4Paths, extractProjectPaths } from '../desktop/file-associations.js';
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
	mimeTypeForPath,
	resolveLocale,
	validateDeclaredSize,
	validateSaveChoice,
} from '../desktop/validation.js';
import { MAX_SAVE_BYTES } from '../desktop/constants.js';

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

test('capability protocol abort destroys the active read stream and detaches its listener', async () => {
	const id = 'a'.repeat(64);
	const destroyed = [];
	let emitted = false;
	const stream = new Readable({
		read() {
			if (emitted) return;
			emitted = true;
			this.push(Buffer.from('chunk'));
		},
		destroy(error, callback) {
			destroyed.push(error);
			callback(error);
		},
	});
	const handler = createProtocolHandler({
		rendererRoot: '/unused-renderer',
		runtimeRoot: '/unused-runtime',
		readCapabilities: {
			get: (candidate) => candidate === id ? {
				id,
				size: 5,
				mimeType: 'application/octet-stream',
				handle: { createReadStream: () => stream },
			} : null,
		},
	});
	const controller = new AbortController();
	const request = new Request(`soundscaper-app://bundle/_desktop/read/${id}/input.bin`, {
		signal: controller.signal,
	});
	const response = await handler(request);
	const reader = response.body.getReader();
	const readerClosed = reader.closed.catch((error) => error);
	const first = await reader.read();
	assert.equal(new TextDecoder().decode(first.value), 'chunk');
	assert.equal(getEventListeners(request.signal, 'abort').length, 1);
	const streamClosed = new Promise((resolve) => stream.once('close', resolve));
	const reason = new DOMException('cancel capability response', 'AbortError');

	controller.abort(reason);
	await streamClosed;
	assert.equal(destroyed.length, 1);
	assert.equal(destroyed[0], reason);
	assert.equal(getEventListeners(request.signal, 'abort').length, 0);
	assert.equal(await readerClosed, reason);
});

test('capability protocol removes its abort listener after a normal stream end without close', async () => {
	const id = 'b'.repeat(64);
	const stream = Readable.from([Buffer.from('done')], { emitClose: false });
	const handler = createProtocolHandler({
		rendererRoot: '/unused-renderer',
		runtimeRoot: '/unused-runtime',
		readCapabilities: {
			get: (candidate) => candidate === id ? {
				id,
				size: 4,
				mimeType: 'application/octet-stream',
				handle: { createReadStream: () => stream },
			} : null,
		},
	});
	const controller = new AbortController();
	const request = new Request(`soundscaper-app://bundle/_desktop/read/${id}/input.bin`, {
		signal: controller.signal,
	});
	const response = await handler(request);
	assert.equal(getEventListeners(request.signal, 'abort').length, 1);
	const streamEnded = new Promise((resolve) => stream.once('end', resolve));

	assert.equal(await response.text(), 'done');
	await streamEnded;
	assert.equal(getEventListeners(request.signal, 'abort').length, 0);
});

test('file association arguments accept only unique Scape and Audacity project paths', () => {
	const paths = extractProjectPaths(
		['electron', '--inspect', 'old.aup3', 'demo.aup4', 'movie.scape', 'track.wav', 'old.aup3'],
		'/projects',
	);
	assert.deepEqual(paths, ['/projects/old.aup3', '/projects/demo.aup4', '/projects/movie.scape']);
	assert.deepEqual(extractAup4Paths(['old.aup3', 'movie.scape'], '/projects'), ['/projects/old.aup3', '/projects/movie.scape']);
});

test('pending project dispatch stays serial and retries its visible head for a replacement renderer', async () => {
	const firstAttempt = Promise.withResolvers();
	const continueFirstAttempt = Promise.withResolvers();
	const attempts = [];
	const delivered = [];
	const deliver = async (filePath) => {
		attempts.push(filePath);
		if (attempts.length === 1) {
			firstAttempt.resolve();
			await continueFirstAttempt.promise;
			return false;
		}
		delivered.push(filePath);
		return true;
	};
	const queue = new PendingProjectQueue(deliver);
	assert.equal(queue.enqueue('/projects/a.scape'), true);
	const firstDispatch = queue.dispatch();
	await firstAttempt.promise;
	assert.equal(queue.enqueue('/projects/a.scape'), false, 'the in-flight head remains deduplicated');
	assert.equal(queue.enqueue('/projects/b.scape'), true);
	const replacementDispatch = queue.dispatch();
	continueFirstAttempt.resolve();
	await Promise.all([firstDispatch, replacementDispatch]);

	assert.deepEqual(attempts, ['/projects/a.scape', '/projects/a.scape', '/projects/b.scape']);
	assert.deepEqual(delivered, ['/projects/a.scape', '/projects/b.scape']);
});

test('native file filters cover the editor import and export formats', () => {
	assert.equal(acceptsFile('project', '/tmp/session.AUP3'), true);
	assert.equal(acceptsFile('project', '/tmp/session.AUP4'), true);
	assert.equal(acceptsFile('audio', '/tmp/session.AUP3'), false);
	assert.equal(acceptsFile('media', '/tmp/session.AUP3'), false);
	assert.equal(acceptsFile('audio', '/tmp/take.wv'), true);
	assert.equal(acceptsFile('audio', '/tmp/large-master.rf64'), true);
	assert.equal(acceptsFile('media', '/tmp/unsupported-master.BW64'), false);
	assert.equal(mimeTypeForPath('/tmp/large-master.rf64'), 'audio/rf64');
	assert.equal(mimeTypeForPath('/tmp/unsupported-master.bw64'), 'audio/bw64');
	assert.equal(acceptsFile('media', '/tmp/captions.srt'), true);
	assert.equal(acceptsFile('media', '/tmp/labels.TXT'), true);
	assert.equal(acceptsFile('labels', '/tmp/captions.vtt'), true);
	assert.equal(acceptsFile('labels', '/tmp/captions.csv'), false);
	assert.equal(validateSaveChoice({ purpose: 'audio', suggestedName: 'stems.zip' }).suggestedName, 'stems.zip');
	const stemArchive = validateSaveChoice({ purpose: 'audio', suggestedName: 'stems.7z' });
	assert.equal(stemArchive.suggestedName, 'stems.7z');
	assert.equal(stemArchive.filters[0].extensions.includes('7z'), true);
	assert.equal(mimeTypeForPath('/tmp/stems.7z'), 'application/x-7z-compressed');
	assert.equal(validateSaveChoice({ purpose: 'project', suggestedName: 'session' }).suggestedName, 'session.scape');
	assert.equal(validateSaveChoice({ purpose: 'aup4', suggestedName: 'session' }).suggestedName, 'session.aup4');
	assert.equal(validateSaveChoice({ purpose: 'audio', suggestedName: 'custom.caf' }).filters.at(-1).extensions[0], '*');
	assert.equal(validateSaveChoice({ purpose: 'labels', suggestedName: 'captions.srt' }).suggestedName, 'captions.srt');
	assert.equal(validateSaveChoice({ purpose: 'macro', suggestedName: 'cleanup' }).suggestedName, 'cleanup.txt');
});

test('desktop save declarations accept every safe integer byte length', () => {
	assert.equal(MAX_SAVE_BYTES, Number.MAX_SAFE_INTEGER);
	assert.equal(validateDeclaredSize(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
	assert.throws(() => validateDeclaredSize(Number.MAX_SAFE_INTEGER + 1), /Invalid save size/u);
	assert.throws(() => validateDeclaredSize(BigInt(Number.MAX_SAFE_INTEGER)), /Invalid save size/u);
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
	await bridge.v1.beginWrite({ targetId: 'a'.repeat(48), maximumSize: 123 });
	assert.equal(calls[3].method, 'invoke');
	assert.equal(calls[3].channel, 'soundscaper:v1:save:begin');
	assert.deepEqual({ ...calls[3].value }, { targetId: 'a'.repeat(48), maximumSize: 123 });
});
