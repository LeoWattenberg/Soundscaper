/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import * as editor from '../src/common/editor/index.js';
import {
	createPlatformCapabilitiesSnapshot,
	type PlatformCapabilityScope,
} from '../src/common/editor/platform-capabilities.ts';

function runtimeConstructor(): () => void {
	return function RuntimeConstructor() {};
}

function completeWebScope(): PlatformCapabilityScope {
	const AudioContextConstructor = runtimeConstructor();
	Object.assign(AudioContextConstructor.prototype, { setSinkId() {} });
	const MediaElementConstructor = runtimeConstructor();
	Object.assign(MediaElementConstructor.prototype, { setSinkId() {} });

	return {
		indexedDB: { open() {} },
		navigator: {
			storage: {
				estimate() {},
				persist() {},
				persisted() {},
				getDirectory() {},
			},
		},
		document: { createElement() {} },
		URL: { createObjectURL() {} },
		Blob: runtimeConstructor(),
		Worker: runtimeConstructor(),
		WebAssembly: { instantiate() {} },
		AudioContext: AudioContextConstructor,
		OfflineAudioContext: runtimeConstructor(),
		AudioWorkletNode: runtimeConstructor(),
		HTMLMediaElement: MediaElementConstructor,
		CanvasRenderingContext2D: runtimeConstructor(),
		WebGL2RenderingContext: runtimeConstructor(),
		MediaSource: runtimeConstructor(),
		AudioDecoder: runtimeConstructor(),
		VideoDecoder: runtimeConstructor(),
		AudioEncoder: runtimeConstructor(),
		VideoEncoder: runtimeConstructor(),
		FileSystemFileHandle: {
			prototype: { createSyncAccessHandle() {} },
		},
		showOpenFilePicker() {},
		showSaveFilePicker() {},
		showDirectoryPicker() {},
	};
}

function completeDesktopBridge(): Record<string, unknown> {
	return {
		version: 1,
		getEnvironment() {},
		chooseFiles() {},
		releaseRead() {},
		chooseSaveTarget() {},
		beginWrite() {},
		writeChunk() {},
		finishWrite() {},
		abortWrite() {},
		signalReady() {},
		onCloseRequested() {},
		respondToClose() {},
	};
}

function assertDeepFrozen(value: unknown): void {
	if (!value || typeof value !== 'object') return;
	assert.equal(Object.isFrozen(value), true);
	for (const child of Object.values(value)) assertDeepFrozen(child);
}

test('platform capabilities rely on runtime evidence and never a user-agent claim', () => {
	const scope = {
		navigator: {
			userAgent: 'Mozilla/5.0 Chrome/999 Electron/999 Safari/999',
		},
	} as unknown as PlatformCapabilityScope;
	const snapshot = createPlatformCapabilitiesSnapshot({ scope });

	assert.equal(snapshot.runtime, 'web');
	assert.deepEqual(snapshot.apis.storage, {
		indexedDb: false,
		storageEstimate: false,
		persistentStorage: false,
		opfs: false,
		opfsSyncAccess: false,
	});
	assert.deepEqual(snapshot.apis.audio, {
		audioContext: false,
		offlineAudioContext: false,
		audioWorklet: false,
		outputDeviceSelection: false,
	});
	assert.equal(snapshot.tiers.webCore, 'unavailable');
	assert.equal(snapshot.tiers.webEnhanced, 'unavailable');
	assert.equal(snapshot.tiers.electronEnhanced, 'unavailable');
	assert.equal(snapshot.tiers.electronOnly, 'unavailable');
});

