/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { BoundVideoSourceTimingView, VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import {
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
	FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { createFramescaperProjectTransitions } from '../src/framescaper/editor-project-transitions.ts';
import type { FramescaperUnifiedExactRenderAuthority } from '../src/framescaper/editor-project-unified-render-authority.ts';
import {
	createFramescaperUnifiedRenderFoundation,
	finalizeFramescaperUnifiedRenderPlan,
	generatedNodeId,
	snapshotFramescaperUnifiedRenderTimingSidecars,
	type FramescaperUnifiedRenderFoundation,
} from '../src/framescaper/editor-project-unified-render-core.ts';
import { createFramescaperUnifiedOpenFxRenderNodes } from '../src/framescaper/editor-project-unified-render-openfx.ts';
import { createFramescaperUnifiedRenderFinishingNodeNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { createFramescaperUnifiedProfessionalRenderNodes } from '../src/framescaper/editor-project-unified-render-professional.ts';
import { createFramescaperUnifiedVisualRenderNodes } from '../src/framescaper/editor-project-unified-render-visual.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import {
	openFxProject, professionalProject, renderAuthority, transitionProjectOptions, visualProject,
} from './helpers/framescaper-unified-render-project-fixture.ts';

type Data = Record<string, unknown>;
type Authority = FramescaperUnifiedExactRenderAuthority;

const PRORES = 'encode-mov-prores-422-hq';
/** One sequence frame of the fixture: 48 kHz over a 10/1 sequence rate. */
const FRAME = 4_800;

test('a candidate project must be a plain record before any render authority is read', () => {
	for (const candidate of [null, undefined, 'project', 42, [] as unknown]) {
		assert.throws(
			() => createFramescaperUnifiedRenderFoundation(candidate, authorityFor(baseProject())),
			{ name: 'TypeError', message: /Framescaper candidate project must be an object/u },
		);
	}
});

test('audio authority is refused by the dormant generations and admitted only by V14 and V15', () => {
	const project = baseProject();
	const authority = authorityFor(project, { includeAudio: true });
	for (const version of [9, 10, 11, 12, 13] as const) {
		assert.throws(
			() => createFramescaperUnifiedRenderFoundation(project, authority, version),
			{ name: 'RangeError', message: /Audio authority is not represented by unified plans V9-V13/u },
		);
	}
	for (const version of [14, 15] as const) {
		const foundation = createFramescaperUnifiedRenderFoundation(project, authority, version);
		assert.equal((foundation.rawPlanBase.output as Data).includeAudio, true);
	}
});

test('a render sample range that is negative, empty, or unsafe to add is refused', () => {
	const project = baseProject();
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(project, authorityFor(project, { sampleStart: -1 })),
		{ name: 'RangeError', message: /render sampleStart must be a non-negative safe integer/u },
	);
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(project, authorityFor(project, { sampleDuration: 0 })),
		{ name: 'RangeError', message: /render sampleDuration must be a positive safe integer/u },
	);
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(project, authorityFor(project, {
			sampleStart: Number.MAX_SAFE_INTEGER, sampleDuration: FRAME,
		})),
		{ name: 'RangeError', message: /Render sample range overflows/u },
	);
});

test('a render sequence identity must be nonempty text naming a sequence the project holds', () => {
	const project = baseProject();
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(project, authorityFor(project, { sequenceId: '' })),
		{ name: 'TypeError', message: /render sequenceId must be nonempty text/u },
	);
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(project, authorityFor(project, { sequenceId: 'ghost' })),
		{ name: 'ReferenceError', message: /Render sequence ghost does not exist/u },
	);
});

