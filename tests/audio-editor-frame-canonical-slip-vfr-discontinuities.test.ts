/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { VideoSourceTimingView } from '../src/common/editor/frame-canonical-slip-slide-domain.ts';
import { planFrameCanonicalSlipSlide } from '../src/common/editor/frame-canonical-slip-slide-planner.ts';
import {
	sourceTimeToVideoBoundary,
} from '../src/common/editor/frame-canonical-slip-slide-timing.ts';
import { projectV10ForCommand } from '../src/common/editor/project-v10-command-projection.ts';
import {
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV15 } from '../src/common/editor/project-v15.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';

const SAMPLE_RATE = 48_000;
const SEQUENCE_RATE = Object.freeze({ num: 24, den: 1 });
const AUTHORITY_RATE = Object.freeze({ num: 1, den: 1 });
const NOW = '2026-08-11T18:40:00.000Z';

interface BlockerSpec {
	readonly id: string;
	readonly ticks: readonly bigint[];
	readonly finalDuration: bigint;
}

test('negative VFR search jumps across a collapsed target to the nearest reappearing range', () => {
	const fixture = singleVfrFixture({
		ticks: [0n, 100n, 1_000n, 1_015n, 2_000n, 2_010n],
		finalDuration: 1_000n,
		sourceInFrame: 4,
		sourceFrameCount: 1,
	});
	const plan = planFrameCanonicalSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slip', activeClipId: 'active-video', requestedSourceInFrame: 1,
	});

	assert.equal(plan.kind, 'transform');
	assert.equal(plan.requestedSourceInFrame, 1);
	assert.equal(plan.appliedSourceInFrame, 2);
	assert.equal(plan.sourceFrameDelta, -2);
	assert.equal(plan.clamped, true);
	assert.deepEqual(plan.sourceRanges, [
		{ clipId: 'active-video', sourceStartFrame: 2, sourceEndFrame: 3 },
	]);
});

test('point mapping includes a lower midpoint in the upper cell and excludes its upper midpoint', () => {
	const timing = verifiedVfr('midpoint', [0n, 10n, 20n, 40n], 10n, 900);
	assert.equal(sourceTimeToVideoBoundary(timing.view, {
		numerator: 15n, denominator: 1n,
	}), 2, 'the lower midpoint of cell 2 is inclusive');
	assert.equal(sourceTimeToVideoBoundary(timing.view, {
		numerator: 30n, denominator: 1n,
	}), 3, 'the upper midpoint of cell 2 belongs to cell 3');
});

test('overlapping blockers at the requested target jump below their earliest lower edge', () => {
	const fixture = groupedVfrFixture([
		{ id: 'blocker-a', ticks: [0n, 5n, 9n, 29n], finalDuration: 1_000n },
		{ id: 'blocker-b', ticks: [0n, 12n, 32n, 33n], finalDuration: 1_000n },
	]);
	const plan = planFrameCanonicalSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slip', activeClipId: 'authority-video', requestedSourceInFrame: 9,
	});

	assert.equal(plan.kind, 'transform');
	assert.equal(plan.appliedSourceInFrame, 6);
	assert.equal(plan.sourceFrameDelta, 5);
	assert.equal(plan.clamped, true);
	assert.deepEqual(plan.sourceRanges, [
		{ clipId: 'authority-video', sourceStartFrame: 6, sourceEndFrame: 7 },
		{ clipId: 'blocker-a-video', sourceStartFrame: 1, sourceEndFrame: 2 },
		{ clipId: 'blocker-b-video', sourceStartFrame: 0, sourceEndFrame: 1 },
	]);
});

test('a blocker first encountered after one jump triggers a second bounded jump', () => {
	const fixture = groupedVfrFixture([
		{ id: 'first-blocker', ticks: [0n, 5n, 9n, 29n], finalDuration: 1_000n },
		{ id: 'second-blocker', ticks: [0n, 8n, 22n, 23n], finalDuration: 1_000n },
	]);
	const plan = planFrameCanonicalSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slip', activeClipId: 'authority-video', requestedSourceInFrame: 9,
	});

	assert.equal(plan.kind, 'transform');
	assert.equal(plan.appliedSourceInFrame, 4);
	assert.equal(plan.sourceFrameDelta, 3);
	assert.equal(plan.clamped, true);
	assert.deepEqual(plan.sourceRanges, [
		{ clipId: 'authority-video', sourceStartFrame: 4, sourceEndFrame: 5 },
		{ clipId: 'first-blocker-video', sourceStartFrame: 1, sourceEndFrame: 2 },
		{ clipId: 'second-blocker-video', sourceStartFrame: 0, sourceEndFrame: 1 },
	]);
});

test('more than 64 successive discontinuity jumps refuse deterministically', () => {
	const blockers = Array.from({ length: 65 }, (_, index): BlockerSpec => {
		const target = 300 - index * 2;
		return {
			id: `blocker-${String(index)}`,
			ticks: [0n, BigInt(2 * target - 2), BigInt(4 * target), BigInt(4 * target + 1)],
			finalDuration: 1_000n,
		};
	});
	const fixture = groupedVfrFixture(blockers);

	assert.throws(() => planFrameCanonicalSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slip', activeClipId: 'authority-video', requestedSourceInFrame: 301,
	}), /VFR slip legality exceeds bounded planning complexity/u);
});

