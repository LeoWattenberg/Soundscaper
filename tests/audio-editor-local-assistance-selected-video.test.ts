/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createLocalAssistanceSelectedMediaPreparationRouter,
} from '../src/common/editor/controller/local-assistance-selected-media-router.ts';
import {
	createLocalAssistanceSelectedPreparation,
} from '../src/common/editor/controller/local-assistance-selected-preparation.ts';
import {
	createLocalAssistanceSelectedVideoPreparation,
	mapLocalAssistanceSelectedVideoSourceBoundary,
	resolveLocalAssistanceSelectedVideoAuthority,
} from '../src/common/editor/controller/local-assistance-selected-video.ts';
import {
	normalizeLocalAssistancePreparedMedia,
} from '../src/common/editor/ui/local-assistance-preparation.ts';
import {
	registerVideoTimingIndex,
	unregisterVideoTimingIndex,
} from '../src/common/editor/video-source-time.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';

const VIDEO_BYTES = new TextEncoder().encode('exact-cfr-video-body');
const VIDEO_SHA256 = bytesToHex(sha256(VIDEO_BYTES));
const VFR_PRESENTATION_TICKS = Object.freeze(Array.from({ length: 240 }, (_, frame) => (
	BigInt(frame * 100 + (frame >= 24 ? 400 : 0))
)));
const VFR_TIMING = vfrTiming();

interface VideoOriginalStoreFixture {
	loadMediaAsset(
		storageKey: string,
		options: Readonly<{ signal: AbortSignal }>,
	): PromiseLike<Blob | null> | Blob | null;
	resolveLinkedVideoOriginal?(
		projectId: string,
		source: Readonly<Record<string, unknown>>,
		options: Readonly<{ signal: AbortSignal }>,
	): PromiseLike<Readonly<{ blob: Blob; binding: unknown }> | null>
		| Readonly<{ blob: Blob; binding: unknown }> | null;
}

test('selected CFR video inventory and preparation retain exact occurrence and original authority', async () => {
	const fixture = videoFixture();
	assert.deepEqual(await fixture.preparation.listSelectedMedia(), { sources: [{
		sourceId: 'video-source', label: 'Camera A', mediaKind: 'video',
		operations: ['shot-detection', 'image-text-embedding', 'optical-character-recognition',
			'subject-detection', 'saliency-detection'],
	}] });
	assert.deepEqual(fixture.events, []);

	const prepared = await fixture.preparation.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection',
	});
	assert.deepEqual(fixture.events, ['owned:video-original']);
	assert.equal(prepared.sourceId, 'video-source');
	assert.equal(prepared.operation, 'shot-detection');
	assert.equal(prepared.shotDetectionMode, 'fast');
	assert.equal(prepared.inputs.length, 1);
	assert.equal(prepared.inputs[0]?.role, 'video');
	assert.equal(prepared.inputs[0]?.mediaType, 'video/mp4');
	assert.deepEqual(new Uint8Array(await prepared.inputs[0]!.bytes.arrayBuffer()), VIDEO_BYTES);
	assert.deepEqual(prepared.outputs, [{
		role: 'shot-boundaries', mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
		maximumByteLength: 64 * 1024 * 1024,
	}]);
	assert.equal(prepared.selectionFence.sequenceId, 'main-sequence');
	assert.deepEqual(prepared.selectionFence.occurrenceIds, ['video-clip']);
	assert.equal(prepared.selectionFence.sourceId, 'video-source');
	assert.equal(prepared.selectionFence.sourceSha256, VIDEO_SHA256);
	assert.equal(prepared.selectionFence.sourceStartFrame, 20);
	assert.equal(prepared.selectionFence.sourceEndFrame, 120);
	assert.match(prepared.selectionFence.linkMembershipSha256, /^[a-f\d]{64}$/u);
	assert.match(prepared.selectionFence.timingAuthoritySha256, /^[a-f\d]{64}$/u);
	const normalized = normalizeLocalAssistancePreparedMedia(prepared, {
		sourceId: 'video-source', operation: 'shot-detection',
	});
	assert.strictEqual(normalized.inputs[0]?.bytes, prepared.inputs[0]?.bytes);
	assert.equal(normalized.shotDetectionMode, 'fast');
});