test('project sample rate and sequence rate must be positive reduced rationals', () => {
	const zeroRate = baseProject();
	zeroRate.sampleRate = 0;
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(zeroRate, authorityFor(baseProject())),
		{ name: 'RangeError', message: /project\.sampleRate must be a positive safe integer/u },
	);
	const unreduced = baseProject();
	sequence(unreduced).rate = { num: 20, den: 2 };
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(unreduced, authorityFor(unreduced)),
		{ name: 'RangeError', message: /sequence\.rate must be reduced/u },
	);
	const missingDen = baseProject();
	sequence(missingDen).rate = { num: 10 };
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(missingDen, authorityFor(missingDen)),
		{ name: 'TypeError', message: /sequence\.rate\.den must be an own enumerable data property/u },
	);
});

test('project collections must be arrays of records carrying unique identities', () => {
	const notAnArray = baseProject();
	notAnArray.sources = {};
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(notAnArray, authorityFor(baseProject())),
		{ name: 'TypeError', message: /project\.sources must be an array/u },
	);
	const notRecords = baseProject();
	(notRecords.sequences as Data[]).push(null as unknown as Data);
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(notRecords, authorityFor(baseProject())),
		{ name: 'TypeError', message: /project\.sequences\[1\] must be an object/u },
	);
	const duplicated = baseProject();
	(duplicated.sources as Data[]).push(structuredClone(sources(duplicated)[0]!));
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(duplicated, authorityFor(baseProject())),
		{ name: 'RangeError', message: /project source identity video-source is duplicated/u },
	);
	const badTrackIds = baseProject();
	sequence(badTrackIds).trackIds = ['video-track', 7];
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(badTrackIds, authorityFor(badTrackIds)),
		{ name: 'TypeError', message: /sequence\.trackIds must be a string array/u },
	);
});

test('project state hidden behind an accessor or a non-enumerable slot is refused as inexact', () => {
	const accessor = baseProject();
	Object.defineProperty(accessor, 'sampleRate', {
		get: () => 48_000, enumerable: true, configurable: true,
	});
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(accessor, authorityFor(baseProject())),
		{ name: 'TypeError', message: /project\.sampleRate must be an own enumerable data property/u },
	);
	const hidden = baseProject();
	Object.defineProperty(clips(hidden)[0]!, 'videoEffects', {
		value: [], enumerable: false, configurable: true,
	});
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(hidden, authorityFor(hidden)),
		{ name: 'TypeError', message: /video clip video-clip\.videoEffects must be an own enumerable/u },
	);
});

test('opaque extension state on a source, a track, or a clip is refused as unrepresented', () => {
	const cases: readonly [string, (project: Data) => void, RegExp][] = [
		['source', (project) => { sources(project)[0]!.opaqueExtensions = { legacy: 1 }; },
			/video source video-source\.opaqueExtensions contains render state/u],
		['track', (project) => { tracks(project)[0]!.opaqueExtensions = { legacy: 1 }; },
			/video track video-track\.opaqueExtensions contains render state/u],
		['clip', (project) => { clips(project)[0]!.opaqueExtensions = { legacy: 1 }; },
			/video clip video-clip\.opaqueExtensions contains render state/u],
	];
	for (const [name, mutate, message] of cases) {
		const project = baseProject();
		mutate(project);
		assert.throws(
			() => createFramescaperUnifiedRenderFoundation(project, authorityFor(project)),
			{ name: 'RangeError', message }, name,
		);
	}
});

test('a sequence track must exist and expose exact mute, solo, and hidden state', () => {
	const missing = baseProject();
	sequence(missing).trackIds = ['video-track', 'ghost-track', 'audio-track'];
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(missing, authorityFor(missing)),
		{ name: 'ReferenceError', message: /Sequence track ghost-track is missing/u },
	);
	const inexact = baseProject();
	tracks(inexact)[0]!.solo = 'yes';
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(inexact, authorityFor(inexact)),
		{ name: 'TypeError', message: /video track video-track\.solo must be boolean/u },
	);
});

