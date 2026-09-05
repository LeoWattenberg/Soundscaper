/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import {
	prepareFramescaperSelectedVisualAuthoringFinishing as prepare,
	type FramescaperSelectedPreparedVisualAuthoringFinishing,
} from '../src/framescaper/editor-selected-finishing-visual-authoring-commands.ts';
import {
	createFramescaperSelectedVisualAuthoringFenceFinishing as createFence,
} from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';

type Data = Record<string, unknown>;
/** One refusal case: the authored request, the project it reads, and the message it must carry. */
type Refusal = readonly [Data, Data, RegExp];

interface StoreLog { readonly writes: Data[]; readonly deletes: string[] }
interface AuthoringOptions { readonly capture?: unknown; readonly store?: AudioEditorProjectStore }

const VIDEO_SOURCE = createVideoSource({
	id: 'video-source', name: 'Reel', storageKey: 'video-source', mimeType: 'video/mp4',
	contentSha256: 'ab'.repeat(32), sampleFrameCount: 16_000, sourceFrameCount: 10,
	frameRate: { num: 30, den: 1 }, width: 640, height: 360,
}) as unknown as Data;
const GENERATOR_SOURCE: Data = {
	kind: 'generator', id: 'generator-source', name: 'Bars', generator: { kind: 'bars', level: 0.5 },
};
const PNG_BLOB = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

function videoClip(id: string, start: number, count: number, extra: Data = {}): Data {
	return {
		kind: 'video', id, sourceId: 'video-source', sequenceId: 'main-sequence',
		sequenceStartFrame: start, sequenceFrameCount: count,
		sourceInFrame: 0, sourceFrameCount: count, retimeMap: null, ...extra,
	};
}

function project(overrides: Data = {}): Data {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1, id: 'project-1', revision: 3,
		sampleRate: 48_000, selection: { clipIds: ['clip-1'] }, primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', trackIds: ['video-track'], rate: { num: 30, den: 1 } }],
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['clip-1'] }],
		clips: [videoClip('clip-1', 0, 10)], sources: [VIDEO_SOURCE, GENERATOR_SOURCE],
		videoVisualPresets: [], videoFinishingPresets: [], videoFreezeFallbacks: [],
		videoAdjustmentLayers: [], videoVisualPresentations: [], videoMaskMattes: [],
		videoTransitionsByTrackId: {}, trackFolders: [], ...overrides,
	};
}

/** Two abutting ten-frame video clips on one unlocked video track. */
function pairProject(overrides: Data = {}, incoming: Data = {}): Data {
	return project({
		clips: [videoClip('clip-1', 0, 10), videoClip('clip-2', 10, 10, incoming)],
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['clip-1', 'clip-2'] }], ...overrides,
	});
}

/** The same pair after a three-frame dissolve has already been authored. */
function dissolvedPair(): Data {
	return pairProject({
		clips: [videoClip('clip-1', 0, 10), videoClip('clip-2', 7, 10)],
		tracks: [{
			id: 'video-track', type: 'video', clipIds: ['clip-1', 'clip-2'],
			videoTransitions: [{
				id: 'transition-1', outgoingClipId: 'clip-1',
				incomingClipId: 'clip-2', durationFrames: 3,
			}],
		}],
	});
}

/** The pair plus audio peers linked to the incoming clip through one A/V link. */
function linkedPair(videoTrack: Data = {}, audioTrack: Data = {}, peers = 1): Data {
	const ids = peers === 2 ? ['audio-2', 'audio-3'] : ['audio-2'];
	const source = pairProject({
		tracks: [
			{ id: 'video-track', type: 'video', clipIds: ['clip-1', 'clip-2'], ...videoTrack },
			{ id: 'audio-track', type: 'audio', clipIds: ids, ...audioTrack },
		],
	}, { avLinkId: 'link-2' });
	for (const id of ids) {
		(source.clips as Data[]).push({ kind: 'audio', id, avLinkId: 'link-2', timelineStartFrame: 16_000 });
	}
	return source;
}

