/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { VideoSourceTimingView } from '../src/common/editor/frame-canonical-slip-slide-domain.ts';
import {
	buildFrameCanonicalSlipSlidePointerRequest,
	captureFrameCanonicalSlipSlidePointerAuthority,
} from '../src/common/editor/frame-canonical-slip-slide-pointer-request.ts';
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
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';

const SAMPLE_RATE = 48_000;
const RATE = Object.freeze({ num: 24, den: 1 });
const NOW = '2026-08-11T21:00:00.000Z';
const SOURCE_SHA256 = 'c'.repeat(64);
const VFR_PUBLICATION = createVideoTimingAssetPublication(SOURCE_SHA256, {
	timescale: 1_000,
	presentationTicks: [0n, 100n, 400n, 500n, 900n, 1_000n],
	finalFrameDurationTicks: 100n,
});
const VFR_INDEX = validateVideoTimingAssetBytes(
	VFR_PUBLICATION.reference,
	VFR_PUBLICATION.bytes,
);

test('CFR slip pointer requests map absolute P0/P against one immutable source span', () => {
	const fixture = pointerProject();
	const before = JSON.stringify(fixture.project);
	const authority = captureFrameCanonicalSlipSlidePointerAuthority(
		fixture.project,
		fixture.timingViews,
		{ mode: 'slip', activeClipId: 'center-video', pointerDownSample: 30_000 },
	);

	assert.deepEqual(authority, {
		mode: 'slip',
		activeClipId: 'center-video',
		pointerDownSample: 30_000,
		sourceInFrame: 100,
		sourceOutFrame: 124,
		programDurationSamples: 48_000,
		timingView: fixture.view,
	});
	assert.equal((authority as { readonly timingView: unknown }).timingView, fixture.view);
	assert.ok(Object.isFrozen(authority));
	const authorityBefore = JSON.stringify(authority);

	assert.deepEqual(buildFrameCanonicalSlipSlidePointerRequest(authority, 54_000), {
		mode: 'slip', activeClipId: 'center-video', requestedSourceInFrame: 112,
	});
	assert.deepEqual(buildFrameCanonicalSlipSlidePointerRequest(authority, 42_000), {
		mode: 'slip', activeClipId: 'center-video', requestedSourceInFrame: 106,
	});
	assert.deepEqual(buildFrameCanonicalSlipSlidePointerRequest(authority, 6_000), {
		mode: 'slip', activeClipId: 'center-video', requestedSourceInFrame: 88,
	});
	assert.equal(JSON.stringify(authority), authorityBefore);
	assert.equal((authority as { readonly timingView: unknown }).timingView, fixture.view);
	assert.equal(JSON.stringify(fixture.project), before);
});

test('VFR slip pointer mapping uses the exact verified timing identity and point policy', () => {
	const fixture = pointerProject({ vfr: true });
	const authority = captureFrameCanonicalSlipSlidePointerAuthority(
		fixture.project,
		fixture.timingViews,
		{ mode: 'slip', activeClipId: 'center-video', pointerDownSample: 7_000 },
	);

	assert.equal(authority.mode, 'slip');
	assert.equal(authority.timingView, fixture.view);
	assert.equal(authority.timingView.kind, 'vfr');
	assert.equal(authority.timingView.index, VFR_INDEX);
	assert.equal(authority.timingView.reference, VFR_PUBLICATION.reference);
	assert.deepEqual(buildFrameCanonicalSlipSlidePointerRequest(authority, 31_000), {
		mode: 'slip', activeClipId: 'center-video', requestedSourceInFrame: 3,
	});
	// This quarter-width pointer move reaches 0.3s. The point cell maps it to
	// frame 2 at 0.4s, proving the request is not a CFR frame-delta shortcut.
	assert.deepEqual(buildFrameCanonicalSlipSlidePointerRequest(authority, 19_000), {
		mode: 'slip', activeClipId: 'center-video', requestedSourceInFrame: 2,
	});
});

test('slide requests always add the current absolute pointer displacement to the captured start', () => {
	const fixture = pointerProject();
	const authority = captureFrameCanonicalSlipSlidePointerAuthority(
		fixture.project,
		fixture.timingViews,
		{ mode: 'slide', activeClipId: 'center-video', pointerDownSample: 23_000 },
	);

	assert.deepEqual(authority, {
		mode: 'slide', activeClipId: 'center-video', pointerDownSample: 23_000,
		programStartSample: boundary(10),
	});
	assert.deepEqual(buildFrameCanonicalSlipSlidePointerRequest(authority, 27_000), {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample: 24_000,
	});
	assert.deepEqual(buildFrameCanonicalSlipSlidePointerRequest(authority, 25_000), {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample: 22_000,
	});
	assert.deepEqual(buildFrameCanonicalSlipSlidePointerRequest(authority, 21_000), {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample: 18_000,
	});
});

test('pointer authority and request construction fail closed on forged or unsafe inputs', () => {
	const fixture = pointerProject();
	assert.throws(() => captureFrameCanonicalSlipSlidePointerAuthority(
		{ ...(fixture.project as Readonly<Record<string, unknown>>) },
		fixture.timingViews,
		{ mode: 'slip', activeClipId: 'center-video', pointerDownSample: 0 },
	), /branded command projection/iu);
	assert.throws(() => captureFrameCanonicalSlipSlidePointerAuthority(
		fixture.project,
		fixture.timingViews,
		{ mode: 'slip', activeClipId: 'center-video', pointerDownSample: 0.5 },
	), /pointerDownSample|safe integer/iu);
	const authority = captureFrameCanonicalSlipSlidePointerAuthority(
		fixture.project,
		fixture.timingViews,
		{ mode: 'slide', activeClipId: 'center-video', pointerDownSample: 0 },
	);
	assert.throws(() => buildFrameCanonicalSlipSlidePointerRequest(
		authority,
		Number.MAX_SAFE_INTEGER + 1,
	), /currentPointerSample|safe integer/iu);
});