test('legacy clip speed state and inexact inherited picture state are refused', () => {
	const speed = baseProject();
	clips(speed)[0]!.speedRatio = 2;
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(speed, authorityFor(speed)),
		{ name: 'RangeError', message: /Video clip video-clip has legacy speed state/u },
	);
	const effects = baseProject();
	clips(effects)[0]!.videoEffects = {};
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(effects, authorityFor(effects)),
		{ name: 'TypeError', message: /Video clip video-clip effects must be an exact array/u },
	);
	const keyframes = baseProject();
	clips(keyframes)[0]!.videoKeyframes = null;
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(keyframes, authorityFor(keyframes)),
		{ name: 'TypeError', message: /video clip video-clip\.videoKeyframes must be an object/u },
	);
	const composition = baseProject();
	clips(composition)[0]!.videoComposition = [];
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(composition, authorityFor(composition)),
		{ name: 'TypeError', message: /video clip video-clip\.videoComposition must be an object/u },
	);
});

test('an active clip is refused unless exactly one video track owns it', () => {
	const orphan = baseProject();
	tracks(orphan)[0]!.clipIds = [];
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(orphan, authorityFor(orphan)),
		{ name: 'RangeError', message: /Active clip video-clip requires exactly one video-track owner/u },
	);
	const shared = baseProject();
	addUpperVideoTrack(shared, ['video-clip']);
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(shared, authorityFor(shared)),
		{ name: 'RangeError', message: /Active clip video-clip requires exactly one video-track owner/u },
	);
});

test('a video clip whose source is absent or is not a video source is refused', () => {
	for (const sourceId of ['ghost-source', 'audio-source']) {
		const project = baseProject();
		clips(project)[0]!.sourceId = sourceId;
		assert.throws(
			() => createFramescaperUnifiedRenderFoundation(project, authorityFor(project)),
			{ name: 'ReferenceError', message: new RegExp(`Video source ${sourceId} is missing`, 'u') },
			sourceId,
		);
	}
});

test('generatedNodeId names the family-scoped identity and refuses project collisions', () => {
	assert.equal(generatedNodeId('clip', 'video-clip', new Set(['video-clip'])), 'render:clip:video-clip');
	assert.throws(
		() => generatedNodeId('clip', 'video-clip', new Set(['render:clip:video-clip'])),
		{ name: 'RangeError', message: /render:clip:video-clip collides with project identity/u },
	);
	const project = baseProject();
	(record(project.projectBin).clips as Data[])[0]!.id = 'render:source:video-source';
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(project, authorityFor(project)),
		{ name: 'RangeError', message: /render:source:video-source collides with project identity/u },
	);
});

test('timing views must be an actual Map naming exactly the project video sources', () => {
	const project = baseProject();
	const view = authorityFor(project).timingViews.get('video-source')!;
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(project, authorityFor(project, {
			timingViews: { get: () => view } as unknown as ReadonlyMap<string, VideoSourceTimingView>,
		})),
		{ name: 'TypeError', message: /timingViews must be an actual Map/u },
	);
	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(project, authorityFor(project, {
			timingViews: new Map([['video-source', view], ['spare-source', view]]),
		})),
		{ name: 'RangeError', message: /timingViews must contain exactly every video source/u },
	);
	for (const key of ['spare-source', 7 as unknown as string]) {
		assert.throws(
			() => createFramescaperUnifiedRenderFoundation(project, authorityFor(project, {
				timingViews: new Map([[key, view]]),
			})),
			{ name: 'RangeError', message: /timingViews contain an unused or unknown source identity/u },
			String(key),
		);
	}
});

test('clips that end before the render range are dropped and partial coverage keeps trailing black', () => {
	const project = transitionsProject();
	const foundation = createFramescaperUnifiedRenderFoundation(project, authorityFor(project, {
		sampleStart: 12 * FRAME, sampleDuration: 8 * FRAME,
	}));

	assert.deepEqual(foundation.baseNodes.map((node) => node.clipId), ['incoming-clip']);
	const intent = clipIntent(foundation.baseNodes[0]!);
	assert.equal(intent.outputFrameCount, 8);
	assert.deepEqual(intersections(intent).map((row) => [row.startOutputFrame, row.endOutputFrame]), [[0, 4]]);
});

