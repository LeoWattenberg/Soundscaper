/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import type { VideoKeyframeOfflineVideoExportRequest } from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import type { VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import {
	createFramescaperDialogueChainAddCommandV27,
	createFramescaperDialogueChainV27,
} from '../src/framescaper/editor-audio-dialogue-chain-v27.ts';
import { createFramescaperVideoRetimeActionsV20 } from '../src/framescaper/editor-project-v20-retime-actions.ts';
import type { FramescaperVideoRetimeCommandV20 } from '../src/framescaper/editor-project-v20-retime-command.ts';
import {
	createFramescaperProjectHistoryV27,
	executeFramescaperProjectCommandV27,
	redoFramescaperProjectCommandV27,
	undoFramescaperProjectCommandV27,
} from '../src/framescaper/editor-project-v27-history.ts';
import { reconcileFramescaperProjectFeatureRequirementsV27 } from '../src/framescaper/editor-project-feature-requirements-v27.ts';
import { createFramescaperPlaybackProjectServiceV27 } from '../src/framescaper/editor-project-playback-v27.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import {
	cloneFramescaperProjectV27,
	createFramescaperProjectV27,
	type FramescaperProjectV27,
} from '../src/framescaper/editor-project-v27.ts';
import { prepareFramescaperSelectedAuthoringV27 } from '../src/framescaper/editor-selected-v27-authoring-workflows.ts';
import { createFramescaperVideoProxyActionsV27 } from '../src/framescaper/editor-video-proxy-actions-v20.ts';
import {
	createFramescaperVideoExportStrategyV27,
	framescaperVideoExportDispositionV27For,
} from '../src/framescaper/video-export-strategy-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import {
	captureFramescaperExactExportTestFrame,
	composeFramescaperExactExportTestFrame,
} from './helpers/framescaper-exact-export-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('complete V27 program uses admitted authoring, proxy, mix, caption, and repeatable delivery routes', async () => {
	let history = createFramescaperProjectHistoryV27(PROFILE, importProgramThroughCommands());
	const retime = createFramescaperVideoRetimeActionsV20((command: FramescaperVideoRetimeCommandV20) => {
		history = executeFramescaperProjectCommandV27(PROFILE, history, command);
	});
	retime.reverse({ clipId: 'video-clip', expectedRetimeMap: null });
	assert.equal(videoClip(history.present).retimeMap?.segments[0]?.mode, 'constant-reverse');
	history = undoFramescaperProjectCommandV27(PROFILE, history);
	assert.equal(videoClip(history.present).retimeMap, null);
	history = redoFramescaperProjectCommandV27(PROFILE, history);
	assert.equal(videoClip(history.present).retimeMap?.segments[0]?.mode, 'constant-reverse');

	const authored = await prepareFramescaperSelectedAuthoringV27(
		'video-solid', history.present, {} as never,
	);
	assert.ok(authored);
	history = executeFramescaperProjectCommandV27(PROFILE, history, authored.command);
	history = executeFramescaperProjectCommandV27(PROFILE, history,
		completeFinishingCommand(history.present));
	assert.deepEqual(audioTrack(history.present).effects.map(({ type }) => type), [
		'highpass', 'gate', 'eq', 'compressor', 'limiter',
	]);

	const proxy = await exerciseProxyLifecycle(history.present);
	assert.deepEqual(proxy.modes, ['auto', 'original', 'proxy', 'auto']);
	const projected = createFramescaperPlaybackProjectServiceV27(PROFILE)
		.projectForAudioRenderedFallbackDelivery(proxy.project).project as unknown as ProgramProject;
	assert.deepEqual(audioTrack(projected).effects.map(({ type }) => type), [
		'highpass', 'gate', 'eq', 'compressor', 'limiter',
	]);
	assert.deepEqual(projected.automationLanes.map(({ id }) => id), ['programme-gain']);
	assert.equal(projected.mixer.outputs[0]?.name, 'Programme');

	const audioMix = deterministicMix();
	const original = new Blob(['complete-program-original'], { type: 'video/mp4' });
	const delivered = await deliverTwice(proxy.project, original, audioMix);
	assert.deepEqual(delivered.outputs[0], delivered.outputs[1]);
	assert.equal(delivered.requests.length, 2);
	for (const request of delivered.requests) {
		assert.strictEqual(request.sources[0]?.blob, original);
		assert.strictEqual(request.audioMix, audioMix);
		assert.ok((request.project.clips as Readonly<ProgramClip>[])
			.find(({ id }) => id === 'video-clip')?.retimeMap);
	}
	for (const plan of delivered.plans) {
		const disposition = framescaperVideoExportDispositionV27For(plan);
		assert.deepEqual(disposition.captionTrackIds, ['captions-en']);
		assert.equal(disposition.captionDisposition, 'sidecar-only');
		assert.equal(disposition.audioDisposition, 'shared-v21-delivery');
		assert.ok(disposition.originalSourceIds.includes('video-source'));
		assert.deepEqual(disposition.unexplainedOmittedNodeIds, []);
	}
});

