/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	verifyProjectFallbackIntegrity,
	type ProjectAudioFallbackIntegritySelector,
	type ProjectVideoFallbackIntegritySelector,
} from '../src/common/editor/project-fallback-integrity.ts';
const VIDEO_BYTES = Uint8Array.of(0x72, 0x65, 0x6e, 0x64, 0x65, 0x72);
const VIDEO_DIGEST = createHash('sha256').update(VIDEO_BYTES).digest('hex');
const VIDEO_SELECTOR: ProjectVideoFallbackIntegritySelector = Object.freeze({
	requirementId: 'video-render',
	featureId: 'org.soundscaper.capability.video-effects',
	role: 'project-video-render-v1',
	kind: 'video',
	sourceId: 'rendered-video',
	sha256: VIDEO_DIGEST,
	targetClipId: null,
});
const CLIP_SELECTOR: ProjectVideoFallbackIntegritySelector = Object.freeze({
	...VIDEO_SELECTOR,
	role: 'video-clip-render-v1',
	targetClipId: 'target-clip',
});

test('rendered-fallback selectors refuse wrong relationship roles before media reads', async () => {
	let reads = 0;
	const videoStore = {
		getMediaAssetMetadata() { reads += 1; return { size: VIDEO_BYTES.byteLength }; },
		loadMediaAsset() { reads += 1; return new Blob([VIDEO_BYTES]); },
	};
	const wrongVideoSelectors = [
		{ ...VIDEO_SELECTOR, role: 'project-audio-mix-v1' },
		{ ...VIDEO_SELECTOR, role: 'video-clip-render-v1' },
		{ ...VIDEO_SELECTOR, targetClipId: 'target-clip' },
		{ ...CLIP_SELECTOR, targetClipId: null },
	];
	for (const selector of wrongVideoSelectors) {
		await assert.rejects(
			() => verifyProjectFallbackIntegrity(fullVideoProject(), videoStore, {
				videoFallback: selector as unknown as ProjectVideoFallbackIntegritySelector,
			}),
			/selected video rendered fallback/iu,
		);
	}
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(fullVideoProject(), videoStore, { videoFallback: CLIP_SELECTOR }),
		/selected video rendered fallback/iu,
	);
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(clipVideoProject(), videoStore, { videoFallback: VIDEO_SELECTOR }),
		/selected video rendered fallback/iu,
	);

	const audioSelector = {
		requirementId: 'audio-render',
		featureId: 'org.soundscaper.capability.audio-effects',
		role: 'project-video-render-v1',
		kind: 'audio',
		sourceId: 'rendered-audio',
		sha256: 'ab'.repeat(32),
	};
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(audioProject(), {
			readSourceChunks() { reads += 1; throw new Error('unexpected audio read'); },
			readSourceChunk() { reads += 1; throw new Error('unexpected audio chunk read'); },
		}, { audioFallback: audioSelector as unknown as ProjectAudioFallbackIntegritySelector }),
		/selected audio rendered fallback/iu,
	);
	assert.equal(reads, 0);
});

test('clip context snapshot rejects accessors and cyclic hostile params before media reads', async () => {
	let getterCalls = 0;
	let reads = 0;
	const accessorProject = clipVideoProject();
	const accessorEffect = (accessorProject.clips[0]!.videoEffects as Array<Record<string, unknown>>)[0]!;
	Object.defineProperty(
		accessorEffect.params as object,
		'blockSize',
		{ enumerable: true, get() { getterCalls += 1; return 12; } },
	);
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(accessorProject, unreadVideoStore(() => { reads += 1; })),
		/own data property/iu,
	);

	const cyclicProject = clipVideoProject();
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	(cyclicProject.clips[0]!.videoEffects as Array<Record<string, unknown>>)[0]!.params = {
		blockSize: cyclic,
	};
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(cyclicProject, unreadVideoStore(() => { reads += 1; })),
		/blockSize|between/iu,
	);
	assert.equal(getterCalls, 0);
	assert.equal(reads, 0);
});

test('default and selected admissions abort when an admitted fallback role drifts', async () => {
	for (const selected of [false, true]) {
		const candidate = fullVideoProject();
		const admission = await verifyProjectFallbackIntegrity(candidate, videoStore(), selected
			? { videoFallback: VIDEO_SELECTOR }
			: {});
		const fallback = candidate.featureRequirements.requirements[0]!.fallback;
		candidate.featureRequirements.requirements[0]!.fallback = {
			...fallback,
			role: 'video-clip-render-v1',
			targetClipId: 'target-clip',
		};
		assertAdmissionAborted(() => admission.assertCurrent(candidate));
	}
});

test('default and selected admissions abort when the clip fallback target drifts', async () => {
	for (const selected of [false, true]) {
		const candidate = clipVideoProject();
		const admission = await verifyProjectFallbackIntegrity(candidate, videoStore(), selected
			? { videoFallback: CLIP_SELECTOR }
			: {});
		candidate.clips[0]!.id = 'renamed-target';
		candidate.featureRequirements.requirements[0]!.fallback.targetClipId = 'renamed-target';
		assertAdmissionAborted(() => admission.assertCurrent(candidate));
	}
});