test('a clip that starts inside the render range keeps leading black before its first frame', () => {
	const project = transitionsProject();
	const foundation = createFramescaperUnifiedRenderFoundation(project, authorityFor(project, {
		sampleDuration: 20 * FRAME,
	}));

	assert.deepEqual(foundation.baseNodes.map((node) => [node.kind, node.clipId]), [
		['clip', 'outgoing-clip'], ['clip', 'incoming-clip'], ['transition', undefined],
	]);
	assert.deepEqual(
		foundation.baseNodes.slice(0, 2).map((node) => intersections(clipIntent(node))
			.map((row) => [row.startOutputFrame, row.endOutputFrame])),
		[[[0, 10]], [[6, 16]]],
	);
	assert.equal((foundation.rawPlanBase.output as Data).frameCount, 20);
});

test('render nodes are ordered by video track order before clip start sample', () => {
	const project = baseProject();
	const upper = { ...structuredClone(clips(project)[0]!), id: 'upper-clip' };
	clips(project).unshift(upper);
	addUpperVideoTrack(project, ['upper-clip']);

	const foundation = createFramescaperUnifiedRenderFoundation(project, authorityFor(project));

	assert.deepEqual(foundation.tracks.map(({ trackId, sequenceOrder }) => [trackId, sequenceOrder]), [
		['video-track', 0], ['upper-track', 1],
	]);
	assert.deepEqual(foundation.baseNodes.map((node) => [node.clipId, node.trackId]), [
		['video-clip', 'video-track'], ['upper-clip', 'upper-track'],
	]);
});

test('a transition is skipped when its track, participants, or overlap fall outside the render', () => {
	const cases: readonly [string, (project: Data) => void][] = [
		['transitions on a non-video track', (project) => {
			tracks(project)[1]!.videoTransitions = tracks(project)[0]!.videoTransitions;
			tracks(project)[0]!.videoTransitions = [];
		}],
		['a video track holding no transition array', (project) => {
			delete tracks(project)[0]!.videoTransitions;
		}],
		['an unknown outgoing participant', (project) => { transition(project).outgoingClipId = 'ghost'; }],
		['an unknown incoming participant', (project) => { transition(project).incomingClipId = 'ghost'; }],
		['an outgoing participant in another sequence', (project) => {
			clips(project)[0]!.sequenceId = 'other-sequence';
		}],
		['an incoming participant in another sequence', (project) => {
			clips(project)[2]!.sequenceId = 'other-sequence';
		}],
	];
	for (const [name, mutate] of cases) {
		const project = transitionsProject();
		mutate(project);
		const foundation = createFramescaperUnifiedRenderFoundation(project, authorityFor(project));
		assert.deepEqual(foundation.baseNodes.filter((node) => node.kind === 'transition'), [], name);
	}
});

test('an active transition whose participant is not a rendered video clip is refused', () => {
	const project = transitionsProject();
	clips(project).push({
		kind: 'still', id: 'still-clip', sourceId: 'still-source', sequenceId: 'main-sequence',
		sequenceStartFrame: 6, sequenceFrameCount: 4,
	});
	(tracks(project)[0]!.clipIds as string[]).push('still-clip');
	transition(project).incomingClipId = 'still-clip';

	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(project, authorityFor(project)),
		{ name: 'RangeError', message: /An active transition is missing an exact participant mapping/u },
	);
});

test('still sources render one frame while an image-sequence pack takes the pack mime type', () => {
	const visual = record(visualProject());
	const foundation = createFramescaperUnifiedRenderFoundation(visual, authorityFor(visual, {
		sampleDuration: 30 * FRAME,
	}));

	assert.deepEqual((foundation.rawPlanBase.sources as Data[]).map((source) => [
		source.inputIndex, source.sourceId, source.mimeType, source.timing,
	]), [
		[0, 'still-source', 'image/png', { kind: 'cfr', frameCount: 1, rate: { num: 10, den: 1 } }],
		[1, 'video-source', 'video/mp4', { kind: 'cfr', frameCount: 10, rate: { num: 10, den: 1 } }],
	]);
	assert.deepEqual(foundation.activeVisualPlacements.map(({ clip, startSample, endSample }) => [
		clip.id, startSample, endSample,
	]), [['still-clip', 10 * FRAME, 20 * FRAME], ['generator-clip', 20 * FRAME, 30 * FRAME]]);
	assert.deepEqual(foundation.baseNodes.map((node) => node.clipId), ['video-clip']);

	const professional = record(professionalProject());
	const packed = createFramescaperUnifiedRenderFoundation(professional, authorityFor(professional));
	assert.deepEqual((packed.rawPlanBase.sources as Data[]).map((source) => source.mimeType), [
		'application/vnd.soundscaper.image-sequence-pack',
	]);
});