function importProgramThroughCommands(): FramescaperProjectV27 {
	const imported = framescaperV20Options();
	const sources = structuredClone(imported.sources as Readonly<Record<string, unknown>[]>);
	const clips = structuredClone(imported.clips as Readonly<Record<string, unknown>[]>);
	const trackByClipId = new Map<string, string>();
	for (const track of imported.tracks as Readonly<Array<Record<string, unknown>>>) {
		for (const clipId of track.clipIds as string[]) trackByClipId.set(clipId, String(track.id));
	}
	const empty = structuredClone(imported);
	empty.sources = [];
	empty.clips = [];
	for (const track of empty.tracks as Array<Record<string, unknown>>) track.clipIds = [];
	(empty.projectBin as Record<string, unknown>).clips = [];
	const project = createFramescaperProjectV27(PROFILE, {
		...empty, videoTransitionsByTrackId: { 'video-track': [] },
	});
	return executeFramescaperProjectCommandV27(
		PROFILE, createFramescaperProjectHistoryV27(PROFILE, project), {
			type: 'batch', commands: [
				...sources.map((source) => ({ type: 'source/add' as const, source })),
				...clips.map((clip) => ({
					type: 'clip/add' as const,
					trackId: trackByClipId.get(String(clip.id))!, clip,
				})),
			],
		},
	).present;
}

function completeFinishingCommand(project: FramescaperProjectV27) {
	const mixer = {
		...structuredClone(project.mixer),
		outputs: project.mixer.outputs.map((output, index) => ({
			...structuredClone(output),
			name: index === 0 ? 'Programme' : output.name,
		})),
	};
	return {
		type: 'batch' as const,
		commands: [{
			type: 'video-visual-presentation/set' as const,
			presentationId: 'programme-grade', expectedPresentation: null,
			presentation: {
				schemaVersion: 1, id: 'programme-grade', owner: { kind: 'clip', id: 'video-clip' },
				enabled: true, opacity: 1, blendMode: 'normal', processorStackId: null,
				maskMatteIds: [], grade: {
					schemaVersion: 1, exposureStops: -1, contrast: 1, pivot: 0.18,
					lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1, lut: null,
				},
			},
		}, {
			type: 'video-caption-track/set' as const,
			captionTrackId: 'captions-en', expectedCaptionTrack: null,
			captionTrack: {
				schemaVersion: 1, id: 'captions-en', sequenceId: 'main-sequence',
				name: 'English', language: 'en', styles: [], regions: [], speakers: [],
				cues: [{ schemaVersion: 1, id: 'cue-1', startFrame: 0, endFrame: 48_000,
					text: 'Programme', styleId: null, regionId: null, speakerId: null, words: [] }],
			},
		}, {
			type: 'automation-lane/set' as const,
			laneId: 'programme-gain', expected: null,
			lane: {
				id: 'programme-gain',
				address: { kind: 'strip', strip: { kind: 'track', id: 'audio-track' }, parameterId: 'gain' },
				timebase: 'absolute-samples',
				points: [{ id: 'start', position: 0, value: 0.5 },
					{ id: 'end', position: 48_000, value: 1 }],
				segments: [{ kind: 'linear' }],
			},
		}, {
			type: 'mixer-graph/set' as const, expected: project.mixer, mixer,
		}, createFramescaperDialogueChainAddCommandV27(
			{ scope: 'track', trackId: 'audio-track' },
			createFramescaperDialogueChainV27({ id: 'dialogue:audio-track', sampleRate: 48_000 }),
		)],
	};
}

