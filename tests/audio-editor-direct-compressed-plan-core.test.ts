/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	captureCanonicalCompressedPlanCore,
	captureDirectCompressedContract,
	type DirectCompressedFormat,
	type DirectCompressedPlan,
} from '../src/common/editor/controller/direct-compressed-plan.ts';
import { createExportPlan } from '../src/common/editor/export.js';

interface FormatCase {
	readonly format: DirectCompressedFormat;
	readonly options: Readonly<Record<string, unknown>>;
}

interface StemPlan extends DirectCompressedPlan {
	readonly archive: Readonly<{ readonly format: string }>;
	readonly encoding: Readonly<Record<string, unknown>>;
	readonly render: Readonly<Record<string, unknown>>;
}

const FORMAT_CASES: readonly FormatCase[] = Object.freeze([
	{ format: 'mp3', options: { bitRate: 320 } },
	{ format: 'flac', options: { sampleFormat: 'int16', compressionLevel: 8, dither: 'triangular-highpass', channelMapping: 'mono' } },
	{ format: 'ogg-vorbis', options: { quality: -1, channelMapping: { channels: [0, 1, 0] } } },
	{ format: 'opus', options: { bitRate: 320 } },
	{ format: 'wavpack', options: { sampleFormat: 'int32', compressionLevel: 5, dither: 'triangular-highpass' } },
	{ format: 'mp2', options: { bitRate: 384, channelMapping: 'mono' } },
	{ format: 'aac-m4a', options: { bitRate: 320 } },
]);

test('actual realtime compressed ZIP stem plans satisfy only the shared canonical core', () => {
	for (const entry of FORMAT_CASES) {
		const plan = actualStemPlan(entry.format, entry.options);
		const core = captureCanonicalCompressedPlanCore(plan);
		assert.ok(core, entry.format);
		assert.equal(core.id, entry.format);
		assert.equal(core.sampleRate, plan.sampleRate);
		assert.equal(core.channelCount, plan.channelCount);
		assert.equal(core.outputFrames, plan.outputFrames);
		assert.equal(core.outputBytesPerRender, plan.outputBytesPerRender);
		assert.equal(plan.render.strategy, 'realtime-stream', entry.format);
		assert.equal(plan.archive.format, 'zip', entry.format);
		assert.equal(captureDirectCompressedContract(plan), null, entry.format);
	}
});

test('the shared core rejects noncompressed routes and malformed canonical fields', () => {
	const mp3 = actualStemPlan('mp3', { bitRate: 320 });
	const ineligible: readonly Readonly<{ label: string; plan: DirectCompressedPlan }>[] = [
		{ label: 'native descriptor', plan: actualStemPlan('wav') },
		{
			label: 'custom descriptor',
			plan: actualStemPlan('custom-ffmpeg', {
				extension: 'foo', mimeType: 'audio/x-foo', customArguments: ['-c:a', 'copy'],
			}),
		},
		changedPlan(mp3, 'descriptor MIME', (plan) => { plan.mimeType = 'audio/mp3'; }),
		changedPlan(mp3, 'encoding backend', (plan) => { record(plan.encoding).backend = 'native-wav'; }),
		changedPlan(mp3, 'encoding extension', (plan) => { record(plan.encoding).extension = 'mpeg'; }),
		changedPlan(mp3, 'noncanonical bitrate', (plan) => { record(plan.encoding).bitRate = 191; }),
		changedPlan(mp3, 'encoding sample rate', (plan) => { record(plan.encoding).sampleRate = 44_100; }),
		changedPlan(mp3, 'mapping geometry', (plan) => {
			record(record(plan.encoding).channelMapping).outputChannelCount = 1;
		}),
		changedPlan(mp3, 'mapping drift', (plan) => { record(plan.channelMapping).mode = 'mono'; }),
		changedPlan(mp3, 'metadata drift', (plan) => { plan.metadata = { title: 'changed' }; }),
		changedPlan(mp3, 'dither boolean', (plan) => { plan.dither = true; }),
		changedPlan(mp3, 'dither mode', (plan) => { plan.ditherMode = 'triangular'; }),
		changedPlan(mp3, 'range duration', (plan) => { record(plan.range).durationFrames = 2; }),
		changedPlan(mp3, 'range order', (plan) => { record(plan.range).endFrame = 0; }),
		changedPlan(mp3, 'output geometry', (plan) => { plan.outputBytesPerRender = 7; }),
		changedPlan(mp3, 'unsafe output arithmetic', (plan) => {
			plan.outputFrames = Number.MAX_SAFE_INTEGER;
			plan.outputBytesPerRender = Number.MAX_SAFE_INTEGER;
		}),
		changedPlan(mp3, 'render output geometry', (plan) => { record(plan.render).outputBytes = 7; }),
		changedPlan(mp3, 'render total geometry', (plan) => { record(plan.render).totalBytes = 7; }),
		changedPlan(mp3, 'render live geometry', (plan) => { record(plan.render).livePcmBytes = -1; }),
		changedPlan(mp3, 'render thresholds', (plan) => { record(record(plan.render).thresholds).outputBytes = 7; }),
	];

	for (const entry of ineligible) {
		assert.equal(captureCanonicalCompressedPlanCore(entry.plan), null, entry.label);
	}
});

