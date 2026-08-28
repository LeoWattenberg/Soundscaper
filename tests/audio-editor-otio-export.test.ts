/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { OTIO_METADATA_NAMESPACE, createOtioExport } from '../src/common/editor/otio-export.ts';

const SAMPLE_RATE = 48_000;
const NTSC = { num: 30_000, den: 1_001 };

function project(overrides: Record<string, unknown> = {}) {
	return {
		id: 'p', title: 'Timeline one', sampleRate: SAMPLE_RATE,
		sources: [
			{ kind: 'video', id: 'src-v', name: 'CAM A', storageKey: 'media/cam-a.mp4' },
			{ kind: 'audio', id: 'src-a', name: 'MIX', storageKey: 'media/mix.wav' },
		],
		clips: [
			{
				kind: 'video', id: 'v-clip', sourceId: 'src-v', title: 'Wide',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
			{
				kind: 'audio', id: 'a-clip', sourceId: 'src-a', title: 'Bed',
				timelineStartFrame: SAMPLE_RATE, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
		],
		tracks: [
			{ type: 'video', id: 'v1', name: 'V1', clipIds: ['v-clip'], hidden: false },
			{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['a-clip'], mute: false },
		],
		...overrides,
	};
}

function exported(overrides: Record<string, unknown> = {}) {
	return createOtioExport({ project: project(overrides), sequenceRate: NTSC });
}

function trackNamed(document: Record<string, unknown>, name: string) {
	const stack = document.tracks as { children: Record<string, unknown>[] };
	const track = stack.children.find((child) => child.name === name);
	assert.ok(track, `expected a track named ${name}`);
	return track as { kind: string; children: Record<string, unknown>[] };
}

test('the document is a Timeline stack of typed tracks', () => {
	const { document } = exported();
	assert.equal(document.OTIO_SCHEMA, 'Timeline.1');
	assert.equal((document.tracks as { OTIO_SCHEMA: string }).OTIO_SCHEMA, 'Stack.1');
	assert.equal(trackNamed(document, 'V1').kind, 'Video');
	assert.equal(trackNamed(document, 'A1').kind, 'Audio');
});

test('the rate is a computed quotient, never a rounded literal', () => {
	const { document, text } = exported();
	const clip = trackNamed(document, 'V1').children[0] as {
		source_range: { start_time: { rate: number } };
	};
	assert.equal(
		clip.source_range.start_time.rate,
		30_000 / 1_001,
		'the double must be the closest representable value to the exact rate',
	);
	assert.doesNotMatch(text, /29\.97[^0-9]/u, 'a 29.97 literal is a rate that has already lost its exactness');
});

test('the exact rational survives in metadata, since OTIO has no slot for it', () => {
	const { document } = exported();
	const metadata = (document.metadata as Record<string, Record<string, unknown>>)[OTIO_METADATA_NAMESPACE];
	assert.deepEqual(metadata.sequenceRate, { num: 30_000, den: 1_001 });
	assert.equal(metadata.sampleRate, SAMPLE_RATE);
});

test('every emitted value is a whole number in its own timebase', () => {
	// rescaled_to() preserves fractional doubles and consumers truncate toward
	// zero, so a fractional value here is a frame that vanishes downstream.
	const { text } = exported();
	for (const match of text.matchAll(/"value": ([^,\n]+)/gu)) {
		const value = Number(match[1]);
		assert.ok(Number.isInteger(value), `value ${match[1]} must be pre-rounded here, not downstream`);
	}
});

test('video counts sequence frames and audio counts samples', () => {
	const { document } = exported();
	const video = trackNamed(document, 'V1').children[0] as {
		source_range: { duration: { value: number; rate: number } };
	};
	const audioTrack = trackNamed(document, 'A1');
	const audio = audioTrack.children.at(-1) as {
		source_range: { duration: { value: number; rate: number } };
	};
	assert.equal(video.source_range.duration.value, 29, 'one second at 30000/1001 is 29 whole frames');
	assert.equal(video.source_range.duration.rate, 30_000 / 1_001);
	assert.equal(audio.source_range.duration.value, SAMPLE_RATE, 'audio is counted in samples');
	assert.equal(audio.source_range.duration.rate, SAMPLE_RATE);
});

test('a later clip is preceded by a gap rather than silently moved', () => {
	const { document } = exported();
	const audio = trackNamed(document, 'A1');
	assert.equal((audio.children[0] as { OTIO_SCHEMA: string }).OTIO_SCHEMA, 'Gap.1');
	assert.equal(
		(audio.children[0] as { source_range: { duration: { value: number } } }).source_range.duration.value,
		SAMPLE_RATE,
		'the gap is exactly the silence before the clip',
	);
});

test('simultaneous clips are emitted in code-unit ID order', () => {
	const clips = [
		{
			kind: 'video', id: 'alpha-clip', sourceId: 'src-v', title: 'alpha',
			timelineStartFrame: 0, durationFrames: SAMPLE_RATE,
			sourceStartFrame: 0, speedRatio: 1,
		},
		{
			kind: 'video', id: 'Z-clip', sourceId: 'src-v', title: 'Z',
			timelineStartFrame: 0, durationFrames: SAMPLE_RATE,
			sourceStartFrame: 0, speedRatio: 1,
		},
	];
	const { document } = exported({
		clips,
		tracks: [{
			type: 'video', id: 'v1', name: 'V1',
			clipIds: clips.map(({ id }) => id), hidden: false,
		}],
	});
	const children = trackNamed(document, 'V1').children as Array<{
		metadata: Record<string, { clipId: string }>;
	}>;
	assert.deepEqual(
		children.map(({ metadata }) => metadata[OTIO_METADATA_NAMESPACE]?.clipId),
		['Z-clip', 'alpha-clip'],
	);
});

test('media is addressed by storage key and the conversion is reported', () => {
	const { document, report } = exported();
	const clip = trackNamed(document, 'V1').children[0] as {
		media_reference: { OTIO_SCHEMA: string; target_url: string };
	};
	assert.equal(clip.media_reference.OTIO_SCHEMA, 'ExternalReference.1');
	assert.equal(clip.media_reference.target_url, 'media/cam-a.mp4');
	assert.ok(
		report.items.some((item) => item.code === 'otio.media-reference-converted'),
		'a target URL that is not a filesystem path must say so',
	);
});

test('a clip whose source is gone becomes a MissingReference and an error item', () => {
	const result = createOtioExport({
		project: project({ sources: [] }),
		sequenceRate: NTSC,
	});
	const clip = trackNamed(result.document, 'V1').children[0] as {
		media_reference: { OTIO_SCHEMA: string };
	};
	assert.equal(clip.media_reference.OTIO_SCHEMA, 'MissingReference.1');
	const missing = result.report.items.find((item) => item.code === 'otio.media-reference-missing');
	assert.equal(missing?.severity, 'error');
	assert.equal(result.report.counts.missing, 2, 'both clips lost their source');
});

test('a track that does not contribute to the render is not in the timeline', () => {
	const result = createOtioExport({
		project: project({
			tracks: [
				{ type: 'video', id: 'v1', name: 'V1', clipIds: ['v-clip'], hidden: true },
				{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['a-clip'], mute: true },
			],
		}),
		sequenceRate: NTSC,
	});
	assert.equal((result.document.tracks as { children: unknown[] }).children.length, 0);
	assert.equal(
		result.report.items.filter((item) => item.code === 'otio.track-silent-omitted').length,
		2,
		'the omission is reported rather than the tracks vanishing quietly',
	);
});

test('additional sequences are reported rather than flattened into the stack', () => {
	const result = createOtioExport({
		project: project({ sequences: [{ id: 'a' }, { id: 'b' }] }),
		sequenceRate: NTSC,
	});
	assert.ok(result.report.items.some((item) => item.code === 'otio.additional-sequences-omitted'));
});

test('a retimed clip carries its rendered duration and names the omission', () => {
	const result = createOtioExport({
		project: project({
			clips: [{
				kind: 'video', id: 'v-clip', sourceId: 'src-v', title: 'Fast',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 2,
			}],
			tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['v-clip'], hidden: false }],
		}),
		sequenceRate: NTSC,
	});
	assert.ok(result.report.items.some((item) => item.code === 'otio.speed-change-omitted'));
});