test('platform capabilities distinguish browser APIs from proven initialized adapters', () => {
	const snapshot = createPlatformCapabilitiesSnapshot({
		scope: completeWebScope(),
		adapters: {
			projectStore: {
				ready: true,
				backend: 'indexeddb',
				opfsSourceStorageReady: true,
			},
			audioEngineReady: true,
			videoFrameExtractionReady: true,
			ffmpegReady: true,
			webCodecsReady: true,
		},
	});

	assert.equal(snapshot.runtime, 'web');
	assert.deepEqual(snapshot.apis.storage, {
		indexedDb: true,
		storageEstimate: true,
		persistentStorage: true,
		opfs: true,
		opfsSyncAccess: true,
	});
	assert.deepEqual(snapshot.apis.fileSystem, {
		browserDownload: true,
		openFilePicker: true,
		saveFilePicker: true,
		directoryPicker: true,
	});
	assert.deepEqual(snapshot.apis.media, {
		browserMediaElements: true,
		canvas2d: true,
		webGl2: true,
		mediaSource: true,
		webCodecsAudioDecode: true,
		webCodecsVideoDecode: true,
		webCodecsAudioEncode: true,
		webCodecsVideoEncode: true,
	});
	assert.deepEqual(snapshot.apis.audio, {
		audioContext: true,
		offlineAudioContext: true,
		audioWorklet: true,
		outputDeviceSelection: true,
	});
	assert.deepEqual(snapshot.adapters.storage, {
		projectStoreReady: true,
		backend: 'indexeddb',
		opfsSourceStorageReady: true,
	});
	assert.deepEqual(snapshot.adapters.media, {
		videoFrameExtractionReady: true,
		ffmpegReady: true,
		webCodecsReady: true,
	});
	assert.equal(snapshot.adapters.audio.engineReady, true);
	assert.equal(snapshot.tiers.webCore, 'available');
	assert.equal(snapshot.tiers.webEnhanced, 'available');
	assert.equal(snapshot.tiers.electronEnhanced, 'unavailable');
});

test('platform capabilities require complete desktop adapter surfaces', () => {
	const bridge = completeDesktopBridge();
	const snapshot = createPlatformCapabilitiesSnapshot({
		scope: {
			...completeWebScope(),
			scapeDesktop: { v1: bridge },
		},
	});

	assert.equal(snapshot.runtime, 'electron');
	assert.deepEqual(snapshot.adapters.desktop, {
		bridgeDetected: true,
		bridgeReady: true,
		environmentReady: true,
		scopedFileReadsReady: true,
		atomicChunkedWritesReady: true,
		lifecycleReady: true,
	});
	assert.equal(snapshot.tiers.electronEnhanced, 'available');
	assert.equal(snapshot.tiers.electronOnly, 'unavailable');

	const partial = createPlatformCapabilitiesSnapshot({
		scope: { scapeDesktop: { v1: { version: 1, getEnvironment() {} } } },
	});
	assert.equal(partial.runtime, 'electron');
	assert.equal(partial.adapters.desktop.bridgeReady, false);
	assert.equal(partial.tiers.electronEnhanced, 'partial');
});

test('platform capability adapter claims are clamped to detected prerequisites', () => {
	const snapshot = createPlatformCapabilitiesSnapshot({
		scope: {},
		adapters: {
			projectStore: {
				ready: true,
				backend: 'memory',
				opfsSourceStorageReady: true,
			},
			audioEngineReady: true,
			videoFrameExtractionReady: true,
			ffmpegReady: true,
			webCodecsReady: true,
		},
	});

	assert.deepEqual(snapshot.adapters.storage, {
		projectStoreReady: true,
		backend: 'memory',
		opfsSourceStorageReady: false,
	});
	assert.deepEqual(snapshot.adapters.media, {
		videoFrameExtractionReady: false,
		ffmpegReady: false,
		webCodecsReady: false,
	});
	assert.equal(snapshot.adapters.audio.engineReady, false);
	assert.equal(snapshot.tiers.webCore, 'partial');
});

test('platform capability snapshots are deeply frozen and omit deferred capture contracts', () => {
	const snapshot = createPlatformCapabilitiesSnapshot({ scope: completeWebScope() });
	assertDeepFrozen(snapshot);
	const serialized = JSON.stringify(snapshot);
	assert.doesNotMatch(serialized, /midi|camera|getUserMedia|getDisplayMedia|mediaRecorder|recording/i);
	assert.equal(editor.createPlatformCapabilitiesSnapshot, createPlatformCapabilitiesSnapshot);
});
