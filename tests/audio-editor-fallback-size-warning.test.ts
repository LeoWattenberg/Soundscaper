/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { SCAPE_ARCHIVE_LIMITS } from '../src/common/editor/scape-archive-envelope.ts';
import { verifyProjectFallbackIntegrity } from '../src/common/editor/project-fallback-integrity.ts';
import type { FileSizeWarning } from '../src/common/editor/controller/shared/file-size-warning.ts';

function project() {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1, sampleRate: 48_000,
		primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 24, den: 1 } }],
		sources: [{ id: 'render', storageKey: 'video-storage', kind: 'video', frameCount: 1,
			channelCount: 1, chunkFrames: 1, sampleRate: 48_000, width: 1, height: 1, frameRate: 24, hasAudio: false }],
		clips: [], featureRequirements: { schemaVersion: 2, requirements: [{
			id: 'video-render', featureId: 'org.soundscaper.capability.video-effects', displayName: 'Video',
			disposition: 'rendered-fallback', fallback: { role: 'project-video-render-v1', kind: 'video',
				sourceId: 'render', sha256: 'a'.repeat(64) },
		}] },
	};
}

test('fallback cumulative-byte admission awaits confirmation before reading any body and still enforces exact size', async () => {
	const size = SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes + 1;
	let bodyReads = 0;
	const warnings: FileSizeWarning[] = [];
	const store = { getMediaAssetMetadata: () => ({ size }), loadMediaAsset: () => { bodyReads += 1; return new Blob(['small']); } };
	await assert.rejects(verifyProjectFallbackIntegrity(project(), store, {
		confirmFileSizeWarning: async (warning) => { warnings.push(warning); assert.equal(bodyReads, 0); return true; },
	}), /unexpected size/iu);
	assert.equal(bodyReads, 1);
	assert.deepEqual(warnings, [{ label: 'Rendered fallback media', byteLength: size,
		thresholdBytes: SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes }]);
});

test('cancelled, aborted, or stale fallback confirmation performs no body read', async () => {
	for (const outcome of ['cancel', 'abort', 'stale'] as const) {
		const candidate = project();
		const controller = new AbortController();
		let bodyReads = 0;
		await assert.rejects(verifyProjectFallbackIntegrity(candidate, {
			getMediaAssetMetadata: () => ({ size: SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes + 1 }),
			loadMediaAsset: () => { bodyReads += 1; return new Blob(); },
		}, { signal: controller.signal, confirmFileSizeWarning: async () => {
			if (outcome === 'abort') controller.abort();
			if (outcome === 'stale') candidate.sources[0]!.storageKey = 'replaced';
			return outcome !== 'cancel';
		} }), { name: 'AbortError' });
		assert.equal(bodyReads, 0);
	}
});

test('invalid cumulative byte counts remain non-overridable', async () => {
	let prompts = 0, bodies = 0;
	await assert.rejects(verifyProjectFallbackIntegrity(project(), {
		getMediaAssetMetadata: () => ({ size: Number.MAX_SAFE_INTEGER + 1 }),
		loadMediaAsset: () => { bodies += 1; return new Blob(); },
	}, { confirmFileSizeWarning: async () => { prompts += 1; return true; } }), /invalid stored size/iu);
	assert.equal(prompts, 0);
	assert.equal(bodies, 0);
});
