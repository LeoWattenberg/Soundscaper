import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { mkdtemp, mkdir, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
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
import {
	MAX_DESKTOP_SAVE_BYTES,
	MAX_SAVE_BYTES,
	READ_PROFILE_MATERIALIZED_V1,
} from '../desktop/constants.js';
test('desktop document and locale validation accepts only committed editor routes', () => {
	assert.equal(assertEditorDocumentUrl('soundscaper-app://bundle/').pathname, '/');
	assert.equal(isEditorDocumentUrl('soundscaper-app://bundle/'), true);
	assert.equal(
		assertEditorDocumentUrl('soundscaper-app://bundle/?project=packaged_project-1').searchParams.get('project'),
		'packaged_project-1',
	);
	assert.equal(isEditorDocumentUrl('soundscaper-app://bundle/runtime/ffmpeg-core.js'), false);
	assert.equal(isEditorDocumentUrl('soundscaper-app://bundle/?untrusted=1'), false);
	assert.equal(isEditorDocumentUrl('soundscaper-app://bundle/?project=one&project=two'), false);
	assert.equal(isEditorDocumentUrl('soundscaper-app://bundle/?project=unsafe%2Fid'), false);
	assert.equal(isEditorDocumentUrl('soundscaper-app://bundle/?project=one#unsafe'), false);
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
	assert.match(headers['Content-Security-Policy'], /connect-src 'self' blob:/u);
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
			get: (candidate) => candidate === id ? materializedDescriptor(id, 5) : null,
			acquireRequest: (candidate) => candidate === id ? {
				id,
				size: 5,
				mimeType: 'application/octet-stream',
				createReadStream: () => stream,
				close: async () => {},
				retire: async () => {},
			} : null,
		},
	});
	const controller = new AbortController();
	const request = new Request(materializedCapabilityUrl(id, 'input.bin'), {
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

test('capability protocol abort discards bytes buffered before the first response read', async () => {
	const id = 'e'.repeat(64);
	const produced = Promise.withResolvers();
	const retired = Promise.withResolvers();
	let retireCalls = 0;
	const stream = new Readable({
		read() {
			if (this.sent) return;
			this.sent = true;
			this.push(Buffer.from('buffered'));
			produced.resolve();
		},
	});
	const handler = createProtocolHandler({
		rendererRoot: '/unused-renderer',
		runtimeRoot: '/unused-runtime',
		readCapabilities: {
			get: (candidate) => candidate === id ? materializedDescriptor(id, 8) : null,
			acquireRequest: (candidate) => candidate === id ? {
				id,
				size: 8,
				mimeType: 'application/octet-stream',
				createReadStream: () => stream,
				close: async () => {},
				retire: () => {
					retireCalls += 1;
					return retired.promise;
				},
			} : null,
		},
	});
	const controller = new AbortController();
	const request = new Request(materializedCapabilityUrl(id, 'input.bin'), {
		signal: controller.signal,
	});
	const response = await handler(request);
	const reader = response.body.getReader();
	await produced.promise;
	const reason = new DOMException('abort before reading buffered bytes', 'AbortError');

	controller.abort(reason);
	const firstRead = reader.read();
	assert.equal(await remainsPending(firstRead), true, 'body failure waits for capability retirement');
	retired.resolve(true);
	await assert.rejects(firstRead, (error) => error === reason);
	assert.equal(retireCalls, 1);
	assert.equal(getEventListeners(request.signal, 'abort').length, 0);
});

test('capability protocol retires an errored inner stream without another body read', async () => {
	const id = 'f'.repeat(64);
	const retired = Promise.withResolvers();
	let retireCalls = 0;
	const stream = new Readable({
		read() {
			if (this.sent) return;
			this.sent = true;
			this.push(Buffer.from('first'));
		},
	});
	const handler = createProtocolHandler({
		rendererRoot: '/unused-renderer',
		runtimeRoot: '/unused-runtime',
		readCapabilities: {
			get: (candidate) => candidate === id ? materializedDescriptor(id, 10) : null,
			acquireRequest: (candidate) => candidate === id ? {
				id,
				size: 10,
				mimeType: 'application/octet-stream',
				createReadStream: () => stream,
				close: async () => {},
				retire: () => {
					retireCalls += 1;
					return retired.promise;
				},
			} : null,
		},
	});
	const response = await handler(new Request(materializedCapabilityUrl(id, 'input.bin')));
	const reader = response.body.getReader();
	assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
	const readerClosed = reader.closed.catch((error) => error);
	const failure = new Error('injected inner stream failure');

	stream.destroy(failure);
	assert.equal(await remainsPending(readerClosed), true, 'body failure waits for capability retirement');
	retired.resolve(true);
	assert.equal(await readerClosed, failure);
	assert.equal(retireCalls, 1);
});

test('capability protocol removes its abort listener after a normal stream end without close', async () => {
	const id = 'b'.repeat(64);
	const stream = Readable.from([Buffer.from('done')], { emitClose: false });
	const handler = createProtocolHandler({
		rendererRoot: '/unused-renderer',
		runtimeRoot: '/unused-runtime',
		readCapabilities: {
			get: (candidate) => candidate === id ? materializedDescriptor(id, 4) : null,
			acquireRequest: (candidate) => candidate === id ? {
				id,
				size: 4,
				mimeType: 'application/octet-stream',
				createReadStream: () => stream,
				close: async () => {},
				retire: async () => {},
			} : null,
		},
	});
	const controller = new AbortController();
	const request = new Request(materializedCapabilityUrl(id, 'input.bin'), {
		signal: controller.signal,
	});
	const response = await handler(request);
	assert.equal(getEventListeners(request.signal, 'abort').length, 1);
	const streamEnded = new Promise((resolve) => stream.once('end', resolve));

	assert.equal(await response.text(), 'done');
	await streamEnded;
	assert.equal(getEventListeners(request.signal, 'abort').length, 0);
});

test('capability protocol closes bodyless and failed request leases exactly once', async () => {
	const id = 'c'.repeat(64);
	for (const scenario of [
		{ name: 'invalid range', size: 4, method: 'GET', range: 'bytes=9-10', status: 416 },
		{ name: 'head', size: 4, method: 'HEAD', status: 200 },
		{ name: 'empty file', size: 0, method: 'GET', status: 200 },
		{ name: 'stream construction failure', size: 4, method: 'GET', status: 500, streamFailure: true },
	]) {
		let closeCalls = 0;
		let streamCalls = 0;
		const handler = createProtocolHandler({
			rendererRoot: '/unused-renderer',
			runtimeRoot: '/unused-runtime',
			readCapabilities: {
				get: (candidate) => candidate === id ? materializedDescriptor(id, scenario.size) : null,
				acquireRequest: (candidate) => candidate === id ? {
					id,
					size: scenario.size,
					mimeType: 'application/octet-stream',
					createReadStream: () => {
						streamCalls += 1;
						if (scenario.streamFailure) throw new Error('injected stream construction failure');
						return Readable.from([Buffer.alloc(scenario.size)]);
					},
					close: async () => { closeCalls += 1; },
					retire: async () => {},
				} : null,
			},
		});
		const request = new Request(materializedCapabilityUrl(id, scenario.name), {
			method: scenario.method,
			headers: scenario.range ? { Range: scenario.range } : undefined,
		});
		const response = await handler(request);
		assert.equal(response.status, scenario.status, scenario.name);
		assert.equal(closeCalls, scenario.name === 'invalid range' ? 0 : 1,
			`${scenario.name} closes only an admitted request lease`);
		assert.equal(streamCalls, scenario.streamFailure ? 1 : 0, scenario.name);
	}
});

test('capability protocol serves one exact leased byte range', async () => {
	const id = 'd'.repeat(64);
	let streamOptions = null;
	let leaseCloseCalls = 0;
	let streamEndCalls = 0;
	const handler = createProtocolHandler({
		rendererRoot: '/unused-renderer',
		runtimeRoot: '/unused-runtime',
		readCapabilities: {
			get: (candidate) => candidate === id ? materializedDescriptor(id, 10) : null,
			acquireRequest: (candidate) => candidate === id ? {
				id,
				size: 10,
				mimeType: 'application/octet-stream',
				createReadStream: (options) => {
					streamOptions = options;
					const stream = Readable.from([Buffer.from('2345')]);
					stream.once('end', () => { streamEndCalls += 1; });
					return stream;
				},
				close: async () => { leaseCloseCalls += 1; },
				retire: async () => {},
			} : null,
		},
	});
	const response = await handler(new Request(
		materializedCapabilityUrl(id, 'range.bin'),
		{ headers: { Range: 'bytes=2-5' } },
	));

	assert.equal(response.status, 206);
	assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/10');
	assert.equal(response.headers.get('Content-Length'), '4');
	assert.deepEqual(streamOptions, { start: 2, end: 5, autoClose: false });
	assert.equal(await response.text(), '2345');
	assert.equal(streamEndCalls, 1);
	assert.equal(leaseCloseCalls, 1);
});

test('real capability leases keep unread bodies exclusive and retire their handle on cancellation', async (context) => {
	const owner = Object.freeze({ name: 'protocol-renderer-owner' });
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-capability-protocol-'));
	const filePath = join(root, 'lease.scape');
	await writeFile(filePath, Buffer.from('done'));
	const handles = [];
	const streams = [];
	const closeCalls = [];
	const store = new ReadCapabilityStore({
		maximumCount: 1,
		openImpl: async (...args) => {
			const handle = await open(...args);
			const index = handles.push(handle) - 1;
			closeCalls[index] = 0;
			return {
				stat: () => handle.stat(),
				createReadStream: (options) => {
					const stream = handle.createReadStream(options);
					streams.push(stream);
					return stream;
				},
				close: async () => {
					closeCalls[index] += 1;
					await handle.close();
				},
			};
		},
	});
	context.after(async () => {
		await store.dispose().catch(() => undefined);
		await rm(root, { recursive: true, force: true });
	});
	const descriptor = await store.registerPath(filePath, { owner });
	const handler = createProtocolHandler({
		rendererRoot: '/unused-renderer',
		runtimeRoot: '/unused-runtime',
		readCapabilities: store,
	});
	const requestUrl = `${descriptor.url}`;

	const completeResponse = await handler(new Request(requestUrl));
	assert.equal(await completeResponse.text(), 'done');
	assert.ok(store.get(descriptor.id), 'normal body completion preserves the capability');
	assert.equal(handles[0].fd >= 0, true, 'normal stream completion preserves the pinned handle');

	const unreadResponse = await handler(new Request(requestUrl));
	assert.equal(unreadResponse.status, 200, 'normal body completion releases the request slot');
	await streamEnd(streams[1]);
	assert.equal(unreadResponse.bodyUsed, false);
	assert.equal(store.acquireRequest(descriptor.id), null, 'an unread body retains request exclusivity after native end');
	assert.equal((await handler(new Request(requestUrl))).status, 404);
	const cancelReason = new DOMException('cancel protocol body', 'AbortError');
	await unreadResponse.body.cancel(cancelReason);

	assert.equal(store.get(descriptor.id), null);
	assert.equal(store.acquireRequest(descriptor.id), null);
	assert.equal((await handler(new Request(requestUrl))).status, 404);
	assert.equal(closeCalls[0], 1, 'cancellation resolves after the pinned handle close');
	await assert.rejects(handles[0].stat(), (error) => error?.code === 'EBADF');
	assert.equal(await store.release(descriptor.id, { owner }), false);

	const replacement = await store.registerPath(filePath, { owner });
	assert.equal(handles.length, 2, 'retirement releases the per-owner admission count');
	assert.equal(await store.release(replacement.id, { owner }), true);
	assert.equal(closeCalls[1], 1);
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
	assert.equal(validateSaveChoice({ purpose: 'project', suggestedName: 'session' }).suggestedName, 'session.sscape');
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
	assert.notEqual(exposed.get('scapeDesktop'), exposed.get('framescaperDesktop'));
	const bridge = exposed.get('scapeDesktop');
	const baseFields = [
		'abortWrite', 'applyNativeTierControl', 'awaitVideoSourceProbe', 'beginDesktopVideoCodecOperation', 'beginVideoSourceProbe', 'beginWrite', 'bindNativeAudioSession', 'calibrateNativeAudioSession',
			'cancelAssistanceModelInstall', 'cancelDesktopAudioCodecOperation', 'cancelDesktopVideoCodecOperation', 'cancelVideoSourceProbe',
		'checkForUpdates', 'chooseExternalFfmpeg', 'chooseFiles', 'chooseLinkedAudioOriginal', 'chooseLinkedVideoOriginal', 'chooseSaveTarget', 'clearExternalFfmpeg', 'clearNativePluginQuarantine', 'closeDesktopVideoCodecInput', 'closeNativeAudioSession', 'closeNativePluginInstance', 'closeNativePluginVendorUi',
			'deleteDesktopVideoCodecOperation', 'describeNativeAudioBackend', 'editText', 'executeDesktopVideoCodecOperation', 'finishWrite',
		'getDesktopAudioCodecCapabilities', 'getDesktopVideoExportCapabilities', 'getEnvironment', 'getExternalFfmpegStatus', 'installAssistanceModel', 'installExternalFfmpeg', 'installPreseededAssistanceModel', 'instantiateNativePlugin', 'listAssistanceModelNotices', 'listAssistanceModels', 'listNativePlugins', 'loadLinkedAudioOriginal', 'loadLinkedVideoOriginal', 'localAssistance', 'nativeAudioHelperAvailability', 'nativeAudioSessionStatus', 'nativePluginAvailability', 'nativeServices', 'onAssistanceInstallProgress', 'onCloseRequested',
		'onMenuCommand', 'onOpenProject', 'onWindowStateChanged', 'openExternal', 'openNativeAudioSession', 'openNativePluginVendorUi', 'patchFinalPrefix', 'persistNativePluginState', 'probeHelperAvailability', 'readDesktopVideoCodecOutput', 'readNativeTierControls',
		'reconcileAssistanceModels', 'reconcileLinkedOriginals', 'reconcileLinkedVideoOriginals', 'releaseLinkedOriginal', 'releaseLinkedVideoOriginal', 'releaseRead', 'relocateAssistanceModels', 'removeAssistanceModel', 'reportNativeAudioSessionLoss', 'reportNativeAudioSessionTransfer', 'rescanExternalFfmpeg', 'respondToClose', 'restoreNativePluginState', 'reviewNativePluginInstallation', 'runNativePluginOffline', 'scanNativePlugins',
		'collectAssistanceModelGarbage', 'runDesktopAudioCodecOperation', 'runWindowAction', 'setLocale', 'setNativeAudioHelperEnabled', 'setNativePluginBypassed', 'setNativePluginConsent', 'signalReady', 'statDesktopVideoCodecOutput', 'writeChunk', 'writeDesktopVideoCodecInput',
		].sort();
	assert.deepEqual(Object.keys(bridge.v1).sort(), [...baseFields, 'persistentDelivery'].sort());
	const framescaperBridge = exposed.get('framescaperDesktop');
	assert.deepEqual(Object.keys(framescaperBridge.v1).sort(), [...baseFields, 'projectLibrary'].sort());
	assert.equal(Object.hasOwn(framescaperBridge.v1, 'persistentDelivery'), false);
	assert.equal(Object.hasOwn(framescaperBridge.v1, 'v12'), false);
	assert.equal(Object.isFrozen(framescaperBridge.v1.projectLibrary), true);
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
	await bridge.v1.beginWrite({ targetId: 'a'.repeat(48), maximumSize: MAX_DESKTOP_SAVE_BYTES });
	assert.deepEqual(
		{ ...calls[4].value },
		{ targetId: 'a'.repeat(48), maximumSize: MAX_DESKTOP_SAVE_BYTES },
	);
	assert.throws(
		() => bridge.v1.beginWrite({ targetId: 'a'.repeat(48), maximumSize: MAX_DESKTOP_SAVE_BYTES + 1 }),
		/save size is too large/iu,
	);
	assert.equal(calls.length, 5, 'oversized declarations do not cross IPC');
});

function materializedCapabilityUrl(id, name) {
	return `soundscaper-app://bundle/_desktop/read/${READ_PROFILE_MATERIALIZED_V1}/${id}/${encodeURIComponent(name)}`;
}
function materializedDescriptor(id, size) {
	return Object.freeze({ id, size, readProfile: READ_PROFILE_MATERIALIZED_V1 });
}

async function remainsPending(promise) {
	const marker = Symbol('pending');
	return Promise.race([
		Promise.resolve(promise).then(() => false, () => false),
		new Promise((resolve) => setImmediate(resolve, marker)),
	]).then((result) => result === marker);
}

function streamEnd(stream) {
	if (stream.readableEnded) return Promise.resolve();
	return new Promise((resolve, reject) => {
		stream.once('end', resolve);
		stream.once('error', reject);
	});
}
