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
} from '../src/common/editor/controller/local-assistance-selected-video.ts';
import {
	normalizeLocalAssistancePreparedMedia,
} from '../src/common/editor/ui/local-assistance-preparation.ts';

const VIDEO_BYTES = new TextEncoder().encode('exact-cfr-video-body');
const VIDEO_SHA256 = bytesToHex(sha256(VIDEO_BYTES));

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
		sourceId: 'video-source', label: 'Camera A', mediaKind: 'video', operations: ['shot-detection'],
	}] });
	assert.deepEqual(fixture.events, []);

	const prepared = await fixture.preparation.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection',
	});
	assert.deepEqual(fixture.events, ['owned:video-original']);
	assert.equal(prepared.sourceId, 'video-source');
	assert.equal(prepared.operation, 'shot-detection');
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
	assert.strictEqual(normalizeLocalAssistancePreparedMedia(prepared, {
		sourceId: 'video-source', operation: 'shot-detection',
	}).inputs[0]?.bytes, prepared.inputs[0]?.bytes);
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

test('reverse, VFR, retimed, nested, multicamera, and ambiguous video authority refuses before custody', async () => {
	const base = videoProject();
	const cases: readonly Readonly<[string, ReturnType<typeof videoProject>, RegExp]>[] = [
		['non-F31', { ...base, schemaVersion: 28 }, /F31/iu],
		['reverse', withClip(base, { reversed: true }), /forward identity/iu],
		['VFR', withSource(base, {
			timingDecision: { mode: 'exact', rate: { num: 24, den: 1 } },
			timingAsset: { storageKey: 'timing' },
		}), /CFR/iu],
		['retime', withClip(base, { retimeMap: { feature: 'video-retime', points: [] } }), /retime/iu],
		['rate conform', {
			...base,
			sequences: [{ ...base.sequences[0]!, rate: { num: 25, den: 1 } }],
		}, /identity rate/iu],
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
				operations: ['shot-detection'] as const }] };
		},
		async prepareSelectedMedia() { calls.push('video'); return { owner: 'video' }; },
	};
	const router = createLocalAssistanceSelectedMediaPreparationRouter({ audio, video });
	assert.deepEqual((await router.listSelectedMedia()).sources.map(({ sourceId }) => sourceId), [
		'audio-source', 'video-source',
	]);
	assert.deepEqual(await router.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection',
	}), { owner: 'video' });
	assert.deepEqual(await router.prepareSelectedMedia({
		sourceId: 'audio-source', operation: 'speech-recognition',
	}), { owner: 'audio' });
	await router.acceptValidatedResult?.({ reviewed: true });
	assert.deepEqual(calls, ['video', 'audio', 'accept']);

	const audioOnly = createLocalAssistanceSelectedMediaPreparationRouter({ audio, video: null });
	await assert.rejects(audioOnly.prepareSelectedMedia({
		sourceId: 'video-source', operation: 'shot-detection',
	}), /selected video preparation/iu);
});

function videoFixture(
	projectValue = videoProject(),
	store?: VideoOriginalStoreFixture,
	maximumInputBytes?: number,
	getCurrent: () => ReturnType<typeof videoProject> = () => projectValue,
) {
	const events: string[] = [];
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
		...(maximumInputBytes === undefined ? {} : { maximumInputBytes }),
	});
	return { events, preparation };
}

function videoProject() {
	return {
		id: 'project-1', schemaVersion: 31, revision: 7, sampleRate: 48_000,
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

function videoBlob(type = 'video/mp4'): Blob {
	const buffer = new ArrayBuffer(VIDEO_BYTES.byteLength);
	new Uint8Array(buffer).set(VIDEO_BYTES);
	return new Blob([buffer], { type });
}