test('the global start time carries the sequence start, and the file round-trips as JSON', () => {
	const result = createOtioExport({
		project: project(), sequenceRate: NTSC, startFrameCount: 107_892, title: 'Reel',
	});
	assert.equal(
		(result.document.global_start_time as { value: number }).value,
		107_892,
		'a timeline starting at 01:00:00:00 must say so',
	);
	assert.equal(result.fileName, 'Reel.otio');
	assert.deepEqual(JSON.parse(result.text), JSON.parse(JSON.stringify(result.document)));
});

test('a clip too short to span a frame is reported, not quietly dropped', () => {
	// Silently skipping it leaves the timeline with fewer clips than the project
	// and nothing to point at, which is the failure this milestone targets.
	const result = createOtioExport({
		project: project({
			clips: [{
				kind: 'video', id: 'blink', sourceId: 'src-v', title: 'Blink',
				timelineStartFrame: 0, durationFrames: 7, sourceStartFrame: 0, speedRatio: 1,
			}],
			tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['blink'], hidden: false }],
		}),
		sequenceRate: NTSC,
	});
	assert.equal(trackNamed(result.document, 'V1').children.length, 0);
	const omission = result.report.items.find((item) => item.code === 'otio.sub-frame-clip-omitted');
	assert.equal(omission?.severity, 'warning');
	assert.equal(omission?.scope.id, 'blink', 'the report names the clip that vanished');
});