test('opposite safe-integer pointer extremes never overflow intermediate Number arithmetic', () => {
	const fixture = pointerProject();
	const positiveSlip = captureFrameCanonicalSlipSlidePointerAuthority(
		fixture.project,
		fixture.timingViews,
		{
			mode: 'slip', activeClipId: 'center-video',
			pointerDownSample: -Number.MAX_SAFE_INTEGER,
		},
	);
	const negativeSlip = captureFrameCanonicalSlipSlidePointerAuthority(
		fixture.project,
		fixture.timingViews,
		{
			mode: 'slip', activeClipId: 'center-video',
			pointerDownSample: Number.MAX_SAFE_INTEGER,
		},
	);
	assert.deepEqual(buildFrameCanonicalSlipSlidePointerRequest(
		positiveSlip,
		Number.MAX_SAFE_INTEGER,
	), {
		mode: 'slip', activeClipId: 'center-video', requestedSourceInFrame: 9_007_199_254_841,
	});
	assert.deepEqual(buildFrameCanonicalSlipSlidePointerRequest(
		negativeSlip,
		-Number.MAX_SAFE_INTEGER,
	), {
		mode: 'slip', activeClipId: 'center-video', requestedSourceInFrame: -9_007_199_254_641,
	});

	const slide = captureFrameCanonicalSlipSlidePointerAuthority(
		fixture.project,
		fixture.timingViews,
		{ mode: 'slide', activeClipId: 'center-video', pointerDownSample: Number.MAX_SAFE_INTEGER },
	);
	const positiveSlide: typeof slide = Object.freeze({
		mode: 'slide', activeClipId: 'center-video',
		pointerDownSample: -Number.MAX_SAFE_INTEGER,
		programStartSample: 20_000,
	});
	const slideBefore = JSON.stringify(slide);
	assert.deepEqual(buildFrameCanonicalSlipSlidePointerRequest(
		positiveSlide,
		Number.MAX_SAFE_INTEGER,
	), {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample: Number.MAX_SAFE_INTEGER,
	});
	assert.deepEqual(buildFrameCanonicalSlipSlidePointerRequest(
		slide,
		-Number.MAX_SAFE_INTEGER,
	), {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample: Number.MIN_SAFE_INTEGER,
	});
	assert.equal(JSON.stringify(slide), slideBefore);
});

function pointerProject(options: Readonly<{ vfr?: boolean }> = {}) {
	const vfr = options.vfr === true;
	const sourceFrameCount = vfr ? VFR_INDEX.frameCount : 1_000;
	const source = createVideoSourceV10({
		id: 'video-source', sampleFrameCount: 2_000_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: RATE, sourceFrameCount,
		...(vfr ? {
			contentSha256: SOURCE_SHA256,
			timingAsset: VFR_PUBLICATION.reference,
		} : {}),
		timingDecision: vfr
			? { mode: 'exact', rate: RATE, backend: 'fixture' }
			: { mode: 'conform-cfr-at-ingest', rate: RATE },
	}, SAMPLE_RATE);
	const specifications = vfr ? [
		{ id: 'left-video', sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 1 },
		{ id: 'center-video', sequenceStartFrame: 10, sequenceFrameCount: 24, sourceInFrame: 1, sourceFrameCount: 3 },
		{ id: 'right-video', sequenceStartFrame: 34, sequenceFrameCount: 10, sourceInFrame: 4, sourceFrameCount: 2 },
	] : [
		{ id: 'left-video', sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 20, sourceFrameCount: 10 },
		{ id: 'center-video', sequenceStartFrame: 10, sequenceFrameCount: 24, sourceInFrame: 100, sourceFrameCount: 24 },
		{ id: 'right-video', sequenceStartFrame: 34, sequenceFrameCount: 10, sourceInFrame: 200, sourceFrameCount: 10 },
	];
	const clips = specifications.map((specification) => createVideoClipV10({
		...specification, sourceId: 'video-source', sequenceId: 'main',
	}, {
		projectSampleRate: SAMPLE_RATE,
		sequence: { id: 'main', rate: RATE },
		source,
	}));
	const track = createVideoTrackV10({
		id: 'video-track', clipIds: specifications.map(({ id }) => id), locked: false,
	});
	const persisted = createAudioEditorProjectV15({
		id: `pointer-${vfr ? 'vfr' : 'cfr'}`, now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: RATE, trackIds: ['video-track'] }],
		primarySequenceId: 'main', sources: [source], clips, tracks: [track],
	});
	const project = projectV10ForCommand(persisted as unknown as Record<string, unknown>);
	const view: VideoSourceTimingView = vfr ? Object.freeze({
		kind: 'vfr', reference: VFR_PUBLICATION.reference, index: VFR_INDEX,
	}) : Object.freeze({ kind: 'cfr', rate: RATE, frameCount: sourceFrameCount });
	return Object.freeze({
		project,
		view,
		timingViews: Object.freeze(new Map([['video-source', view]])),
	});
}

function boundary(frame: number): number {
	return videoFrameToSampleFrame(frame, RATE, SAMPLE_RATE, 'point');
}