test('selected CFR video prepares Advanced visual embedding and OCR custody', async () => {
	const fixture = videoFixture();
	for (const [operation, role, mediaType] of [
		['image-text-embedding', 'embeddings', 'application/vnd.soundscaper.embedding-matrix-v1'],
		['optical-character-recognition', 'recognized-text',
			'application/vnd.soundscaper.recognized-text+json'],
	] as const) {
		const prepared = await fixture.preparation.prepareSelectedMedia({
			sourceId: 'video-source', operation,
		});
		assert.equal(prepared.operation, operation);
		assert.deepEqual(prepared.inputs.map(({ role: inputRole, mediaType: inputType }) => ({
			role: inputRole, mediaType: inputType,
		})), [{ role: 'frame-pack', mediaType: 'application/vnd.soundscaper.frame-pack' }]);
		assert.deepEqual(prepared.outputs, [{ role, mediaType,
			maximumByteLength: 64 * 1024 * 1024 }]);
	}
	assert.equal(fixture.visualRequests.length, 2);
	assert.deepEqual(fixture.visualRequests.map(({ timing }) => timing.frames.length), [9, 9]);
});

test('selected video preparation carries an explicit accurate mode without substituting Fast', async () => {
	const fixture = videoFixture();
	const prepared = await fixture.preparation.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection', shotDetectionMode: 'accurate',
	});
	assert.equal(prepared.shotDetectionMode, 'accurate');
	assert.equal(prepared.inputs[0]?.role, 'frame-pack');
	assert.equal(prepared.inputs[0]?.mediaType, 'application/vnd.soundscaper.frame-pack');
	assert.equal(fixture.accurateRequests.length, 1);
	assert.equal(fixture.accurateRequests[0]?.timing.timescale, 24);
	assert.deepEqual(fixture.accurateRequests[0]?.timing.frames.slice(0, 2), [
		{ sourceFrame: 20, presentationTick: '20', timestampSeconds: 20.5 / 24 },
		{ sourceFrame: 21, presentationTick: '21', timestampSeconds: 21.5 / 24 },
	]);
	assert.equal(fixture.accurateRequests[0]?.timing.frames.length, 100);
	assert.equal(normalizeLocalAssistancePreparedMedia(prepared, {
		sourceId: 'video-source', operation: 'shot-detection', shotDetectionMode: 'accurate',
	}).shotDetectionMode, 'accurate');
	assert.throws(() => normalizeLocalAssistancePreparedMedia(prepared, {
		sourceId: 'video-source', operation: 'shot-detection',
	}), /mode|selection/iu, 'the legacy Fast route must not silently consume Accurate preparation');
	assert.deepEqual(fixture.events, ['owned:video-original']);
	const rawFixture = videoFixture();
	const raw = await rawFixture.preparation.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection', shotDetectionMode: 'accurate',
		inputRole: 'video',
	});
	assert.equal(raw.shotDetectionMode, 'accurate');
	assert.equal(raw.inputs[0]?.role, 'video');
	assert.equal(rawFixture.accurateRequests.length, 0,
		'raw sampling custody must not execute or substitute either detector');

	const refused = videoFixture();
	await assert.rejects(refused.preparation.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection',
		shotDetectionMode: 'quality' as never,
	}), /mode|request/iu);
	assert.deepEqual(refused.events, [], 'an unsupported mode must not fall back to Fast custody');
	await assert.rejects(refused.preparation.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection', inputRole: 'frame-pack',
	}), /Accurate|frame-pack/iu);
	assert.deepEqual(refused.events, [], 'frame-pack custody must not silently upgrade Fast');
});

test('selected preparation composition routes F31 video without entering the audio renderer', async () => {
	const project = videoProject();
	let audioRenders = 0;
	const preparation = createLocalAssistanceSelectedPreparation({
		getProject: () => project,
		getSelectedClipId: () => 'video-clip',
		captureProject: () => ({ id: project.id, revision: project.revision }),
		assertProject: (token) => assert.deepEqual(token,
			{ id: project.id, revision: project.revision }),
		async renderDryTrackRange() { audioRenders += 1; return [new Float32Array(1)]; },
		videoStore: { async loadMediaAsset() { return videoBlob(); } },
	});
	assert.deepEqual(await preparation.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection',
	}), await videoFixture().preparation.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection',
	}));
	assert.equal(audioRenders, 0);
	const described = await preparation.describeSelectedVideoSourceTime();
	assert.equal(described.selectionFence.sourceId, 'video-source');
	assert.deepEqual({
		kind: described.descriptor.kind,
		sourceId: described.descriptor.sourceId,
		sourceStartFrame: described.descriptor.sourceStartFrame,
		sourceEndFrame: described.descriptor.sourceEndFrame,
	}, {
		kind: 'selected-video-source-time-authority',
		sourceId: 'video-source',
		sourceStartFrame: 20,
		sourceEndFrame: 120,
	});
});