test('an output frame count outside the safe exact domain is refused', () => {
	const project = baseProject();
	project.sampleRate = 1;
	project.clips = [];
	sequence(project).rate = { num: 1, den: 1 };

	assert.throws(
		() => createFramescaperUnifiedRenderFoundation(project, authorityFor(project, {
			sampleStart: 0, sampleDuration: Number.MAX_SAFE_INTEGER, outputRate: { num: 1_000, den: 1 },
		})),
		{ name: 'RangeError', message: /output frame count is outside the safe exact domain/u },
	);
});

test('project identities span the bin, transitions, visual models, and OpenFX instances', () => {
	const transitions = transitionsProject();
	const foundation = createFramescaperUnifiedRenderFoundation(transitions, authorityFor(transitions));
	for (const identity of ['framescaper-v20', 'bin-video', 'transition', 'video-track', 'main-sequence']) {
		assert.equal(foundation.projectIdentities.has(identity), true, identity);
	}
	assert.deepEqual([...foundation.representedIdentities], [
		'framescaper-v20', 'video-source', 'render:source:video-source', 'video-track',
		'render:clip:outgoing-clip', 'outgoing-clip', 'render:clip:incoming-clip', 'incoming-clip',
		'render:transition:transition', 'transition',
	]);

	const openFx = record(openFxProject('video-source'));
	const identities = createFramescaperUnifiedRenderFoundation(openFx, authorityFor(openFx))
		.projectIdentities;
	assert.equal(identities.has('ofx-instance'), true);
	const visual = record(visualProject());
	const visualIdentities = createFramescaperUnifiedRenderFoundation(visual, authorityFor(visual))
		.projectIdentities;
	for (const identity of ['adjustment', 'preset', 'mask', 'still-source', 'generator-source']) {
		assert.equal(visualIdentities.has(identity), true, identity);
	}
});

test('a V14 or V15 plan without an exact professional delivery profile is refused', () => {
	const project = baseProject();
	const foundation = createFramescaperUnifiedRenderFoundation(project, authorityFor(project));
	for (const version of [14, 15] as const) {
		assert.throws(
			() => finalizeFramescaperUnifiedRenderPlan(foundation, version, []),
			{
				name: 'TypeError',
				message: new RegExp(`A V${String(version)} render requires one exact professional delivery profile`, 'u'),
			},
			String(version),
		);
	}
	assert.equal(finalizeFramescaperUnifiedRenderPlan(foundation, 9, [], PRORES).version, 9);
});

test('V15 delivery defaults its caption and companion authorities to null when none is supplied', () => {
	const { foundation, nodes } = nativeMediaRender();
	const defaulted = finalizeFramescaperUnifiedRenderPlan(foundation, 15, nodes, PRORES);
	const explicit = finalizeFramescaperUnifiedRenderPlan(foundation, 15, nodes, PRORES, {
		captionDelivery: null, companionAudio: null,
	});

	assert.equal(defaulted.version, 15);
	assert.equal(defaulted.captionDelivery, null);
	assert.equal(defaulted.companionAudio, null);
	assert.deepEqual(explicit, defaulted);
	const v14 = finalizeFramescaperUnifiedRenderPlan(foundation, 14, nodes, PRORES);
	assert.equal(v14.version, 14);
	assert.equal(Object.hasOwn(v14, 'captionDelivery'), false);
	assert.equal(v14.deliveryProfile, PRORES);
});