async function exerciseProxyLifecycle(projectValue: FramescaperProjectV27) {
	let project = projectValue;
	let refreshes = 0;
	const owner = {
		get project() { return project; },
		actions: {
			edit: { commit: () => undefined, undo: () => undefined },
			video: { reloadSourceVisual: () => { refreshes += 1; } },
			projectBin: {
				canRelinkLinkedVideo: () => false,
				classifyLinkedVideoRelink: () => 'exact-content' as const,
				relinkLinkedVideo: () => undefined,
			},
		},
	};
	const scheduler = () => Object.assign(async () => {
		const draft = structuredClone(project) as unknown as Record<string, unknown>;
		const source = (draft.sources as Array<Record<string, unknown>>)
			.find(({ id }) => id === 'video-source')!;
		source.proxyAttachment = proxyAttachment(String(source.contentSha256));
		draft.revision = Number(draft.revision) + 1;
		draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(PROFILE, draft);
		project = cloneFramescaperProjectV27(PROFILE, draft);
	}, { dispose: async () => undefined });
	const actions = createFramescaperVideoProxyActionsV27({
		owner, createSessionId: () => 'complete-program-proxy-session',
		createScheduler: scheduler, createAttachExistingScheduler: scheduler,
		createDetachCommand: () => ({ type: 'unused' }),
		cleanup: {
			prepareReplacement: async () => ({}) as never,
			cancel: async () => undefined,
			settle: async () => undefined,
		} as never,
		previewTrust: () => 'verified',
	});
	const modes = [actions.mode('video-source')];
	await actions.generate('video-source');
	for (const mode of ['original', 'proxy', 'auto'] as const) {
		await actions.setMode('video-source', mode);
		modes.push(actions.mode('video-source'));
	}
	assert.equal(refreshes, 4);
	return { project, modes };
}

async function deliverTwice(project: FramescaperProjectV27, original: Blob, audioMix: Blob) {
	const requests: VideoKeyframeOfflineVideoExportRequest[] = [];
	const strategy = createFramescaperVideoExportStrategyV27(PROFILE, {
		captureExactFrame: captureFramescaperExactExportTestFrame,
		async encodeOffline(request) {
			requests.push(request);
			const pixels = new Uint8Array(request.canvas.width * request.canvas.height * 4).fill(32);
			for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
			await composeFramescaperExactExportTestFrame(
				request, keyedFrame(), pixels, [32, 32, 32, 255],
			);
			const digest = await digestMediaContent(new Blob([
				await request.sources[0]!.blob.arrayBuffer(),
				await request.audioMix!.arrayBuffer(), pixels,
			]));
			return encodedResult(hexBytes(digest).subarray(0, 16));
		},
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
	});
	const outputs: number[][] = [];
	const plans = [];
	for (let index = 0; index < 2; index += 1) {
		const exportProject = strategy.createExportProject({
			canonicalProject: project,
			delivery: createFramescaperPlaybackProjectServiceV27(PROFILE)
				.projectForVideoRenderedFallbackDelivery(project) as never,
		});
		assert.equal((exportProject.sources as Array<Record<string, unknown>>)[0]?.proxyAttachment, undefined);
		const plan = strategy.createPlan({
			canonicalProject: project, exportProject, format: 'mp4', range: 'project',
			includeAudio: true, canvas: { maximumWidth: 4, maximumHeight: 4 },
		});
		assert.ok(plan);
		plans.push(plan);
		const result = await strategy.encode({
			canonicalProject: project, exportProject, plan,
			timingBySourceId: new Map<string, never>(), timingViewsBySourceId: rawTiming(project),
			videoBlobs: new Map([['video-source', original]]), audioMix,
			editorFfmpeg: {}, webCodecs: null, signal: new AbortController().signal,
			assertCurrent() {}, maximumOutputBytes: 1_024,
		});
		outputs.push([...result.bytes]);
	}
	return { outputs, requests, plans };
}

