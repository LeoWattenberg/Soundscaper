/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createControllerResources } from '../src/common/editor/controller/composition/controller-resources.ts';
import { createEditorCodecRuntime as createDesktopRuntime } from '../src/common/editor/editor-codec-runtime.desktop.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import type { AudioEncodeStreamRequest, AudioEncodeStreamResponse } from '../src/common/editor/browser-audio-encode-stream-client.ts';
import type { FileSizeWarning } from '../src/common/editor/controller/shared/file-size-warning.ts';
import type { DesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';
import type { DesktopAudioStreamCommand } from '../desktop/desktop-audio-stream-contract.ts';

const frames = 40_000;
const output = new Uint8Array(Math.ceil(frames / 1152) * 576);
for (let offset = 0; offset < output.length; offset += 576) output.set([0xff, 0xfd, 0xa4, 0], offset);
const wav = new Blob([Uint8Array.from(encodeWav([new Float32Array(frames), new Float32Array(frames)],
	{ sampleRate: 48_000, bitDepth: 32, float: true }))]);
const callbacks = { copy: { staffPadRangeWarning: '{stageCount} stages', ffmpegLoading: 'Loading' },
	onPosition() {}, onMeter() {}, onState() {}, setStatus() {}, updateExportProgress() {} };

test('production browser controller resources retain the warning port through incremental encoding', async () => {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	Object.defineProperty(globalThis, 'Worker', { configurable: true, value: EncoderWorker });
	try {
		for (const accepted of [true, false]) {
			let prompts = 0;
			const resources = createControllerResources({ confirmFileSizeWarning: async (warning: FileSizeWarning) => {
				prompts += 1;
				assert.deepEqual(warning, { label: 'Compressed audio export', byteLength: output.length, thresholdBytes: 1 });
				assert.equal(EncoderWorker.last?.finished, false);
				return accepted;
			} }, callbacks);
			try {
				const operation = resources.ffmpeg.encodeFile(wav, 'mp2', { maximumOutputBytes: 1, bitRate: 192 });
				if (accepted) {
					const result = await operation;
					assert.ok('blob' in result && result.blob instanceof Blob);
					assert.equal(result.blob.size, output.length);
					assert.ok('cleanup' in result && typeof result.cleanup === 'function');
					await (result.cleanup as () => Promise<void>)();
				} else await assert.rejects(operation, { name: 'AbortError' });
				assert.equal(prompts, 1);
				assert.equal(EncoderWorker.last?.finished, accepted);
				assert.equal(EncoderWorker.last?.terminated, true);
				const override = resources.ffmpeg.encodeFile(wav, 'mp2', { maximumOutputBytes: 1, bitRate: 192,
					confirmFileSizeWarning: async () => false });
				await assert.rejects(override, { name: 'AbortError' });
				assert.equal(prompts, 1, 'the operation callback takes precedence over the controller default');
			} finally {
				await resources.clipTimePitchCache.dispose?.(); await resources.engine.dispose();
				resources.ffmpeg.dispose(); resources.nyquistClient?.dispose(); await resources.store.close();
			}
		}
	} finally {
		if (original) Object.defineProperty(globalThis, 'Worker', original);
		else Reflect.deleteProperty(globalThis, 'Worker');
	}
});

test('production desktop codec composition retains its default warning port before output reads', async () => {
	const desktopFrames = 4_200_000;
	const desktopOutput = new Uint8Array(Math.ceil(desktopFrames / 1152) * 576);
	for (let offset = 0; offset < desktopOutput.length; offset += 576) desktopOutput.set([0xff, 0xfd, 0xa4, 0], offset);
	const desktopWav = new Blob([Uint8Array.from(encodeWav([new Float32Array(desktopFrames), new Float32Array(desktopFrames)],
		{ sampleRate: 48_000, bitDepth: 32, float: true }))]);
	for (const accepted of [true, false]) {
		let prompts = 0; let reads = 0; let deletes = 0;
		const runtime = createDesktopRuntime({ confirmFileSizeWarning: async (warning: FileSizeWarning) => {
			prompts += 1; assert.equal(reads, 0); assert.equal(warning.byteLength, desktopOutput.length); return accepted;
		}, fileService: {
			getDesktopAudioCodecCapabilities(query: DesktopAudioCodecCapabilityQuery) {
				return { schemaVersion: 2, capabilities: query.operations.map((entry) => ({ ...entry,
					available: true, provider: 'bundled', reason: null })) };
			},
			runDesktopAudioCodecOperation() { throw new Error('The production streamed route must be selected.'); },
			cancelDesktopAudioCodecOperation() { return true; },
			runDesktopAudioCodecStreamCommand(command: DesktopAudioStreamCommand) {
				if (command.type === 'begin') return { operationId: `desktop-audio-stream-${'a'.repeat(32)}` };
				if (command.type === 'write') return { offset: command.offset + command.bytes.length };
				if (command.type === 'execute') return { byteLength: desktopOutput.length };
				if (command.type === 'read') { reads += 1; return desktopOutput.slice(command.offset, command.offset + command.maximumBytes); }
				if (command.type === 'delete') { deletes += 1; return true; }
				throw new Error('Unexpected stream command.');
			},
		} });
		try {
			const operation = runtime.encodeFile(desktopWav, 'mp2', { maximumOutputBytes: 1, bitRate: 192 });
			if (accepted) { const result = await operation; assert.equal(result.blob?.size, desktopOutput.length); await result.cleanup?.(); }
			else await assert.rejects(operation, { name: 'AbortError' });
			assert.equal(prompts, 1); assert.equal(reads > 0, accepted); assert.equal(deletes, 1);
		} finally { runtime.dispose(); }
	}
});

class EncoderWorker {
	static last: EncoderWorker | null = null;
	readonly listeners = new Set<(event: MessageEvent<AudioEncodeStreamResponse>) => void>();
	finished = false; terminated = false; wrote = false;
	constructor() { EncoderWorker.last = this; }
	addEventListener(type: string, listener: (event: MessageEvent<AudioEncodeStreamResponse>) => void) {
		if (type === 'message') this.listeners.add(listener);
	}
	postMessage(request: AudioEncodeStreamRequest) {
		let bytes = new Uint8Array(new ArrayBuffer(0));
		if (request.operation === 'write' && !this.wrote) { bytes = Uint8Array.from(output); this.wrote = true; }
		if (request.operation === 'finish') this.finished = true;
		queueMicrotask(() => {
			for (const listener of this.listeners) listener(new MessageEvent('message', {
				data: { id: request.id, status: 'ok', bytes: bytes.buffer },
			}));
		});
	}
	terminate() { this.terminated = true; }
}