test('the shared core fingerprints canonical field drift without claiming route fields', () => {
	const plan = actualStemPlan('opus', { bitRate: 160 });
	const captured = captureCanonicalCompressedPlanCore(plan);
	assert.ok(captured);

	const metadataDrift = structuredClone(plan) as unknown as Record<string, unknown>;
	metadataDrift.metadata = { artist: 'Changed' };
	record(metadataDrift.encoding).metadata = { artist: 'Changed' };
	const drifted = captureCanonicalCompressedPlanCore(metadataDrift);
	assert.ok(drifted);
	assert.notEqual(drifted.fingerprint, captured.fingerprint);

	const routeDrift = structuredClone(plan) as unknown as Record<string, unknown>;
	routeDrift.mode = 'mix';
	routeDrift.outputs = [];
	routeDrift.archive = null;
	routeDrift.requiredTemporaryBytes = 1;
	record(routeDrift.render).strategy = 'offline';
	assert.equal(captureCanonicalCompressedPlanCore(routeDrift)?.fingerprint, captured.fingerprint);
});

function actualStemPlan(
	format: string,
	options: Readonly<Record<string, unknown>> = {},
): StemPlan {
	return createExportPlan(projectFixture(), {
		mode: 'stems', format, includeTail: false, livePcmBytes: 2 * 1024 ** 3,
		metadata: { artist: 'Codex', title: format }, date: '2026-08-02', ...options,
	}) as unknown as StemPlan;
}

function changedPlan(
	base: unknown,
	label: string,
	change: (plan: Record<string, unknown>) => void,
): Readonly<{ label: string; plan: DirectCompressedPlan }> {
	const plan = structuredClone(base) as Record<string, unknown>;
	change(plan);
	return { label, plan };
}

function record(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}

function projectFixture() {
	return {
		schemaVersion: 9, id: 'compressed-stem-project', title: 'Session', revision: 1,
		createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
		sampleRate: 48_000, masterChannels: 2, metadata: {},
		selection: { startFrame: 0, endFrame: 1 }, loop: { enabled: false, startFrame: 0, endFrame: 1 },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: 1, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames: 1,
		}],
		tracks: [
			{ id: 'track-1', type: 'audio', name: 'Voice', clipIds: ['clip'], effectsActive: true, effects: [] },
			{ id: 'track-2', type: 'audio', name: 'Music', clipIds: [], effectsActive: true, effects: [] },
		],
		mixer: { groups: [], sends: [], routes: {} }, master: { effectsActive: true, effects: [] },
	};
}
