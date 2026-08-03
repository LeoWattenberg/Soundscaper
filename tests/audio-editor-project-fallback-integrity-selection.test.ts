/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	verifyProjectFallbackIntegrity,
	type ProjectVideoFallbackIntegritySelector,
} from '../src/common/editor/project-fallback-integrity.ts';

const VIDEO_BYTES = Uint8Array.of(0x66, 0x61, 0x6c, 0x6c, 0x62, 0x61, 0x63, 0x6b);
const VIDEO_SHA256 = digest(VIDEO_BYTES);
const VIDEO_SELECTOR: ProjectVideoFallbackIntegritySelector = Object.freeze({
	requirementId: 'video-fallback',
	featureId: 'org.soundscaper.video-effects',
	role: 'project-video-render-v1',
	kind: 'video',
	sourceId: 'rendered-video',
	sha256: VIDEO_SHA256,
	targetClipId: null,
});

test('selected video verification skips a missing unrelated body and retains one canonical Blob', async () => {
	let videoLoads = 0;
	const admission = await verifyProjectFallbackIntegrity(fallbackProject(), {
		getMediaAssetMetadata(sourceId) {
			assert.equal(sourceId, 'video-storage');
			return { size: VIDEO_BYTES.byteLength };
		},
		loadMediaAsset(sourceId) {
			assert.equal(sourceId, 'video-storage');
			videoLoads += 1;
			return new Blob([VIDEO_BYTES]);
		},
	}, { videoFallback: VIDEO_SELECTOR });

	const verifiedBlob = admission.getVerifiedVideoBlob(VIDEO_SELECTOR);
	assert.equal(videoLoads, 1);
	assert.equal(admission.getVerifiedVideoBlob(VIDEO_SELECTOR), verifiedBlob);
	assert.deepEqual(new Uint8Array(await verifiedBlob.arrayBuffer()), VIDEO_BYTES);
});

test('selected video verification rejects mismatched and ambiguous selectors before storage', async () => {
	let storageReads = 0;
	const store = {
		getMediaAssetMetadata() { storageReads += 1; return { size: VIDEO_BYTES.byteLength }; },
		loadMediaAsset() { storageReads += 1; return new Blob([VIDEO_BYTES]); },
	};
	const mismatches: unknown[] = [
		{ ...VIDEO_SELECTOR, requirementId: 'wrong-requirement' },
		{ ...VIDEO_SELECTOR, featureId: 'org.soundscaper.wrong-feature' },
		{ ...VIDEO_SELECTOR, sourceId: 'wrong-source' },
		{ ...VIDEO_SELECTOR, kind: 'audio' },
		{ ...VIDEO_SELECTOR, sha256: 'f'.repeat(64) },
	];
	for (const mismatch of mismatches) {
		await assert.rejects(
			() => verifyProjectFallbackIntegrity(fallbackProject(), store, {
				videoFallback: mismatch as ProjectVideoFallbackIntegritySelector,
			}),
			/selected video rendered fallback/iu,
		);
	}
	assert.equal(storageReads, 0);

	const duplicateRequirement = fallbackProject();
	duplicateRequirement.featureRequirements.requirements.push({
		...duplicateRequirement.featureRequirements.requirements[1]!,
	});
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(duplicateRequirement, store, { videoFallback: VIDEO_SELECTOR }),
		/duplicate project feature requirement ID/iu,
	);
	assert.equal(storageReads, 0);
});

test('selected admission guards Blob retrieval and current requirement identity', async () => {
	const candidate = fallbackProject();
	const admission = await verifyProjectFallbackIntegrity(candidate, videoStore(), {
		videoFallback: VIDEO_SELECTOR,
	});
	assert.throws(
		() => admission.getVerifiedVideoBlob({ ...VIDEO_SELECTOR, sourceId: 'other-video' }),
		/does not match the verified video rendered fallback/iu,
	);

	candidate.featureRequirements.requirements[1]!.featureId = 'org.soundscaper.changed-feature';
	assert.throws(
		() => admission.assertCurrent(candidate),
		(error: unknown) => error instanceof DOMException && error.name === 'AbortError',
	);
});

test('default verification still verifies every declared fallback and exposes no selected Blob', async () => {
	let audioReads = 0;
	let videoReads = 0;
	const admission = await verifyProjectFallbackIntegrity(fallbackProject(), {
		async *readSourceChunks(sourceId) {
			assert.equal(sourceId, 'audio-storage');
			audioReads += 1;
			yield [Float32Array.of(0.25)];
		},
		getMediaAssetMetadata(sourceId) {
			assert.equal(sourceId, 'video-storage');
			return { size: VIDEO_BYTES.byteLength };
		},
		loadMediaAsset(sourceId) {
			assert.equal(sourceId, 'video-storage');
			videoReads += 1;
			return new Blob([VIDEO_BYTES]);
		},
	});
	assert.equal(audioReads, 1);
	assert.equal(videoReads, 1);
	assert.throws(
		() => admission.getVerifiedVideoBlob(VIDEO_SELECTOR),
		/no selected video rendered fallback/iu,
	);

	await assert.doesNotReject(() => verifyProjectFallbackIntegrity({
		schemaVersion: 10,
		get sources(): never { throw new Error('future sources traversed'); },
		get featureRequirements(): never { throw new Error('future requirements traversed'); },
	}, {}));
	await assert.rejects(
		() => verifyProjectFallbackIntegrity({ schemaVersion: 10 }, {}, { videoFallback: VIDEO_SELECTOR }),
		/selected video rendered fallback.*schema 9/iu,
	);
});

function fallbackProject(): {
	schemaVersion: number;
	sources: Array<Record<string, unknown>>;
	featureRequirements: { schemaVersion: number; requirements: Array<Record<string, unknown>> };
} {
	return {
		schemaVersion: 9,
		sources: [
			{ id: 'rendered-audio', kind: 'audio', storageKey: 'audio-storage', frameCount: 1, channelCount: 1, chunkFrames: 1 },
			{ id: 'rendered-video', kind: 'video', storageKey: 'video-storage', frameCount: 48, channelCount: 1, chunkFrames: 48 },
		],
		featureRequirements: {
			schemaVersion: 1,
			requirements: [
				requirement('audio-fallback', 'org.soundscaper.audio-effects', 'audio', 'rendered-audio', audioDigest(0.25)),
				requirement('video-fallback', VIDEO_SELECTOR.featureId, 'video', VIDEO_SELECTOR.sourceId, VIDEO_SELECTOR.sha256),
			],
		},
	};
}

function requirement(
	id: string,
	featureId: string,
	kind: 'audio' | 'video',
	sourceId: string,
	sha256: string,
): Record<string, unknown> {
	return { id, featureId, displayName: id, disposition: 'rendered-fallback', fallback: { kind, sourceId, sha256 } };
}

function videoStore() {
	return {
		getMediaAssetMetadata() { return { size: VIDEO_BYTES.byteLength }; },
		loadMediaAsset() { return new Blob([VIDEO_BYTES]); },
	};
}

function audioDigest(sample: number): string {
	const bytes = Buffer.alloc(8);
	bytes.writeUInt32LE(1, 0);
	bytes.writeFloatLE(sample, 4);
	return createHash('sha256').update(bytes).digest('hex');
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
