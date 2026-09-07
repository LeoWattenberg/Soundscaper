/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

/**
 * A trimmed video clip keeps its in-point in the exported timeline.
 *
 * A persisted video clip states its source in-point in the source's own frames,
 * while its timeline coordinates are project samples. The exporter converted
 * both with the same samples-to-frames divisor, so a clip trimmed ten seconds
 * into its media was written out as starting at the head of the media: every
 * trim vanished from the interchange file and nothing in the delivery report
 * said so.
 */

const NOW = '2026-09-07T09:00:00.000Z';
const SAMPLE_RATE = 48_000;
const PAL = Object.freeze({ num: 25, den: 1 });

interface ExportedClip {
	readonly source_range: {
		readonly start_time: { readonly value: number };
		readonly duration: { readonly value: number };
	};
}

function deliveredProject(
	clipOverrides: Record<string, unknown>,
	sourceOverrides: Record<string, unknown> = {},
): Readonly<Record<string, unknown>> {
	const project = createSoundscaperProject({
		id: 'otio-in-point', title: 'Trimmed picture', now: NOW, sampleRate: SAMPLE_RATE,
		sources: [createVideoSource({
			id: 'cam', name: 'CAM', storageKey: 'media/cam.mp4', mimeType: 'video/mp4',
			sampleFrameCount: SAMPLE_RATE * 60, sampleRate: SAMPLE_RATE, channelCount: 2,
			frameRate: PAL, sourceFrameCount: 1_500, width: 1_920, height: 1_080,
			...sourceOverrides,
		})],
		clips: [{
			kind: 'video', id: 'v-clip', sourceId: 'cam', title: 'Wide', sequenceId: 'seq',
			sequenceStartFrame: 0, sequenceFrameCount: 250,
			sourceInFrame: 250, sourceFrameCount: 250,
			...clipOverrides,
		}],
		tracks: [createVideoTrack({ id: 'v1', name: 'V1', clipIds: ['v-clip'] })],
		sequences: [{
			id: 'seq', name: 'Sequence', rate: PAL,
			trackNodes: [{ kind: 'track', id: 'v1', parentFolderId: null }],
		}],
		primarySequenceId: 'seq',
	});
	return projectForRuntimeConsumers(project as never) as unknown as Readonly<Record<string, unknown>>;
}

function exportedVideoClip(
	clipOverrides: Record<string, unknown> = {},
	sourceOverrides: Record<string, unknown> = {},
): ExportedClip {
	const { document } = createOtioExport({
		project: deliveredProject(clipOverrides, sourceOverrides),
		sequenceId: 'seq',
		sequenceRate: PAL,
	});
	const stack = document.tracks as { children: readonly { name: string; children: unknown[] }[] };
	const track = stack.children.find((child) => child.name === 'V1');
	assert.ok(track, 'expected the video track in the exported stack');
	const clip = track.children[0] as ExportedClip;
	assert.ok(clip, 'expected the trimmed clip in the video track');
	return clip;
}

test('a trimmed video clip exports the source in-point it was trimmed to', () => {
	const clip = exportedVideoClip();
	assert.equal(
		clip.source_range.start_time.value,
		250,
		'the in-point counts source frames, not project samples',
	);
	assert.equal(clip.source_range.duration.value, 250, 'ten seconds at 25/1 is 250 whole frames');
});

test('a source shot at another rate is rebased onto the sequence grid', () => {
	const clip = exportedVideoClip(
		{ sourceInFrame: 500, sourceFrameCount: 500 },
		{ frameRate: { num: 50, den: 1 }, sourceFrameCount: 3_000 },
	);
	assert.equal(
		clip.source_range.start_time.value,
		250,
		'frame 500 at 50/1 is frame 250 on a 25/1 sequence grid',
	);
});

test('a source whose frame rate cannot be read is reported, never silently retimed', () => {
	const delivered = deliveredProject({});
	const sources = (delivered.sources as readonly Record<string, unknown>[]).map((source) => {
		const { frameRate: _unreadable, ...rest } = source;
		return rest;
	});
	const { document, report } = createOtioExport({
		project: { ...delivered, sources },
		sequenceId: 'seq',
		sequenceRate: PAL,
	});
	const stack = document.tracks as { children: readonly { name: string; children: unknown[] }[] };
	const track = stack.children.find((child) => child.name === 'V1');
	assert.ok(track, 'expected the video track in the exported stack');
	const clip = track.children[0] as ExportedClip;
	assert.equal(clip.source_range.start_time.value, 250, 'the stated source frame survives unconverted');
	assert.ok(
		report.items.some((item) => item.code === 'otio.source-rate-unresolved'),
		'the export names the rate it could not resolve',
	);
});