test('the export refuses rather than guessing a rate or a sample rate', () => {
	assert.throws(() => createOtioExport({ project: project(), sequenceRate: { num: 0, den: 1 } }), /rational/u);
	assert.throws(
		() => createOtioExport({ project: project({ sampleRate: 0 }), sequenceRate: NTSC }),
		/sample rate/u,
	);
});

test('the sequence drop-frame flag reaches the file, since OTIO has no slot for it', () => {
	// Drop frame is a labelling rule, so OTIO's time model carries no trace of
	// it. Omitting it entirely leaves every consumer labelling an NTSC drop-frame
	// timeline as non-drop: correct frames, visibly wrong timecode.
	const drop = createOtioExport({ project: project(), sequenceRate: NTSC, dropFrame: true });
	const metadata = (drop.document.metadata as Record<string, Record<string, unknown>>)[
		OTIO_METADATA_NAMESPACE
	];
	assert.equal(metadata.dropFrame, true);
	const nonDrop = createOtioExport({ project: project(), sequenceRate: NTSC, dropFrame: false });
	assert.equal(
		((nonDrop.document.metadata as Record<string, Record<string, unknown>>)[OTIO_METADATA_NAMESPACE]).dropFrame,
		false,
		'the flag is stated either way rather than being absent when false',
	);
});

test('a transition is reported here exactly as the EDL profile reports it', () => {
	const dissolve = createOtioExport({
		project: project({
			clips: [{
				kind: 'video', id: 'v-clip', sourceId: 'src-v', title: 'Dissolve',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0,
				speedRatio: 1, transition: 'dissolve',
			}],
			tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['v-clip'], hidden: false }],
		}),
		sequenceRate: NTSC,
	});
	assert.ok(
		dissolve.report.items.some((item) => item.code === 'otio.transition-omitted'),
		'a project must not learn about its lost dissolves by watching the result',
	);
});