function singleVfrFixture(input: Readonly<{
	ticks: readonly bigint[];
	finalDuration: bigint;
	sourceInFrame: number;
	sourceFrameCount: number;
}>) {
	const timing = verifiedVfr('single', input.ticks, input.finalDuration, 1);
	const source = exactVideoSource('video-source', timing, input.ticks.length);
	const clip = videoClip({
		id: 'active-video', sourceId: 'video-source', source,
		sourceInFrame: input.sourceInFrame, sourceFrameCount: input.sourceFrameCount,
		groupId: null,
	});
	const track = createVideoTrackV10({
		id: 'video-track', clipIds: ['active-video'], locked: false,
	});
	return {
		project: commandProject([source], [clip], [track]),
		timingViews: Object.freeze(new Map([['video-source', timing.view]])),
	};
}

function groupedVfrFixture(specifications: readonly BlockerSpec[]) {
	const authoritySource = createVideoSourceV10({
		id: 'authority-source', sampleFrameCount: 500_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: AUTHORITY_RATE, sourceFrameCount: 500,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: AUTHORITY_RATE },
	}, SAMPLE_RATE);
	const sources: Record<string, unknown>[] = [authoritySource];
	const clips: Record<string, unknown>[] = [videoClip({
		id: 'authority-video', sourceId: 'authority-source', source: authoritySource,
		sourceInFrame: 1, sourceFrameCount: 1, groupId: 'slip-block',
	})];
	const tracks: Record<string, unknown>[] = [createVideoTrackV10({
		id: 'authority-track', clipIds: ['authority-video'], locked: false,
	})];
	const views = new Map<string, VideoSourceTimingView>([[
		'authority-source',
		Object.freeze({ kind: 'cfr', rate: AUTHORITY_RATE, frameCount: 500 }),
	]]);
	for (const [index, specification] of specifications.entries()) {
		const sourceId = `${specification.id}-source`;
		const clipId = `${specification.id}-video`;
		const timing = verifiedVfr(
			specification.id,
			specification.ticks,
			specification.finalDuration,
			index + 10,
		);
		const source = exactVideoSource(sourceId, timing, specification.ticks.length);
		sources.push(source);
		clips.push(videoClip({
			id: clipId, sourceId, source, sourceInFrame: 0, sourceFrameCount: 1,
			groupId: 'slip-block',
		}));
		tracks.push(createVideoTrackV10({
			id: `${specification.id}-track`, clipIds: [clipId], locked: false,
		}));
		views.set(sourceId, timing.view);
	}
	return {
		project: commandProject(sources, clips, tracks),
		timingViews: Object.freeze(views),
	};
}

function verifiedVfr(
	label: string,
	ticks: readonly bigint[],
	finalDuration: bigint,
	digestSeed: number,
) {
	const sourceSha256 = digestSeed.toString(16).padStart(64, '0');
	const publication = createVideoTimingAssetPublication(sourceSha256, {
		timescale: 1,
		presentationTicks: ticks,
		finalFrameDurationTicks: finalDuration,
	});
	const index = validateVideoTimingAssetBytes(publication.reference, publication.bytes);
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'vfr', reference: publication.reference, index,
	});
	return { label, sourceSha256, publication, view };
}

function exactVideoSource(
	id: string,
	timing: ReturnType<typeof verifiedVfr>,
	frameCount: number,
) {
	return createVideoSourceV10({
		id, sampleFrameCount: 500_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: SEQUENCE_RATE, sourceFrameCount: frameCount,
		contentSha256: timing.sourceSha256, timingAsset: timing.publication.reference,
		timingDecision: { mode: 'exact', rate: SEQUENCE_RATE, backend: timing.label },
	}, SAMPLE_RATE);
}

function videoClip(input: Readonly<{
	id: string;
	sourceId: string;
	source: Record<string, unknown>;
	sourceInFrame: number;
	sourceFrameCount: number;
	groupId: string | null;
}>) {
	return createVideoClipV10({
		id: input.id, sourceId: input.sourceId, sequenceId: 'main',
		sequenceStartFrame: 0, sequenceFrameCount: 2,
		sourceInFrame: input.sourceInFrame, sourceFrameCount: input.sourceFrameCount,
		groupId: input.groupId,
	}, {
		projectSampleRate: SAMPLE_RATE,
		sequence: { id: 'main', rate: SEQUENCE_RATE },
		source: input.source,
	});
}

function commandProject(
	sources: readonly Record<string, unknown>[],
	clips: readonly Record<string, unknown>[],
	tracks: readonly Record<string, unknown>[],
) {
	const persisted = createAudioEditorProjectV15({
		id: 'vfr-discontinuities', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [{
			id: 'main', rate: SEQUENCE_RATE,
			trackIds: tracks.map(({ id }) => String(id)),
		}],
		primarySequenceId: 'main', sources, clips, tracks,
	});
	return projectV10ForCommand(persisted as unknown as Record<string, unknown>);
}
