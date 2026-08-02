/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	encodeDirectOfflinePcm,
} from '../src/common/editor/controller/direct-offline-pcm-export.ts';
import {
	DIRECT_PCM_RENDER_CHUNK_FRAMES,
	type DirectPcmContainerEncoder,
	type DirectPcmDestination,
} from '../src/common/editor/controller/direct-pcm-export.ts';
import { createExportPlan } from '../src/common/editor/export.js';

test('offline PCM encoding drains bounded awaited planar blocks into one exact destination', async () => {
	const frameCount = DIRECT_PCM_RENDER_CHUNK_FRAMES * 2 + 7;
	const plan = offlineWavPlan(frameCount);
	const destination = destinationFixture();
	const encoder = encoderFixture(plan);
	const channels = renderedChannels(plan.channelCount, frameCount);
	const currentChecks: number[] = [];

	const output = await encodeDirectOfflinePcm({
		assertCurrent() { currentChecks.push(destination.bytesWritten()); },
		channels,
		createEncoder: encoder.create,
		destination,
		encoderOptions: { sampleRate: plan.sampleRate, probe: 'offline' },
		plan,
		signal: new AbortController().signal,
	});

	assert.deepEqual(encoder.blockFrames, [
		DIRECT_PCM_RENDER_CHUNK_FRAMES,
		DIRECT_PCM_RENDER_CHUNK_FRAMES,
		7,
	]);
	assert.equal(currentChecks.length >= 2 * encoder.blockFrames.length + 4, true);
	assert.equal(destination.closeCalls(), 1);
	assert.equal(destination.bytesWritten(), plan.outputFileBytesPerRender);
	assert.deepEqual(output, {
		blob: null,
		bytes: null,
		byteLength: plan.outputFileBytesPerRender,
		directDestination: destination,
		mimeType: 'audio/wav',
	});
	assert.equal(encoder.options[0]?.probe, 'offline');
});

test('offline PCM encoding rejects malformed geometry before constructing an encoder', async () => {
	const plan = offlineWavPlan(4);
	for (const [label, candidatePlan, channels] of [
		['bare offline plan', { ...plan, render: { strategy: 'offline' } }, renderedChannels(2, 4)],
		['wrong channel count', plan, renderedChannels(1, 4)],
		['wrong frame count', plan, renderedChannels(2, 3)],
		['non-Float32 channel', plan, [new Uint8Array(4), new Float32Array(4)]],
	] as const) {
		let encoders = 0;
		const destination = destinationFixture();
		await assert.rejects(
			encodeDirectOfflinePcm({
				assertCurrent() {},
				channels: channels as readonly Float32Array[],
				createEncoder() { encoders += 1; throw new Error('encoder reached'); },
				destination,
				encoderOptions: {},
				plan: candidatePlan,
				signal: new AbortController().signal,
			}),
			/offline PCM|channel|frame/iu,
			label,
		);
		assert.equal(encoders, 0, label);
		assert.equal(destination.chunks.length, 0, label);
	}
});

test('offline PCM encoding stops after currentness loss and never seals the destination', async () => {
	const plan = offlineWavPlan(DIRECT_PCM_RENDER_CHUNK_FRAMES + 1);
	const destination = destinationFixture();
	const encoder = encoderFixture(plan);
	const stale = new Error('project changed');
	await assert.rejects(
		encodeDirectOfflinePcm({
			assertCurrent() { if (encoder.blockFrames.length === 1) throw stale; },
			channels: renderedChannels(2, plan.outputFrames),
			createEncoder: encoder.create,
			destination,
			encoderOptions: {},
			plan,
			signal: new AbortController().signal,
		}),
		(error) => error === stale,
	);
	assert.deepEqual(encoder.blockFrames, [DIRECT_PCM_RENDER_CHUNK_FRAMES]);
	assert.equal(destination.closeCalls(), 0);
});

test('offline PCM encoding refuses encoder and destination count drift after close', async () => {
	const plan = offlineWavPlan(4);
	for (const [label, encoderBytes, reportedDelta] of [
		['encoder', plan.outputFileBytesPerRender + 1, 0],
		['destination', plan.outputFileBytesPerRender, 1],
	] as const) {
		const destination = destinationFixture(reportedDelta);
		const encoder = encoderFixture(plan, encoderBytes);
		await assert.rejects(
			encodeDirectOfflinePcm({
				assertCurrent() {},
				channels: renderedChannels(2, 4),
				createEncoder: encoder.create,
				destination,
				encoderOptions: {},
				plan,
				signal: new AbortController().signal,
			}),
			/byte count|planned file size|destination/iu,
			label,
		);
		assert.equal(destination.closeCalls(), 1, label);
	}
});

function encoderFixture(
	plan: ReturnType<typeof offlineWavPlan>,
	finalByteLength = plan.outputFileBytesPerRender,
) {
	const blockFrames: number[] = [];
	const options: Array<Readonly<Record<string, unknown>>> = [];
	const bytesPerFrame = plan.channelCount * 3;
	const headerBytes = plan.outputFileBytesPerRender - plan.outputFrames * bytesPerFrame;
	return {
		blockFrames,
		options,
		create(encoderOptions: Readonly<Record<string, unknown>>): DirectPcmContainerEncoder {
			options.push(encoderOptions);
			const onChunk = encoderOptions.onChunk as (chunk: Uint8Array) => void;
			onChunk(new Uint8Array(headerBytes));
			return {
				write(channels) {
					const frames = channels[0]?.length ?? 0;
					blockFrames.push(frames);
					onChunk(new Uint8Array(frames * bytesPerFrame));
				},
				finalize() { return { byteLength: finalByteLength }; },
			};
		},
	};
}

function destinationFixture(reportedDelta = 0): DirectPcmDestination & Readonly<{
	readonly chunks: Uint8Array[];
	closeCalls(): number;
}> {
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	let closes = 0;
	return {
		chunks,
		async write(chunk) { chunks.push(chunk.slice()); byteLength += chunk.byteLength; },
		async close() { closes += 1; },
		async abort() {},
		bytesWritten: () => byteLength + reportedDelta,
		async commit() { return { fileName: 'mix.wav', method: 'memory', size: byteLength }; },
		closeCalls: () => closes,
	};
}

function renderedChannels(channelCount: number, frameCount: number): readonly Float32Array[] {
	return Array.from({ length: channelCount }, (_, channel) => (
		Float32Array.from({ length: frameCount }, (_value, frame) => (frame + channel) / 100)
	));
}

function offlineWavPlan(frameCount: number) {
	const plan = createExportPlan(projectFixture(frameCount), {
		format: 'wav', bitDepth: 24, includeTail: false, livePcmBytes: 0,
		date: '2026-08-02',
	});
	if (plan.outputFileBytesPerRender === null) throw new Error('Expected an exact WAV file layout.');
	return plan as typeof plan & Readonly<{ readonly outputFileBytesPerRender: number }>;
}

function projectFixture(frameCount: number) {
	return {
		schemaVersion: 9, id: 'offline-pcm', title: 'Offline PCM', revision: 1,
		createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
		sampleRate: 48_000, masterChannels: 2, metadata: {},
		selection: { startFrame: 0, endFrame: frameCount },
		loop: { enabled: false, startFrame: 0, endFrame: frameCount },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames: frameCount,
		}],
		tracks: [{
			id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'],
			effectsActive: true, effects: [],
		}],
		mixer: { groups: [], sends: [], routes: {} },
		master: { effectsActive: true, effects: [] },
	};
}