test('selected video preparation falls back pathlessly to the linked original', async () => {
	const project = videoProject();
	const events: string[] = [];
	const body = videoBlob('');
	const fixture = videoFixture(project, {
		async loadMediaAsset(storageKey, options) {
			assert.equal(storageKey, 'video-original');
			assert.equal(options.signal.aborted, false);
			events.push('owned-miss');
			return null;
		},
		async resolveLinkedVideoOriginal(projectId, source, options) {
			assert.equal(projectId, 'project-1');
			assert.strictEqual(source, project.sources[0]);
			assert.equal(options.signal.aborted, false);
			events.push('linked');
			return Object.freeze({ blob: body, binding: Object.freeze({ token: 'linked-video' }) });
		},
	});
	const prepared = await fixture.preparation.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection',
	});
	assert.deepEqual(events, ['owned-miss', 'linked']);
	assert.deepEqual(new Uint8Array(await prepared.inputs[0]!.bytes.arrayBuffer()), VIDEO_BYTES);
	assert.equal(prepared.inputs[0]?.bytes.type, 'video/mp4');
});

test('verified exact VFR preparation binds presentation timing and maps cuts by wall clock', async () => {
	const project = exactVfrProject();
	const source = project.sources[0]!;
	const timing = source.timingAsset as ReturnType<typeof vfrTiming>['reference'];
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(timing, VFR_TIMING.bytes));
	try {
		const authority = resolveLocalAssistanceSelectedVideoAuthority({
			getProject: () => project,
			getSelectedClipId: () => 'video-clip',
		});
		assert.equal(mapLocalAssistanceSelectedVideoSourceBoundary(authority, 20), 10);
		assert.equal(mapLocalAssistanceSelectedVideoSourceBoundary(authority, 24), 18,
			'irregular presentation time, not ordinal distance, owns the sequence boundary');
		assert.equal(mapLocalAssistanceSelectedVideoSourceBoundary(authority, 120), 110);
		assert.equal(mapLocalAssistanceSelectedVideoSourceBoundary(authority, 19), null);

		const prepared = await videoFixture(project).preparation.prepareSelectedMedia({
			sourceId: 'video-source', operation: 'shot-detection',
		});
		assert.equal(prepared.selectionFence.sourceStartFrame, 20);
		assert.equal(prepared.selectionFence.sourceEndFrame, 120);
		assert.notEqual(prepared.selectionFence.timingAuthoritySha256,
			(await videoFixture().preparation.prepareSelectedMedia({
				sourceId: 'video-source', operation: 'shot-detection',
			})).selectionFence.timingAuthoritySha256);
	} finally {
		unregisterVideoTimingIndex(source);
	}

	const unavailable = videoFixture(exactVfrProject());
	await assert.rejects(unavailable.preparation.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection',
	}), /verified timing view|timing authority/iu);
	assert.deepEqual(unavailable.events, []);
});

test('monotonic forward V16 retimes prepare and invert source cuts deterministically', async () => {
	const project = withClip(videoProject(), {
		sequenceFrameCount: 50,
		retimeMap: forwardRetimeMap(),
	});
	const authority = resolveLocalAssistanceSelectedVideoAuthority({
		getProject: () => project,
		getSelectedClipId: () => 'video-clip',
	});
	assert.equal(mapLocalAssistanceSelectedVideoSourceBoundary(authority, 20), 10);
	assert.equal(mapLocalAssistanceSelectedVideoSourceBoundary(authority, 24), 12);
	assert.equal(mapLocalAssistanceSelectedVideoSourceBoundary(authority, 25), 13,
		'an exact half-boundary uses the canonical point-rounding policy');
	assert.equal(mapLocalAssistanceSelectedVideoSourceBoundary(authority, 120), 60);
	assert.equal(mapLocalAssistanceSelectedVideoSourceBoundary(authority, 121), null);

	const prepared = await videoFixture(project).preparation.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection', shotDetectionMode: 'accurate',
	});
	assert.equal(prepared.shotDetectionMode, 'accurate');
	assert.equal(prepared.selectionFence.sourceStartFrame, 20);
	assert.equal(prepared.selectionFence.sourceEndFrame, 120);
	assert.notEqual(prepared.selectionFence.timingAuthoritySha256,
		(await videoFixture().preparation.prepareSelectedMedia({
			sourceId: 'video-source', operation: 'shot-detection',
		})).selectionFence.timingAuthoritySha256);
});