test('an unauthenticated render foundation can neither be finalized nor snapshotted', () => {
	const project = baseProject();
	const foundation = createFramescaperUnifiedRenderFoundation(project, authorityFor(project));
	const forged = { ...foundation } as FramescaperUnifiedRenderFoundation;

	assert.throws(
		() => finalizeFramescaperUnifiedRenderPlan(forged, 9, []),
		{ name: 'TypeError', message: /An authenticated unified render foundation is required/u },
	);
	assert.throws(
		() => snapshotFramescaperUnifiedRenderTimingSidecars(forged),
		{ name: 'TypeError', message: /An authenticated unified render foundation is required/u },
	);
});

test('the timing sidecar snapshot is a copy that later finalizations do not share', () => {
	const project = baseProject();
	const foundation = createFramescaperUnifiedRenderFoundation(project, authorityFor(project));

	const first = snapshotFramescaperUnifiedRenderTimingSidecars(foundation);
	const second = snapshotFramescaperUnifiedRenderTimingSidecars(foundation);
	assert.notEqual(first, second);
	assert.deepEqual([...first.keys()], ['video-source']);
	assert.deepEqual([...second.keys()], ['video-source']);
	(first as Map<string, BoundVideoSourceTimingView>).clear();
	assert.equal(finalizeFramescaperUnifiedRenderPlan(foundation, 9, []).version, 9);
	assert.deepEqual([...snapshotFramescaperUnifiedRenderTimingSidecars(foundation).keys()], ['video-source']);
});

function baseProject(): Data {
	return structuredClone(createFramescaperProjectTransitions(
		FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE,
		{ ...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] } },
	)) as unknown as Data;
}

function transitionsProject(): Data {
	return structuredClone(createFramescaperProjectTransitions(
		FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE, transitionProjectOptions(),
	)) as unknown as Data;
}

function authorityFor(project: Data, overrides: Partial<Authority> = {}): Authority {
	return { ...renderAuthority(project, 10), ...overrides };
}

function nativeMediaRender() {
	const project = createFramescaperProjectNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, framescaperV20Options(),
	);
	const authority = createFramescaperNativeRenderPlanAuthorityNativeMedia(project);
	const foundation = createFramescaperUnifiedRenderFoundation(project, authority, 14);
	const visual = createFramescaperUnifiedVisualRenderNodes(foundation, authority);
	const professional = createFramescaperUnifiedProfessionalRenderNodes(foundation);
	const openFx = createFramescaperUnifiedOpenFxRenderNodes(foundation, visual.representedIdentities);
	const finishing = createFramescaperUnifiedRenderFinishingNodeNativeMedia(
		project, foundation.projectIdentities, authority.sequenceId,
	);
	return {
		foundation,
		nodes: [...visual.nodes, ...professional, ...openFx, finishing] as
			unknown as readonly Readonly<Record<string, unknown>>[],
	};
}

function addUpperVideoTrack(project: Data, clipIds: readonly string[]): void {
	tracks(project).push({
		...structuredClone(tracks(project)[0]!), id: 'upper-track', name: 'Upper', clipIds: [...clipIds],
	});
	sequence(project).trackIds = ['video-track', 'upper-track', 'audio-track'];
}

function record(value: unknown): Data { return value as Data; }
function clips(project: Data): Data[] { return project.clips as Data[]; }
function sources(project: Data): Data[] { return project.sources as Data[]; }
function tracks(project: Data): Data[] { return project.tracks as Data[]; }
function sequence(project: Data): Data { return (project.sequences as Data[])[0]!; }
function transition(project: Data): Data { return (tracks(project)[0]!.videoTransitions as Data[])[0]!; }
function clipIntent(node: Readonly<Record<string, unknown>>): Data { return record(record(node.sourceTimeMapping).intent); }
function intersections(intent: Data): readonly Data[] { return intent.intersections as readonly Data[]; }