function generatorProject(overrides: Data = {}): Data {
	return project({
		clips: [{
			kind: 'generator', id: 'clip-1', sourceId: 'generator-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		}], ...overrides,
	});
}

function presentation(id: string, ownerId: string, maskMatteIds: readonly string[]): Data {
	return {
		schemaVersion: 1, id, owner: { kind: 'clip', id: ownerId }, enabled: true, opacity: 1,
		blendMode: 'normal', grade: null, processorStackId: null, maskMatteIds,
	};
}

function maskGraph(id: string, nodeId: string): Data {
	return {
		schemaVersion: 1, id, kind: 'mask', inputs: [], outputNodeId: nodeId,
		nodes: [{
			id: nodeId, kind: 'vector-shape', shape: 'rectangle', x: 0.25, y: 0.25,
			width: 0.5, height: 0.5,
		}],
	};
}

function visualPreset(modelKind: string, authoredStateSha256: string): Data {
	return {
		schemaVersion: 1, kind: 'video-preset', id: 'preset-1', name: 'Bars',
		modelKind, authoredStateSha256,
	};
}

function finishingPreset(template: Data): Data {
	return { schemaVersion: 1, kind: 'video-finishing-preset', id: 'finish-1', name: 'Warm', template };
}

function fence(source: Data, selectedClipId: string | null = 'clip-1', playheadSample = 0): Data {
	return createFence({ project: source, selectedClipId, playheadSample }) as unknown as Data;
}

function dissolveRequest(source: Data, overrides: Data = {}): Data {
	return {
		fence: fence(source), clipId: 'clip-1', operation: 'apply',
		pairId: 'video-track:clip-1:clip-2', durationFrames: 3, ...overrides,
	};
}

function maskRequest(source: Data, overrides: Data = {}): Data {
	return {
		fence: fence(source), clipId: 'clip-1', operation: 'apply', maskId: null,
		shape: 'rectangle', width: 0.5, height: 0.5, ...overrides,
	};
}

function adjustRequest(source: Data, overrides: Data = {}): Data {
	return {
		fence: fence(source), clipId: 'clip-1', operation: 'apply',
		adjustmentLayerId: null, brightness: 0.5, ...overrides,
	};
}

function presetRequest(source: Data, overrides: Data): Data {
	return { fence: fence(source), clipId: 'clip-1', ...overrides };
}

function freezeRequest(source: Data, overrides: Data = {}): Data {
	return {
		fence: fence(source, 'clip-1', 4_800), clipId: 'clip-1', operation: 'create',
		playheadSample: 4_800, durationFrames: 5, ...overrides,
	};
}

function inertStore(): AudioEditorProjectStore {
	return { loadSource: async () => null } as unknown as AudioEditorProjectStore;
}

function recordingStore(log: StoreLog): AudioEditorProjectStore {
	return {
		writeMediaAsset: async (sourceId: string, blob: Blob, metadata: Data) => {
			log.writes.push({ sourceId, byteLength: blob.size, type: blob.type, metadata });
		},
		deleteMediaAsset: async (sourceId: string) => { log.deletes.push(sourceId); },
	} as unknown as AudioEditorProjectStore;
}

function author(surface: string, request: Data, source: Data, options: AuthoringOptions = {}):
Promise<Readonly<FramescaperSelectedPreparedVisualAuthoringFinishing>> {
	return prepare({
		surface: surface as never, project: source, request,
		store: options.store ?? inertStore(), capture: (options.capture ?? null) as never,
	} as never);
}

async function command(surface: string, request: Data, source: Data): Promise<Data> {
	return (await author(surface, request, source)).command as Data;
}

function steps(value: Data): Data[] {
	assert.equal(value.type, 'batch', 'the authored command must be a history batch');
	return value.commands as Data[];
}

async function refuseEach(surface: string, cases: readonly Refusal[]): Promise<void> {
	for (const [request, source, pattern] of cases) {
		await assert.rejects(() => author(surface, request, source), pattern, String(pattern));
	}
}

test('applying a dissolve moves the incoming clip back and allocates a fresh transition identity', async () => {
	const source = pairProject();
	const move = await command('video-transition-dissolve', dissolveRequest(source), source);
	assert.equal(move.type, 'clip/move');
	assert.equal(move.clipId, 'clip-2');
	assert.equal(move.trackId, 'video-track');
	// Frame 7 of a 30 fps sequence at 48 kHz is sample 7 * 1600.
	assert.equal(move.timelineStartFrame, 11_200);
	const allocations = move.videoTransitionAllocations as Data[];
	assert.equal(allocations.length, 1);
	assert.equal(allocations[0]?.outgoingClipId, 'clip-1');
	assert.ok(String(allocations[0]?.transitionId).startsWith('transition-'));
});

test('removing a dissolve returns the incoming clip to the outgoing edge', async () => {
	const source = dissolvedPair();
	const request = dissolveRequest(source, { operation: 'remove' });
	const move = await command('video-transition-dissolve', request, source);
	assert.equal(move.timelineStartFrame, 16_000);
	assert.equal(move.videoTransitionAllocations, undefined);
});

test('applying a dissolve carries the linked audio peer by the same sample delta', async () => {
	const source = linkedPair();
	const authored = steps(await command('video-transition-dissolve', dissolveRequest(source), source));
	assert.equal(authored.length, 2);
	assert.equal(authored[1]?.clipId, 'audio-2');
	assert.equal(authored[1]?.trackId, 'audio-track');
	assert.equal(authored[1]?.timelineStartFrame, 11_200);
});

test('a linked audio peer in another lane group is left where it is', async () => {
	const source = linkedPair({ laneGroupId: 'lane-a' }, { laneGroupId: 'lane-b' });
	const move = await command('video-transition-dissolve', dissolveRequest(source), source);
	assert.equal(move.type, 'clip/move', 'an unmoved peer must not create a batch');
	assert.equal(move.clipId, 'clip-2');
});

test('every dissolve refusal names the selected state that blocked it', async () => {
	const pair = pairProject();
	const dissolved = dissolvedPair();
	const ambiguous = linkedPair({}, {}, 2);
	const locked = linkedPair({}, { locked: true });
	await refuseEach('video-transition-dissolve', [
		[dissolveRequest(pair, { durationFrames: 6 }), pair, /dissolve duration exceeds the selected pair/u],
		[dissolveRequest(pair, { durationFrames: 0 }), pair, /dissolve duration must be positive/u],
		[dissolveRequest(pair, { operation: 'remove' }), pair, /selected pair has no dissolve to remove/u],
		[dissolveRequest(pair, { pairId: 'video-track:clip-1:clip-9' }), pair, /dissolve pair is stale/u],
		[dissolveRequest(dissolved), dissolved, /dissolve already has that duration/u],
		[dissolveRequest(ambiguous), ambiguous, /ambiguous linked audio/u],
		[dissolveRequest(locked), locked, /requires one unlocked track owner/u],
	]);
});

test('applying a new mask creates its graph and the default presentation that carries it', async () => {
	const source = project();
	const request = maskRequest(source, { shape: 'ellipse', width: 0.5, height: 0.25 });
	const authored = steps(await command('video-mask-matte', request, source));
	assert.equal(authored.length, 2);
	assert.equal(authored[0]?.type, 'video-mask-matte/set');
	assert.equal(authored[0]?.expectedMaskMatte, null);
	const graph = authored[0]?.maskMatte as Data;
	const node = (graph.nodes as Data[])[0]!;
	assert.deepEqual(
		{ shape: node.shape, x: node.x, y: node.y, width: node.width, height: node.height },
		{ shape: 'ellipse', x: 0.25, y: 0.375, width: 0.5, height: 0.25 },
	);
	assert.equal(authored[1]?.expectedPresentation, null);
	assert.deepEqual((authored[1]?.presentation as Data).maskMatteIds, [graph.id]);
	assert.deepEqual((authored[1]?.presentation as Data).owner, { kind: 'clip', id: 'clip-1' });
});

test('applying onto an attached mask reuses that mask node identity', async () => {
	const source = project({
		videoMaskMattes: [maskGraph('mask-1', 'node-1')],
		videoVisualPresentations: [presentation('pres-1', 'clip-1', ['mask-1'])],
	});
	const request = maskRequest(source, { maskId: 'mask-1', width: 0.8, height: 0.8 });
	const authored = steps(await command('video-mask-matte', request, source));
	assert.equal((authored[0]?.maskMatte as Data).id, 'mask-1');
	assert.equal(((authored[0]?.maskMatte as Data).nodes as Data[])[0]?.id, 'node-1');
	assert.equal((authored[0]?.expectedMaskMatte as Data).id, 'mask-1');
	assert.equal(authored[1]?.presentationId, 'pres-1');
	assert.deepEqual((authored[1]?.presentation as Data).maskMatteIds, ['mask-1']);
});

test('removing the last reference to a mask deletes its graph as well', async () => {
	const source = project({
		videoMaskMattes: [maskGraph('mask-1', 'node-1')],
		videoVisualPresentations: [presentation('pres-1', 'clip-1', ['mask-1'])],
	});
	const request = maskRequest(source, { operation: 'remove', maskId: 'mask-1' });
	const authored = steps(await command('video-mask-matte', request, source));
	assert.equal(authored.length, 2);
	assert.deepEqual((authored[0]?.presentation as Data).maskMatteIds, []);
	assert.equal(authored[1]?.type, 'video-mask-matte/set');
	assert.equal(authored[1]?.maskMatte, null);
});

test('removing a mask another presentation still carries keeps its graph', async () => {
	const source = project({
		videoMaskMattes: [maskGraph('mask-1', 'node-1')],
		videoVisualPresentations: [
			presentation('pres-1', 'clip-1', ['mask-1']),
			presentation('pres-2', 'clip-9', ['mask-1']),
		],
	});
	const request = maskRequest(source, { operation: 'remove', maskId: 'mask-1' });
	const only = await command('video-mask-matte', request, source);
	assert.equal(only.type, 'video-visual-presentation/set');
	assert.equal(only.presentationId, 'pres-1');
});

test('every mask refusal names the selected state that blocked it', async () => {
	const bare = project();
	const detached = project({
		videoMaskMattes: [maskGraph('mask-1', 'node-1')],
		videoVisualPresentations: [presentation('pres-1', 'clip-1', [])],
	});
	const ambiguous = project({
		videoVisualPresentations: [presentation('pres-1', 'clip-1', []), presentation('pres-2', 'clip-1', [])],
	});
	const audio = project({ clips: [{ kind: 'audio', id: 'clip-1', timelineStartFrame: 0 }] });
	await refuseEach('video-mask-matte', [
		// The command vocabulary admits a line shape the mask graph itself does not model.
		[maskRequest(bare, { shape: 'line' }), bare, /\.shape is unsupported/u],
		[maskRequest(bare, { width: 0 }), bare, /mask width is outside its finite bound/u],
		[maskRequest(detached, { operation: 'remove', maskId: 'mask-1' }), detached, /mask attachment is stale/u],
		[maskRequest(ambiguous), ambiguous, /ambiguous visual presentations/u],
		[maskRequest(audio), audio, /Select a timeline visual clip/u],
	]);
});

test('applying a first adjustment adds a colour effect and the layer that owns it', async () => {
	const source = project();
	const authored = steps(await command('video-adjustment-layer', adjustRequest(source), source));
	assert.equal(authored[0]?.type, 'video-effect/add');
	const effect = authored[0]?.effect as Data;
	assert.equal(effect.type, 'color-adjust');
	assert.deepEqual(effect.params, { brightness: 0.5, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 });
	const layer = authored[1]?.adjustmentLayer as Data;
	assert.equal(authored[1]?.expectedAdjustmentLayer, null);
	assert.deepEqual(layer.targetTrackIds, ['video-track']);
	assert.deepEqual(layer.effectIds, [effect.id]);
	assert.equal(layer.sequenceFrameCount, 10);
});

test('applying onto an existing adjustment updates only its brightness parameter', async () => {
	const source = project({ videoAdjustmentLayers: [{ id: 'adjust-1', effectIds: ['effect-1'] }] });
	const request = adjustRequest(source, { adjustmentLayerId: 'adjust-1', brightness: -0.25 });
	assert.deepEqual(await command('video-adjustment-layer', request, source), {
		type: 'video-effect/update', clipId: 'clip-1', effectId: 'effect-1',
		changes: { params: { brightness: -0.25 } },
	});
});

test('removing an adjustment deletes the layer and the one effect it owns', async () => {
	const source = project({ videoAdjustmentLayers: [{ id: 'adjust-1', effectIds: ['effect-1'] }] });
	const request = adjustRequest(source, { operation: 'remove', adjustmentLayerId: 'adjust-1' });
	const authored = steps(await command('video-adjustment-layer', request, source));
	assert.equal(authored[0]?.type, 'video-adjustment-layer/set');
	assert.equal(authored[0]?.adjustmentLayer, null);
	assert.deepEqual(authored[1], { type: 'video-effect/remove', clipId: 'clip-1', effectId: 'effect-1' });
});

test('every adjustment refusal names the selected state that blocked it', async () => {
	const bare = project();
	const shared = project({ videoAdjustmentLayers: [{ id: 'adjust-1', effectIds: ['one', 'two'] }] });
	const still = project({
		clips: [{
			kind: 'still', id: 'clip-1', sourceId: 'still-source', sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 10,
		}],
	});
	await refuseEach('video-adjustment-layer', [
		[adjustRequest(bare, { operation: 'remove' }), bare, /adjustment layer is stale/u],
		[adjustRequest(shared, { operation: 'remove', adjustmentLayerId: 'adjust-1' }), shared,
			/requires one owned effect/u],
		[adjustRequest(bare, { brightness: 2 }), bare, /adjustment brightness is outside its finite bound/u],
		[adjustRequest(still), still, /Select a timeline video clip/u],
	]);
});

test('removing a visual preset needs no selected clip and names the preset it expects', async () => {
	const source = project({ videoVisualPresets: [visualPreset('generator', 'a1'.repeat(32))] });
	const authored = await command('video-visual-preset', {
		fence: fence(source), operation: 'remove-visual', presetId: 'preset-1',
	}, source);
	assert.equal(authored.type, 'video-visual-preset/set');
	assert.equal(authored.preset, null);
	assert.equal((authored.expectedPreset as Data).name, 'Bars');
});

test('removing a finishing preset names the finishing preset it expects', async () => {
	const template = { enabled: true, opacity: 0.5, blendMode: 'screen', grade: null };
	const source = project({ videoFinishingPresets: [finishingPreset(template)] });
	const authored = await command('video-visual-preset', {
		fence: fence(source), operation: 'remove-finishing', presetId: 'finish-1',
	}, source);
	assert.equal(authored.type, 'video-finishing-preset/set');
	assert.equal(authored.finishingPreset, null);
	assert.equal((authored.expectedFinishingPreset as Data).id, 'finish-1');
});

test('applying a finishing preset instantiates a fresh presentation under the selected clip', async () => {
	const template = { enabled: true, opacity: 0.5, blendMode: 'screen', grade: null };
	const source = project({ videoFinishingPresets: [finishingPreset(template)] });
	const request = presetRequest(source, { operation: 'apply-finishing', presetId: 'finish-1' });
	const authored = await command('video-visual-preset', request, source);
	assert.equal(authored.expectedPresentation, null);
	const next = authored.presentation as Data;
	assert.deepEqual(next.owner, { kind: 'clip', id: 'clip-1' });
	assert.equal(next.opacity, 0.5);
	assert.equal(next.blendMode, 'screen');
	assert.notEqual(next.id, 'finish-1', 'a preset never donates its own identity');
});

test('applying a finishing preset retires the presentation the clip already had', async () => {
	const template = { enabled: false, opacity: 0.25, blendMode: 'multiply', grade: null };
	const source = project({
		videoVisualPresentations: [presentation('pres-1', 'clip-1', [])],
		videoFinishingPresets: [finishingPreset(template)],
	});
	const request = presetRequest(source, { operation: 'apply-finishing', presetId: 'finish-1' });
	const authored = steps(await command('video-visual-preset', request, source));
	assert.equal(authored.length, 2);
	assert.equal(authored[0]?.presentationId, 'pres-1');
	assert.equal(authored[0]?.presentation, null);
	assert.equal((authored[1]?.presentation as Data).enabled, false);
});

test('saving a visual preset stores a donor source, a bin clip and the digest-bound preset', async () => {
	const source = generatorProject();
	const request = presetRequest(source, { operation: 'save-visual', name: 'House Bars' });
	const authored = steps(await command('video-visual-preset', request, source));
	assert.equal(authored.length, 3);
	assert.equal((authored[0]?.source as Data).name, 'House Bars Model');
	assert.equal(authored[0]?.expectedSource, null);
	assert.equal((authored[1]?.clip as Data).sourceId, (authored[0]?.source as Data).id);
	assert.deepEqual(authored[1]?.placement, { scope: 'project-bin' });
	const preset = authored[2]?.preset as Data;
	assert.equal(preset.name, 'House Bars');
	assert.equal(preset.modelKind, 'generator');
	assert.equal(preset.authoredStateSha256, fingerprintNativeMediaPlan(authored[0]?.source).sha256);
});

test('applying a generator preset copies the donor generator onto the selected source', async () => {
	const donor: Data = {
		kind: 'generator', id: 'donor-source', name: 'Bars Model',
		generator: { kind: 'bars', level: 0.9 },
	};
	const source = generatorProject({
		sources: [GENERATOR_SOURCE, donor],
		videoVisualPresets: [visualPreset('generator', fingerprintNativeMediaPlan(donor).sha256)],
	});
	const request = presetRequest(source, { operation: 'apply-visual', presetId: 'preset-1' });
	const authored = await command('video-visual-preset', request, source);
	assert.equal(authored.type, 'video-visual-source/set');
	assert.equal(authored.sourceId, 'generator-source');
	assert.equal((authored.expectedSource as Data).id, 'generator-source');
	assert.deepEqual((authored.source as Data).generator, { kind: 'bars', level: 0.9 });
	assert.equal((authored.source as Data).name, 'Bars', 'only the generator state is donated');
});

test('every visual preset refusal names the selected state that blocked it', async () => {
	const video = project();
	const generator = generatorProject();
	const orphan = generatorProject({ videoVisualPresets: [visualPreset('generator', 'cd'.repeat(32))] });
	const foreign = generatorProject({ videoVisualPresets: [visualPreset('mask-matte', 'cd'.repeat(32))] });
	await refuseEach('video-visual-preset', [
		[presetRequest(video, { operation: 'save-visual', name: 'Bars' }), video,
			/Select a generator before saving a visual preset/u],
		[presetRequest(generator, { operation: 'save-visual', name: 'Bad\nName' }), generator,
			/visual preset name must be canonical safe text/u],
		[presetRequest(orphan, { operation: 'apply-visual', presetId: 'preset-1' }), orphan,
			/visual preset model is unavailable/u],
		[presetRequest(foreign, { operation: 'apply-visual', presetId: 'preset-1' }), foreign,
			/preset does not target generators/u],
	]);
});

test('every freeze refusal names the selected state that blocked it', async () => {
	const video = project();
	const generated = project({ clips: [videoClip('clip-1', 0, 10, { sourceId: 'generator-source' })] });
	await refuseEach('video-freeze', [
		[freezeRequest(video, { playheadSample: 3_200 }), video, /freeze playhead is stale/u],
		[freezeRequest(video, { fence: fence(video, 'clip-1', 16_000), playheadSample: 16_000 }), video,
			/playhead is outside the selected video/u],
		[freezeRequest(video), video, /Exact freeze capture is unavailable/u],
		[freezeRequest(generated), generated, /selected video source is unavailable/u],
	]);
});

test('a freeze writes the still asset, authors the fallback and offers a rollback', async () => {
	const source = project();
	const log: StoreLog = { writes: [], deletes: [] };
	const requests: Data[] = [];
	const prepared = await author('video-freeze', freezeRequest(source), source, {
		store: recordingStore(log),
		capture: {
			capture: async (request: Data) => {
				requests.push(request);
				return { blob: PNG_BLOB, width: 640, height: 360 };
			},
		},
	});
	const authored = steps(prepared.command as Data);
	assert.deepEqual(requests[0], {
		projectId: 'project-1', projectRevision: 3, timelineSample: 4_800,
		clipId: 'clip-1', sourceId: 'video-source', sourceOrdinal: 3,
	});
	assert.equal(authored.length, 4);
	assert.equal(authored[0]?.type, 'track/add');
	assert.equal(authored[0]?.index, 0);
	const still = authored[1]?.source as Data;
	assert.equal(still.name, 'Reel Freeze');
	assert.equal(still.mimeType, 'image/png');
	assert.equal((authored[2]?.clip as Data).sequenceStartFrame, 3);
	assert.equal((authored[2]?.clip as Data).sequenceFrameCount, 5);
	assert.equal(authored[3]?.expectedFreezeFallback, null);
	assert.equal((authored[3]?.freezeFallback as Data).renderedSourceId, still.id);
	assert.deepEqual(log.writes, [{
		sourceId: still.id, byteLength: 4, type: 'image/png',
		metadata: { name: 'Reel Freeze', mimeType: 'image/png', width: 640, height: 360 },
	}]);
	await prepared.rollback?.();
	assert.deepEqual(log.deletes, [still.id]);
});

test('a freeze capture that does not return a PNG blob is refused and retains no media', async () => {
	const source = project();
	const log: StoreLog = { writes: [], deletes: [] };
	await assert.rejects(() => author('video-freeze', freezeRequest(source), source, {
		store: recordingStore(log),
		capture: {
			capture: async () => ({
				blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
				width: 640, height: 360,
			}),
		},
	}), TypeError);
	assert.deepEqual(log.writes, []);
});
