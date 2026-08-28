/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { parseRiffMarkers } from '../src/common/editor/riff-markers.ts';
import {
	renderMasteringSequenceExport,
} from '../src/common/editor/controller/mastering-sequence-export-render.ts';
import {
	countUnreportedDeliveryConversions,
	createDeliveryReportForPlan,
} from '../src/common/editor/delivery-conversion-inventory.ts';

/**
 * The 6A-1b acceptance, end to end: a fixture sequence delivers with sample-exact
 * region boundaries and gaps, and its cues reopen in the RIFF reader at the
 * emitted positions. The file is written by the real encoder and read back by
 * the real chunk parser — nothing here trusts the writer.
 */

const NOW = '2026-08-18T00:00:00.000Z';
const SAMPLE_RATE = 48_000;

function region(id: string, name: string, startFrame: number, endFrame: number, sequenceId: string) {
	return {
		id, sequenceId, name, kind: 'region', anchor: 'sample',
		startFrame, endFrame, color: 'auto', batchId: null, opaqueExtensions: {},
	};
}

function albumProject() {
	const base = createSoundscaperProject({
		id: 'album', title: 'Album', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
	} as never);
	const sequenceId = base.primarySequenceId;
	return createSoundscaperProject({
		id: 'album', title: 'Album', now: NOW, revision: 0,
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: 240_000, channelCount: 1, sampleRate: SAMPLE_RATE, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source',
			timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 240_000,
		}],
		tracks: [{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['clip'] }],
		masterChannels: 1,
		primarySequenceId: sequenceId,
		sequences: base.sequences,
		timelineAnnotations: [
			region('r-one', 'Opening', 0, 4_800, sequenceId),
			region('r-two', 'Reprise', 100_000, 102_400, sequenceId),
		],
		masteringSequences: [{
			id: 'album-order', sequenceId, name: 'Album order',
			entries: [
				{ id: 'e1', annotationId: 'r-two', title: 'Reprise first' },
				{ id: 'e2', annotationId: 'r-one', gapBeforeFrames: 2_400 },
			],
		}],
	} as never);
}

/** Every frame carries the project position it came from, so a misplacement is audible in the file. */
const RENDER_RUNTIME = {
	audioBufferChannels: (buffer: unknown) => (buffer as { channels: readonly Float32Array[] }).channels,
	copy: { rendering: 'Rendering' },
	renderSnapshot(_snapshot: unknown, range: { startFrame: number; outputFrames: number }) {
		return {
			sampleRate: SAMPLE_RATE,
			channels: [Float32Array.from(
				{ length: range.outputFrames },
				(_value, index) => (range.startFrame + index) / 1_000_000,
			)],
		};
	},
	resampleBuffer: (buffer: { sampleRate: number }) => buffer,
	throwIfAborted() { /* the acceptance render is never cancelled */ },
};

function readChunks(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunks = new Map<string, Uint8Array[]>();
	for (let offset = 12; offset + 8 <= bytes.byteLength;) {
		const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
		const size = view.getUint32(offset + 4, true);
		const payload = bytes.subarray(offset + 8, offset + 8 + size);
		chunks.set(id, [...(chunks.get(id) ?? []), payload]);
		offset += 8 + size + (size & 1);
	}
	return chunks;
}

test('a fixture sequence delivers sample-exact boundaries and cues that reopen where they were written', async () => {
	const project = albumProject();
	const plan = createExportPlan(project, {
		format: 'wav', masteringSequenceId: 'album-order', sampleFormat: 'float32', bitDepth: 32,
		channelMapping: 'preserve', inputChannelCount: 1,
	});

	// 2400 (region two) + 2400 gap + 4800 (region one).
	assert.equal(plan.outputFrames, 9_600);
	assert.equal(plan.masteringSequence?.totalFrames, 9_600);

	const delivered = await renderMasteringSequenceExport(RENDER_RUNTIME as never, {
		channelCount: 1,
		chunkSources: null,
		deliveryPlan: plan.masteringSequence!,
		outputSampleRate: plan.sampleRate,
		prepareTimePitchCaches: false,
		progressRange: { start: 0, end: 1 },
		renderSampleRate: SAMPLE_RATE,
		signal: new AbortController().signal,
		snapshot: { sampleRate: SAMPLE_RATE },
		sourceMap: new Map(),
	});
	assert.equal(delivered.length, 9_600);

	const bytes = encodeWav(delivered.channels, {
		sampleRate: plan.sampleRate,
		bitDepth: 32,
		float: true,
		dither: 'none',
		markers: plan.markers,
	});
	const chunks = readChunks(bytes);

	// Boundaries: the delivered samples say which project position they came from.
	const data = chunks.get('data')![0];
	const samples = new Float32Array(
		data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
	);
	assert.equal(samples.length, 9_600);
	assert.equal(Math.round(samples[0] * 1_000_000), 100_000, 'the reprise is delivered first');
	assert.equal(Math.round(samples[2_399] * 1_000_000), 102_399, 'and ends exactly at its region end');
	assert.deepEqual([...samples.subarray(2_400, 4_800)], Array.from({ length: 2_400 }, () => 0),
		'the authored gap is real silence, exactly as long as it was authored');
	assert.equal(Math.round(samples[4_800] * 1_000_000), 0, 'then the opening region, from its first frame');
	assert.equal(Math.round(samples[9_599] * 1_000_000), 4_799);

	// Cues: reopened by the real parser, at the positions the plan emitted.
	const markers = parseRiffMarkers(
		chunks.get('cue ')![0],
		(chunks.get('LIST') ?? [])
			.filter((payload) => String.fromCharCode(...payload.subarray(0, 4)) === 'adtl')
			.map((payload) => payload.subarray(4)),
	);
	assert.deepEqual(markers.map(({ sampleOffset, sampleLength, label }) => ({ sampleOffset, sampleLength, label })), [
		{ sampleOffset: 0, sampleLength: 2_400, label: 'Reprise first' },
		{ sampleOffset: 4_800, sampleLength: 4_800, label: 'Opening' },
	]);

	// And the delivery reports itself completely.
	const report = createDeliveryReportForPlan(plan, { sampleRate: project.sampleRate });
	assert.equal(countUnreportedDeliveryConversions(plan, { sampleRate: project.sampleRate }, report), 0);
	assert.deepEqual(
		report.items.filter(({ code }) => code === 'delivery.mastering-sequence-entry')
			.map(({ data: item }) => item.outputStartFrame),
		[0, 4_800],
	);
	assert.ok(report.items.some(({ code }) => code === 'delivery.mastering-sequence-cues'));
});

test('the same sequence into a format without cues reports the omission the gate counts', () => {
	const project = albumProject();
	const plan = createExportPlan(project, { format: 'mp3', masteringSequenceId: 'album-order' });
	const report = createDeliveryReportForPlan(plan, { sampleRate: project.sampleRate });

	assert.equal(
		report.items.find(({ code }) => code === 'delivery.mastering-sequence-cues-omitted')?.disposition,
		'omitted',
	);
	assert.equal(countUnreportedDeliveryConversions(plan, { sampleRate: project.sampleRate }, report), 0);
	assert.equal(
		countUnreportedDeliveryConversions(plan, { sampleRate: project.sampleRate }, {
			items: report.items.filter(({ code }) => code !== 'delivery.mastering-sequence-cues-omitted'),
		}),
		1,
		'delivery.unreportedConversions observes the omission',
	);
});