test('reverse, freeze, non-monotonic, unverifiable, nested, multicamera, and ambiguous video authority refuses before custody', async () => {
	const base = videoProject();
	const cases: readonly Readonly<[string, ReturnType<typeof videoProject>, RegExp]>[] = [
		['foreign family', { ...base, schemaFamily: 'soundscaper' as never }, /Framescaper|family/iu],
		['reverse flag', withClip(base, { reversed: true }), /reverse|forward/iu],
		['unverified VFR', withSource(base, {
			timingDecision: { mode: 'exact', rate: { num: 24, den: 1 } },
			timingAsset: VFR_TIMING.reference,
		}), /verified timing view|timing authority/iu],
		['reverse curve', withClip(base, { retimeMap: reverseRetimeMap() }), /reverse|forward/iu],
		['freeze curve', withClip(base, { retimeMap: freezeRetimeMap() }), /freeze|forward/iu],
		['non-monotonic curve', withClip(base, {
			sequenceFrameCount: 50,
			retimeMap: nonMonotonicRetimeMap(),
		}), /reverse|forward|monotonic/iu],
		['malformed retime', withClip(base, {
			retimeMap: { feature: 'video-retime', points: [] },
		}), /retime|version|map/iu],
		['nested', {
			...base,
			subsequences: [{ id: 'nested', sequenceId: 'main-sequence',
				sourceSequenceId: 'child-sequence' }],
		}, /nested/iu],
		['multicamera', {
			...base,
			multicameraGroups: [{ id: 'multicam', outputClipId: 'video-clip' }],
		}, /multicamera/iu],
		['ambiguous owner', {
			...base,
			tracks: [...base.tracks, { id: 'duplicate-owner', type: 'video', clipIds: ['video-clip'] }],
			sequences: [{ ...base.sequences[0]!, trackIds: ['video-track', 'duplicate-owner'] }],
		}, /ambiguous/iu],
		['ambiguous source', {
			...base,
			sources: [...base.sources, { ...base.sources[0] }],
		}, /ambiguous/iu],
		['ambiguous sequence', {
			...base,
			sequences: [...base.sequences, { ...base.sequences[0] }],
		}, /ambiguous sequence/iu],
		['ambiguous selection', {
			...base,
			selection: { ...base.selection, clipIds: ['video-clip', 'other-clip'] },
		}, /one selected video occurrence/iu],
	];
	for (const [name, project, pattern] of cases) {
		let custodyReads = 0;
		const fixture = videoFixture(project, {
			async loadMediaAsset() { custodyReads += 1; return videoBlob(); },
		});
		await assert.rejects(fixture.preparation.prepareSelectedMedia({
			sourceId: 'video-source', operation: 'shot-detection',
		}), pattern, name);
		assert.equal(custodyReads, 0, name);
		assert.deepEqual(await fixture.preparation.listSelectedMedia(), { sources: [] }, name);
	}
});

test('selected video custody refuses unavailable, unauthenticated, mistyped, and oversized originals', async () => {
	for (const [name, body, maximumInputBytes, pattern] of [
		['unavailable', null, undefined, /unavailable/iu],
		['digest', new Blob(['wrong'], { type: 'video/mp4' }), undefined, /digest/iu],
		['MIME', videoBlob('video/webm'), undefined, /MIME/iu],
		['empty', new Blob([], { type: 'video/mp4' }), undefined, /bound/iu],
		['oversized', videoBlob(), 4, /bound/iu],
	] as const) {
		const fixture = videoFixture(videoProject(), {
			async loadMediaAsset() { return body; },
			async resolveLinkedVideoOriginal() { return null; },
		}, maximumInputBytes);
		await assert.rejects(fixture.preparation.prepareSelectedMedia({
			sourceId: 'video-source', operation: 'shot-detection',
		}), pattern, name);
	}
	assert.throws(() => videoFixture(videoProject(), undefined, 8 * 1024 * 1024 * 1024 + 1),
		/8 GiB/iu);
});

