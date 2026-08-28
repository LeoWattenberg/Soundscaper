/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createDefaultVideoKeyframeCurves } from '../src/common/editor/video-keyframe-curves.ts';
import { createVideoRetimeExportIntentV6 } from '../src/common/editor/video-retime-export-plan.ts';
import {
	assertUnifiedExactRenderPlan,
	assertUnifiedExactRenderPlanWithTimingSidecars,
	canonicalizeUnifiedExactRenderPlanWithTimingSidecars,
	createUnifiedExactRenderPlan,
	createUnifiedExactRenderPlanWithTimingSidecars,
	fingerprintUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderPlanVersion,
} from '../src/common/editor/unified-exact-render-plan.ts';
import {
	boundVideoSourceTimingAuthority,
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../src/common/editor/video-source-timing-view.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';
import {
	createFramescaperUnifiedRenderFoundation,
	finalizeFramescaperUnifiedRenderPlan,
} from '../src/framescaper/editor-project-unified-render-core.ts';
import { FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectTransitions } from '../src/framescaper/editor-project-transitions.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { renderAuthority } from './helpers/framescaper-unified-render-project-fixture.ts';
import {
	NTSC,
	SOURCE_SHA256,
	bindVfrTiming,
	linearCurve,
	videoClip,
} from './helpers/video-retime-export-fixtures.ts';

const RATE_1 = Object.freeze({ num: 1, den: 1 });

test('V9 through V12 admit digest-bound VFR sidecars without serializing timing bytes', () => {
	for (const version of [9, 10, 11, 12] as const) {
		const timing = bindVfrTiming('vfr-source', [0n, 10n, 30n, 60n], 40n, 100);
		const sidecars = new Map([['vfr-source', timing]]);
		const plan = createUnifiedExactRenderPlanWithTimingSidecars(
			vfrPlan(version, timing, null), sidecars,
		);
		assert.equal(plan.version, version);
		assert.doesNotThrow(() => assertUnifiedExactRenderPlanWithTimingSidecars(plan, sidecars));
		assert.throws(() => assertUnifiedExactRenderPlan(plan), /VFR|timing.*(?:bytes|sidecar|asset)/iu);
		assert.throws(() => createUnifiedExactRenderPlan(plan), /VFR|timing.*(?:bytes|sidecar|asset)/iu);
		const canonical = canonicalizeUnifiedExactRenderPlanWithTimingSidecars(plan, sidecars);
		assert.equal(canonical, JSON.stringify(plan));
		assert.equal(canonical.includes('presentationTicks'), false);
		assert.equal(canonical.includes('finalFrameDurationTicks'), true);
		assert.deepEqual(
			fingerprintUnifiedExactRenderPlanWithTimingSidecars(plan, sidecars),
			fingerprintUnifiedExactRenderPlanWithTimingSidecars(
				createUnifiedExactRenderPlanWithTimingSidecars(plan, sidecars), sidecars,
			),
		);
		const clip = plan.nodes.find((node) => node.kind === 'clip');
		const row = clip?.sourceTimeMapping.intent.intersections[0];
		if (row?.mapping !== 'uniform-wall-clock') throw new RangeError('Missing VFR wall-clock row.');
		assert.deepEqual(row.sourceStartTime, { numerator: '0', denominator: '1' });
		assert.deepEqual(row.sourceEndTime, { numerator: '1', denominator: '1' });
	}
});

test('VFR curve drawable authority uses unequal PTS cells and the explicit final duration', () => {
	const timing = bindVfrTiming('vfr-source', [0n, 10n, 30n, 60n], 40n, 100);
	const sidecars = new Map([['vfr-source', timing]]);
	const plan = createUnifiedExactRenderPlanWithTimingSidecars(
		vfrPlan(9, timing, linearCurve(4)), sidecars,
	);
	const clip = plan.nodes.find((node) => node.kind === 'clip');
	const rows = clip?.sourceTimeMapping.intent.intersections ?? [];
	assert.deepEqual(rows.map((row) => row.mapping === 'curve' ? row.drawableEndTime : null), [
		{ numerator: '1', denominator: '10' },
		{ numerator: '3', denominator: '10' },
		{ numerator: '3', denominator: '5' },
		{ numerator: '1', denominator: '1' },
	]);

	const hostile = structuredClone(plan);
	const hostileClip = hostile.nodes.find((node) => node.kind === 'clip');
	const hostileRow = hostileClip?.sourceTimeMapping.intent.intersections[3];
	if (hostileRow?.mapping !== 'curve') throw new RangeError('Missing hostile VFR curve row.');
	(hostileRow.drawableEndTime as { numerator: string }).numerator = '3';
	assert.throws(
		() => createUnifiedExactRenderPlanWithTimingSidecars(hostile, sidecars),
		/retime|intersection|ordinal authority/iu,
	);
});

test('VFR sidecar admission rejects missing, unused, mismatched, and lookalike timing tokens', () => {
	const timing = bindVfrTiming('vfr-source', [0n, 10n, 30n, 60n], 40n, 100);
	const raw = vfrPlan(9, timing, null);
	assert.throws(
		() => createUnifiedExactRenderPlanWithTimingSidecars(raw, new Map()),
		/VFR|missing|sidecar/iu,
	);
	assert.throws(
		() => createUnifiedExactRenderPlanWithTimingSidecars(raw, new Map([
			['vfr-source', timing],
			['unused-source', timing],
		])),
		/unused|unknown|source identity/iu,
	);
	const wrongSource = bindVfrTiming('other-source', [0n, 10n, 30n, 60n], 40n, 100);
	assert.throws(
		() => createUnifiedExactRenderPlanWithTimingSidecars(raw, new Map([['vfr-source', wrongSource]])),
		/source identity|sourceId|disagrees/iu,
	);
	const lookalike = { ...timing } as BoundVideoSourceTimingView;
	assert.throws(
		() => createUnifiedExactRenderPlanWithTimingSidecars(raw, new Map([['vfr-source', lookalike]])),
		/authenticated|timing token|bound timing/iu,
	);
	const differentReference = bindVfrTiming('vfr-source', [0n, 20n, 40n, 70n], 50n, 100);
	assert.throws(
		() => createUnifiedExactRenderPlanWithTimingSidecars(
			raw, new Map([['vfr-source', differentReference]]),
		),
		/reference|plan source identity|disagrees/iu,
	);
	const digestMismatch = structuredClone(raw);
	digestMismatch.sources[0]!.contentSha256 = 'b2'.repeat(32);
	assert.throws(
		() => createUnifiedExactRenderPlanWithTimingSidecars(
			digestMismatch, new Map([['vfr-source', timing]]),
		),
		/source digest|source identity|bind/iu,
	);
	assert.throws(
		() => createUnifiedExactRenderPlanWithTimingSidecars(
			raw, {} as ReadonlyMap<string, BoundVideoSourceTimingView>,
		),
		/actual|authenticated Map|timing sidecars/iu,
	);
});

test('inactive VFR sources remain mandatory and foundation timing authority cannot be mutated or forged', () => {
	const activeTiming = bindVfrTiming('vfr-source', [0n, 10n, 30n, 60n], 40n, 100);
	const inactiveTiming = bindVfrTiming('inactive-source', [0n, 25n], 75n, 100);
	const raw = vfrPlan(9, activeTiming, null);
	raw.sources.push({
		inputIndex: 1, nodeId: 'inactive-node', sourceId: 'inactive-source',
		storageKey: 'video-original-sha256:inactive', mimeType: 'video/mp4',
		contentSha256: SOURCE_SHA256,
		timing: boundVideoSourceTimingAuthority(inactiveTiming),
	});
	assert.throws(
		() => createUnifiedExactRenderPlanWithTimingSidecars(
			raw, new Map([['vfr-source', activeTiming]]),
		),
		/inactive-source|no verified timing asset sidecar/iu,
	);
	assert.doesNotThrow(() => createUnifiedExactRenderPlanWithTimingSidecars(raw, new Map([
		['vfr-source', activeTiming], ['inactive-source', inactiveTiming],
	])));

	const { project, authority } = candidateVfrFixture();
	const foundation = createFramescaperUnifiedRenderFoundation(project, authority);
	assert.equal(Object.hasOwn(foundation, 'timingBySourceId'), false);
	authority.timingViews.clear();
	assert.equal(finalizeFramescaperUnifiedRenderPlan(foundation, 9, []).version, 9);
	assert.throws(
		() => finalizeFramescaperUnifiedRenderPlan({ ...foundation }, 9, []),
		/authenticated unified render foundation/iu,
	);
});

function vfrPlan(
	version: UnifiedExactRenderPlanVersion,
	timing: BoundVideoSourceTimingView,
	retimeMap: ReturnType<typeof linearCurve> | null,
) {
	const canonicalClip = videoClip('vfr-clip', 'vfr-source', retimeMap, {
		sequenceFrameCount: 4, sourceFrameCount: 4,
	});
	const intent = createVideoRetimeExportIntentV6({
		sampleStart: 0,
		sampleDuration: 4,
		sampleRate: 1,
		sequenceBinding: { id: 'sequence-1', rate: RATE_1 },
		outputRate: RATE_1,
		topology: [{
			startSample: 0, endSample: 4,
			layers: [{ clips: [{ clipId: 'vfr-clip' }] }],
		}],
		canonicalClips: [canonicalClip],
	}, new Map([['vfr-source', timing]]));
	return {
		version,
		strategy: 'framescaper-unified-exact-v1',
		project: { id: 'vfr-project', revision: 1 },
		format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		timebase: {
			sampleStart: 0, sampleDuration: 4, sampleRate: 1,
			sequenceId: 'sequence-1', sequenceRate: RATE_1,
		},
		output: {
			frameRate: RATE_1, frameCount: 4, quality: 'balanced',
			canvas: {
				width: 640, height: 360, fit: 'contain', pixelFormat: 'yuv420p',
				backgroundColor: '#000000',
			},
			includeAudio: false, audioLayout: null,
		},
		tracks: [{ trackId: 'track-1', sequenceOrder: 0, mute: false, solo: false, hidden: false }],
		sources: [{
			inputIndex: 0, nodeId: 'source-node', sourceId: 'vfr-source',
			storageKey: 'video-original-sha256:a7', mimeType: 'video/mp4',
			contentSha256: SOURCE_SHA256,
			timing: boundVideoSourceTimingAuthority(timing),
		}],
		nodes: [{
			kind: 'clip', nodeId: 'clip-node', clipId: 'vfr-clip', trackId: 'track-1',
			sourceNodeId: 'source-node', sequenceStartFrame: 0, sequenceFrameCount: 4,
			sourceInFrame: 0, sourceFrameCount: 4,
			pictureState: {
				composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
				videoEffects: [],
				videoKeyframes: createDefaultVideoKeyframeCurves(4),
			},
			sourceTimeMapping: {
				kind: 'video-retime-export-intent-v6', sourceRate: NTSC, retimeMap, intent,
			},
		}],
	};
}

function candidateVfrFixture() {
	const publication = createVideoTimingAssetPublication('12'.repeat(32), {
		timescale: 1_000,
		presentationTicks: [0n, 10n, 30n, 60n, 100n, 150n, 210n, 280n, 360n, 450n],
		finalFrameDurationTicks: 100n,
	});
	const options = structuredClone(framescaperV20Options());
	const source = (options.sources as Record<string, unknown>[])[0]!;
	source.timingAsset = publication.reference;
	source.timingDecision = { mode: 'exact', rate: { num: 10, den: 1 }, backend: 'demuxer' };
	const project = createFramescaperProjectTransitions(
		FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE,
		{ ...options, videoTransitionsByTrackId: { 'video-track': [] } },
	);
	const index = validateVideoTimingAssetBytes(publication.reference, publication.bytes);
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'vfr', reference: publication.reference, index,
	});
	const baseAuthority = renderAuthority(project, 10);
	const authority = { ...baseAuthority, timingViews: new Map([['video-source', view]]) };
	const timing = bindVideoSourceTimingView(authority.timingViews, project.sources[0]!);
	return { project, authority, timing };
}
