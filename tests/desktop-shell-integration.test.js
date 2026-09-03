import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { PendingProjectQueue, extractAup4Paths, extractProjectPaths } from '../desktop/file-associations.js';
import { acceptsSystemAudioRequest, selectSystemAudioStreams } from '../desktop/display-capture.js';
import {
	acceptsFile,
	mimeTypeForPath,
	validateDeclaredSize,
	validateSaveChoice,
} from '../desktop/validation.js';
import { MAX_DESKTOP_SAVE_BYTES, MAX_SAVE_BYTES } from '../desktop/constants.js';

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
