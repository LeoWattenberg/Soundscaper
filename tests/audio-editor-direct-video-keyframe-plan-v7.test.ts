/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	prepareDirectVideoDestination,
} from '../src/common/editor/controller/direct-video-export.ts';
import {
	createVideoKeyframeExportPlanV7,
} from '../src/common/editor/video-keyframe-export-plan-v7.ts';

test('admits detached canonical V7 plans for browser and deferred desktop direct targets', async () => {
	const browser = harness(false);
	const browserPlan = detachedPlan();
	const browserPrepared = await prepareDirectVideoDestination(
		browser.fileService, browserPlan, 'Keyed.mp4', {}, new AbortController().signal,
	);
	assert.ok(browserPrepared.destination);
	assert.deepEqual(browser.events, ['prepare']);

	const desktop = harness(true);
	const desktopPrepared = await prepareDirectVideoDestination(
		desktop.fileService, detachedPlan(), 'Keyed.mp4', {}, new AbortController().signal,
	);
	assert.ok(desktopPrepared.destination);
	assert.deepEqual(desktop.events, []);
	await desktopPrepared.destination.open(4);
	assert.deepEqual(desktop.events, ['prepare', 'createWritable:4:exact']);
});

test('refuses post-selection V7 mutation before opening a direct stream', async () => {
	const fixture = harness(false);
	const plan = detachedPlan();
	const prepared = await prepareDirectVideoDestination(
		fixture.fileService, plan, 'Keyed.mp4', {}, new AbortController().signal,
	);
	assert.ok(prepared.destination);
	plan.outputFrameCount += 1;
	await assert.rejects(() => prepared.destination!.open(4), /plan changed/iu);
	assert.deepEqual(fixture.events, ['prepare']);
});

test('refuses an oversized detached V7 plan before opening a direct chooser', async () => {
	const fixture = harness(false);
	const plan = detachedPlan() as unknown as Record<string, unknown>;
	const canvas = plan.canvas as Record<string, unknown>;
	canvas.width = 1_282;
	const prepared = await prepareDirectVideoDestination(
		fixture.fileService, plan, 'Keyed.mp4', {}, new AbortController().signal,
	);
	assert.equal(prepared.destination, null);
	assert.deepEqual(fixture.events, []);
});

function detachedPlan() {
	return JSON.parse(JSON.stringify(createVideoKeyframeExportPlanV7({
		format: 'mp4', sampleRate: 48_000,
		range: { startFrame: 0, endFrame: 48_000, durationFrames: 48_000 },
		canvas: {
			width: 640, height: 360, frameRate: { num: 30_000, den: 1_001 },
			pixelFormat: 'yuv420p', backgroundColor: '#000000',
			referenceClipId: 'clip', referenceSourceId: 'source',
		},
		activeClipIds: ['clip'], activeSourceIds: ['source'],
		sources: [{
			kind: 'video', id: 'source', storageKey: 'source-key', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32),
		}],
		includeAudio: true, audioFileName: 'audio-mix.wav',
	}))) as ReturnType<typeof createVideoKeyframeExportPlanV7> & { outputFrameCount: number };
}

function harness(desktop: boolean) {
	const events: string[] = [];
	let written = 0;
	const prepared = {
		mode: 'stream' as const,
		async createWritable(byteLength: number, sizeMode: 'exact') {
			events.push(`createWritable:${String(byteLength)}:${sizeMode}`);
			return new WritableStream<Uint8Array>({ write(chunk) { written += chunk.byteLength; } });
		},
		bytesWritten: () => written,
		commit: () => ({ size: written }),
		abort() {},
	};
	return {
		events,
		fileService: {
			isDesktop: desktop,
			prepareSave() { events.push('prepare'); return prepared; },
		},
	};
}