test('same-source claims with different fallback relationships conflict before media reads', async () => {
	let reads = 0;
	const candidate = clipVideoProject();
	candidate.featureRequirements.requirements.push({
		id: 'whole-video-render',
		featureId: 'org.soundscaper.capability.video-effects',
		displayName: 'Whole video render',
		disposition: 'rendered-fallback',
		fallback: {
			role: 'project-video-render-v1',
			kind: 'video',
			sourceId: 'rendered-video',
			sha256: VIDEO_DIGEST,
		},
	});
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(candidate, {
			getMediaAssetMetadata() { reads += 1; return { size: VIDEO_BYTES.byteLength }; },
			loadMediaAsset() { reads += 1; return new Blob([VIDEO_BYTES]); },
		}),
		/conflicting.*relationship/iu,
	);
	assert.equal(reads, 0);
});

test('verified video Blob retrieval binds role and clip target equality', async () => {
	const fullAdmission = await verifyProjectFallbackIntegrity(fullVideoProject(), videoStore(), {
		videoFallback: VIDEO_SELECTOR,
	});
	assert.throws(
		() => fullAdmission.getVerifiedVideoBlob(CLIP_SELECTOR),
		/does not match the verified video rendered fallback/iu,
	);

	const clipAdmission = await verifyProjectFallbackIntegrity(clipVideoProject(), videoStore(), {
		videoFallback: CLIP_SELECTOR,
	});
	assert.throws(
		() => clipAdmission.getVerifiedVideoBlob({ ...CLIP_SELECTOR, targetClipId: 'other-target' }),
		/does not match the verified video rendered fallback/iu,
	);
});

function fullVideoProject(): MutableProject {
	return project({
		role: 'project-video-render-v1',
		kind: 'video',
		sourceId: 'rendered-video',
		sha256: VIDEO_DIGEST,
	});
}

function clipVideoProject(): MutableProject {
	return project({
		role: 'video-clip-render-v1',
		kind: 'video',
		sourceId: 'rendered-video',
		sha256: VIDEO_DIGEST,
		targetClipId: 'target-clip',
	});
}

interface MutableProject {
	schemaFamily: 'framescaper';
	schemaVersion: number;
	sampleRate: number;
	primarySequenceId: string;
	sequences: Array<Record<string, unknown>>;
	sources: Array<Record<string, unknown>>;
	clips: Array<Record<string, unknown>>;
	featureRequirements: {
		schemaVersion: number;
		requirements: Array<{
			id: string;
			featureId: string;
			displayName: string;
			disposition: string;
			fallback: Record<string, unknown>;
		}>;
	};
}

function project(fallback: Record<string, unknown>): MutableProject {
	return {
		schemaFamily: 'framescaper',
		schemaVersion: 1,
		sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 } }],
		sources: [{
			id: 'canonical-video', kind: 'video', storageKey: 'canonical-video',
			frameCount: 48, sampleRate: 48_000, width: 1_920, height: 1_080,
			frameRate: 24, hasAudio: true, channelCount: 1, chunkFrames: 48,
		}, {
			id: 'rendered-video', kind: 'video', storageKey: 'rendered-video-storage',
			frameCount: 12, sampleRate: 48_000, width: 1_920, height: 1_080,
			frameRate: 24, hasAudio: false, channelCount: 1, chunkFrames: 12,
		}],
		clips: [{
			id: 'target-clip', kind: 'video', sourceId: 'canonical-video', durationFrames: 12,
			videoEffects: [{
				id: 'pixelate-target', type: 'pixelate', enabled: true, params: { blockSize: 12 },
			}],
		}],
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'video-render',
				featureId: 'org.soundscaper.capability.video-effects',
				displayName: 'Video render',
				disposition: 'rendered-fallback',
				fallback,
			}],
		},
	};
}

function audioProject(): Record<string, unknown> {
	return {
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 } }],
		sources: [{
			id: 'rendered-audio', kind: 'audio', storageKey: 'rendered-audio',
			frameCount: 1, channelCount: 1, chunkFrames: 1, sampleRate: 48_000,
		}],
		clips: [],
		featureRequirements: { schemaVersion: 2, requirements: [{
			id: 'audio-render', featureId: 'org.soundscaper.capability.audio-effects',
			displayName: 'Audio render', disposition: 'rendered-fallback',
			fallback: {
				role: 'project-audio-mix-v1', kind: 'audio', sourceId: 'rendered-audio', sha256: 'ab'.repeat(32),
			},
		}] },
	};
}

function videoStore() {
	return {
		getMediaAssetMetadata() { return { size: VIDEO_BYTES.byteLength }; },
		loadMediaAsset() { return new Blob([VIDEO_BYTES]); },
	};
}

function unreadVideoStore(read: () => void) {
	return {
		getMediaAssetMetadata() { read(); throw new Error('unexpected metadata read'); },
		loadMediaAsset() { read(); throw new Error('unexpected body read'); },
	};
}

function assertAdmissionAborted(run: () => void): void {
	assert.throws(run, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
}