test('selected video preparation propagates cancellation and project-currentness across custody', async () => {
	const controller = new AbortController();
	controller.abort(new DOMException('cancelled', 'AbortError'));
	let reads = 0;
	const cancelled = videoFixture(videoProject(), {
		async loadMediaAsset() { reads += 1; return videoBlob(); },
	});
	await assert.rejects(cancelled.preparation.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection', signal: controller.signal,
	}), { name: 'AbortError' });
	assert.equal(reads, 0);

	let current = videoProject();
	let release!: (value: Blob) => void;
	const gate = new Promise<Blob>((resolve) => { release = resolve; });
	const stale = videoFixture(current, {
		async loadMediaAsset() { return gate; },
	}, undefined, () => current);
	const pending = stale.preparation.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection',
	});
	current = { ...current, revision: current.revision + 1 };
	release(videoBlob());
	await assert.rejects(pending, /project changed/iu);
});

test('selected-media router exposes one inventory and routes model-free video without changing audio acceptance', async () => {
	const calls: string[] = [];
	const audio = {
		async listSelectedMedia() {
			return { sources: [{ sourceId: 'audio-source', label: 'Audio', mediaKind: 'audio' as const,
				operations: ['speech-recognition'] as const }] };
		},
		async prepareSelectedMedia() { calls.push('audio'); return { owner: 'audio' }; },
		async acceptValidatedResult() { calls.push('accept'); },
	};
	const video = {
		async listSelectedMedia() {
			return { sources: [{ sourceId: 'video-source', label: 'Video', mediaKind: 'video' as const,
				operations: ['shot-detection', 'subject-detection', 'saliency-detection'] as const }] };
		},
		async prepareSelectedMedia() { calls.push('video'); return { owner: 'video' }; },
		async describeSelectedVideoSourceTime() {
			calls.push('describe-video');
			return { descriptor: { kind: 'authority' }, selectionFence: { sourceId: 'video-source' } };
		},
	};
	const router = createLocalAssistanceSelectedMediaPreparationRouter({ audio, video });
	assert.deepEqual((await router.listSelectedMedia()).sources.map(({ sourceId }) => sourceId), [
		'audio-source', 'video-source',
	]);
	assert.deepEqual(await router.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection',
	}), { owner: 'video' });
	assert.deepEqual(await router.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'subject-detection',
	}), { owner: 'video' });
	assert.deepEqual(await router.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'saliency-detection',
	}), { owner: 'video' });
	assert.deepEqual(await router.prepareSelectedMedia({
		sourceId: 'audio-source', operation: 'speech-recognition',
	}), { owner: 'audio' });
	assert.deepEqual(await router.describeSelectedVideoSourceTime(), {
		descriptor: { kind: 'authority' }, selectionFence: { sourceId: 'video-source' },
	});
	await router.acceptValidatedResult?.({ reviewed: true });
	assert.deepEqual(calls, ['video', 'video', 'video', 'audio', 'describe-video', 'accept']);

	const audioOnly = createLocalAssistanceSelectedMediaPreparationRouter({ audio, video: null });
	await assert.rejects(audioOnly.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection',
	}), /selected video preparation/iu);
	await assert.rejects(audioOnly.describeSelectedVideoSourceTime(),
		/selected video preparation/iu);
});

function videoFixture(
	projectValue = videoProject(),
	store?: VideoOriginalStoreFixture,
	maximumInputBytes?: number,
	getCurrent: () => ReturnType<typeof videoProject> = () => projectValue,
) {
	const events: string[] = [];
	const accurateRequests: Array<Readonly<{
		body: Blob;
		timing: Readonly<{ timescale: number; frames: readonly Readonly<{
			sourceFrame: number; presentationTick: string; timestampSeconds: number;
		}>[] }>;
		signal: AbortSignal;
		assertCurrent: () => void;
	}>> = [];
	const visualRequests: Array<Readonly<{ timing: Readonly<{ frames: readonly unknown[] }> }>> = [];
	const resolvedStore: VideoOriginalStoreFixture = store ?? {
		async loadMediaAsset(storageKey) {
			events.push(`owned:${storageKey}`);
			return videoBlob();
		},
	};
	const preparation = createLocalAssistanceSelectedVideoPreparation({
		getProject: getCurrent,
		getSelectedClipId: () => 'video-clip',
		captureProject: () => ({ id: getCurrent().id, revision: getCurrent().revision }),
		assertProject: (token) => {
			assert.deepEqual(token, { id: getCurrent().id, revision: getCurrent().revision },
				'project changed');
		},
		store: resolvedStore,
		createAccurateFramePacks: async (request) => {
			accurateRequests.push(request);
			request.signal.throwIfAborted();
			request.assertCurrent();
			return Object.freeze([new Blob(['reviewed-frame-pack'], {
				type: 'application/vnd.soundscaper.frame-pack',
			})]);
		},
		createVisualFramePack: async (request) => {
			visualRequests.push(request);
			request.signal.throwIfAborted();
			request.assertCurrent();
			return new Blob(['reviewed-visual-frame-pack'], {
				type: 'application/vnd.soundscaper.frame-pack',
			});
		},
		...(maximumInputBytes === undefined ? {} : { maximumInputBytes }),
	});
	return { accurateRequests, visualRequests, events, preparation };
}