function deterministicMix(): Blob {
	const channel = Float32Array.from({ length: 480 }, (_unused, frame) => (
		0.125 * Math.sin(2 * Math.PI * 1_000 * frame / 48_000)
	));
	const bytes = encodeWav([channel], { sampleRate: 48_000, bitDepth: 24, dither: 'none' });
	const body = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(body).set(bytes);
	return new Blob([body], { type: 'audio/wav' });
}

function rawTiming(project: FramescaperProjectV27): ReadonlyMap<string, VideoSourceTimingView> {
	const result = new Map<string, VideoSourceTimingView>();
	for (const source of project.sources as readonly Readonly<{
		readonly id: string; readonly kind: string;
		readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
		readonly sourceFrameCount: number;
	}>[]) {
		if (source.kind === 'video') result.set(source.id, Object.freeze({
			kind: 'cfr', rate: source.frameRate, frameCount: source.sourceFrameCount,
		}));
	}
	return result;
}

function proxyAttachment(originalSha256: string) {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${'34'.repeat(32)}`,
		mimeType: 'video/mp4', byteLength: 4_096, sha256: '34'.repeat(32),
		originalSha256, originalAuthorityKind: 'owned', generatorId: 'ffmpeg', generatorVersion: 1,
		recipeId: 'editor-proxy', recipeVersion: 1, timingBackendId: 'ffprobe',
		timingRule: 'exact-presentation-boundaries-v1', frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${'56'.repeat(32)}`, sha256: '56'.repeat(32),
			sourceSha256: '34'.repeat(32), byteLength: 112, frameCount: 10,
			timescale: 10, finalFrameDurationTicks: '1',
		}, audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function keyedFrame() {
	return {
		index: 0, timelineSample: 0, timelinePosition: { num: 0, den: 1 },
		layers: [{ clips: [{ clipId: 'video-clip', sourceId: 'video-source',
			presentationDescriptor: { drawableSourceFrame: 9, outerCell: 0 } }] }],
	};
}

function encodedResult(bytes: Uint8Array<ArrayBuffer>) {
	return Object.freeze({
		bytes, byteLength: bytes.byteLength, videoEncoder: 'ffmpeg' as const,
		format: 'mp4' as const, extension: '.mp4' as const, mimeType: 'video/mp4' as const,
		frameCount: 10, rgbaChunkCount: 1, outputChunkCount: 1,
	});
}

function hexBytes(value: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from({ length: value.length / 2 }, (_unused, index) => (
		Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
	)) as Uint8Array<ArrayBuffer>;
}

interface ProgramClip {
	readonly id: string;
	readonly retimeMap: Readonly<{ readonly segments: readonly Readonly<{ readonly mode: string }>[] }> | null;
}
interface ProgramTrack {
	readonly id: string;
	readonly effects: readonly Readonly<{ readonly type: string }>[];
}
interface ProgramProject {
	readonly clips: readonly ProgramClip[];
	readonly tracks: readonly ProgramTrack[];
	readonly automationLanes: readonly Readonly<{ readonly id: string }>[];
	readonly mixer: Readonly<{ readonly outputs: readonly Readonly<{ readonly name: string }>[] }>;
}

function videoClip(project: FramescaperProjectV27 | ProgramProject): ProgramClip {
	return (project as unknown as ProgramProject).clips.find(({ id }) => id === 'video-clip')!;
}
function audioTrack(project: FramescaperProjectV27 | ProgramProject): ProgramTrack {
	return (project as unknown as ProgramProject).tracks.find(({ id }) => id === 'audio-track')!;
}