function videoProject() {
	return {
		id: 'project-1', schemaFamily: 'framescaper' as const, schemaVersion: 1,
		revision: 7, sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		selection: { startFrame: 0, endFrame: 200_000,
			clipIds: ['video-clip'], trackIds: ['video-track'] },
		sources: [{
			id: 'video-source', name: 'Camera A', kind: 'video', storageKey: 'video-original',
			mimeType: 'video/mp4', contentSha256: VIDEO_SHA256, sampleRate: 48_000,
			sampleFrameCount: 480_000, sourceFrameCount: 240, frameRate: { num: 24, den: 1 },
			width: 1_920, height: 1_080, timingAsset: null,
			timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 24, den: 1 } },
		}] as Array<Record<string, unknown>>,
		clips: [{
			id: 'video-clip', title: 'Camera A', kind: 'video', sourceId: 'video-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 10, sequenceFrameCount: 100,
			sourceInFrame: 20, sourceFrameCount: 100, retimeMap: null,
			reversed: false, speedRatio: 1, avLinkId: null,
		}] as Array<Record<string, unknown>>,
		tracks: [{ id: 'video-track', name: 'Picture', type: 'video', clipIds: ['video-clip'] }] as
			Array<Record<string, unknown>>,
		sequences: [{ id: 'main-sequence', rate: { num: 24, den: 1 },
			trackIds: ['video-track'] }] as Array<Record<string, unknown>>,
		subsequences: [] as Array<Record<string, unknown>>,
		multicameraGroups: [] as Array<Record<string, unknown>>,
	};
}

function withClip(
	project: ReturnType<typeof videoProject>,
	change: Readonly<Record<string, unknown>>,
): ReturnType<typeof videoProject> {
	return { ...project, clips: [{ ...project.clips[0]!, ...change }] } as ReturnType<typeof videoProject>;
}

function withSource(
	project: ReturnType<typeof videoProject>,
	change: Readonly<Record<string, unknown>>,
): ReturnType<typeof videoProject> {
	return { ...project, sources: [{ ...project.sources[0]!, ...change }] } as ReturnType<typeof videoProject>;
}

function exactVfrProject(): ReturnType<typeof videoProject> {
	return withSource(videoProject(), {
		timingDecision: { mode: 'exact', rate: { num: 24, den: 1 } },
		timingAsset: VFR_TIMING.reference,
	});
}

function vfrTiming() {
	return createVideoTimingAssetPublication(VIDEO_SHA256, {
		timescale: 2_400,
		presentationTicks: VFR_PRESENTATION_TICKS,
		finalFrameDurationTicks: 100n,
	});
}

function forwardRetimeMap() {
	return {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 20, den: 1 } },
			{ outerFrame: 50, sourceFrame: { num: 120, den: 1 } },
		],
		segments: [{ mode: 'constant-forward' }],
	};
}

function reverseRetimeMap() {
	return {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 120, den: 1 } },
			{ outerFrame: 100, sourceFrame: { num: 20, den: 1 } },
		],
		segments: [{ mode: 'constant-reverse' }],
	};
}

function freezeRetimeMap() {
	return {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 20, den: 1 } },
			{ outerFrame: 100, sourceFrame: { num: 20, den: 1 } },
		],
		segments: [{ mode: 'freeze' }],
	};
}

function nonMonotonicRetimeMap() {
	return {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 20, den: 1 } },
			{ outerFrame: 25, sourceFrame: { num: 45, den: 1 } },
			{ outerFrame: 50, sourceFrame: { num: 20, den: 1 } },
		],
		segments: [
			{ mode: 'ramp-forward', startVelocity: { num: 2, den: 1 },
				endVelocity: { num: 0, den: 1 } },
			{ mode: 'ramp-reverse', startVelocity: { num: 0, den: 1 },
				endVelocity: { num: 2, den: 1 } },
		],
	};
}

function videoBlob(type = 'video/mp4'): Blob {
	const buffer = new ArrayBuffer(VIDEO_BYTES.byteLength);
	new Uint8Array(buffer).set(VIDEO_BYTES);
	return new Blob([buffer], { type });
}
