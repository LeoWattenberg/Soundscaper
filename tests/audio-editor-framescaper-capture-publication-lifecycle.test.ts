/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCapturePublicationLifecycle,
} from '../src/common/editor/controller/capture/internal/framescaper-capture-publication-lifecycle.ts';
import {
	normalizeFramescaperCaptureSessionManifest,
	type FramescaperCaptureManifestState,
	type FramescaperCaptureSessionManifestV1,
} from '../src/common/editor/framescaper-capture-session-manifest.ts';

const SHA = 'ab'.repeat(32);

test('a live finalization checkpoint stays resumable by either recovery retry', async () => {
	const store = manifestStore(manifest('sealed'));
	const lifecycle = createFramescaperCapturePublicationLifecycle(store, { now: () => 2 });

	const finalizing = await lifecycle.begin(store.current, 'live');
	assert.equal(finalizing.state, 'finalizing');
	assert.equal(finalizing.recoveryDecision, null);

	const recovered = await lifecycle.begin(store.current, 'recovered');
	assert.equal(recovered.state, 'finalizing');
	assert.equal(recovered.recoveryDecision, null);

	const imported = await lifecycle.begin(store.current, 'import-as-is');
	assert.equal(imported.state, 'finalizing');
	assert.equal(imported.recoveryDecision, null);
});

test('a published live checkpoint stays resumable by a recovery retry', async () => {
	const store = manifestStore(manifest('published'));
	const lifecycle = createFramescaperCapturePublicationLifecycle(store, { now: () => 2 });

	const resumed = await lifecycle.begin(store.current, 'recovered');
	assert.equal(resumed.state, 'published');
	assert.equal(resumed.recoveryDecision, null);
});

test('a recorded recovery decision still rejects a retry that changes it', async () => {
	const store = manifestStore(manifest('sealed'));
	const lifecycle = createFramescaperCapturePublicationLifecycle(store, { now: () => 2 });

	const decided = await lifecycle.begin(store.current, 'recovered');
	assert.equal(decided.state, 'finalizing');
	assert.equal(decided.recoveryDecision, 'recover');

	await assert.rejects(
		lifecycle.begin(store.current, 'import-as-is'),
		/recovery decision changed before publication retry/iu,
	);
	const resumed = await lifecycle.begin(store.current, 'recovered');
	assert.equal(resumed.recoveryDecision, 'recover');
});

function manifestStore(initial: FramescaperCaptureSessionManifestV1) {
	let current = initial;
	return {
		get current() { return current; },
		async load(projectIdValue: string, sessionIdValue: string) {
			return projectIdValue === current.projectFence.projectId
				&& sessionIdValue === current.sessionId
				? current
				: null;
		},
		async replace(expectedValue: unknown, nextValue: unknown) {
			const expected = normalizeFramescaperCaptureSessionManifest(expectedValue);
			assert.deepEqual(expected, current, 'the lifecycle must replace the stored manifest');
			current = normalizeFramescaperCaptureSessionManifest(nextValue);
			return current;
		},
	};
}

function manifest(state: FramescaperCaptureManifestState): FramescaperCaptureSessionManifestV1 {
	return normalizeFramescaperCaptureSessionManifest({
		version: 1, sessionId: 'session-a', generation: 1, state, recoveryDecision: null,
		projectFence: {
			schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project-a', baseRevision: 4, baseSha256: SHA,
		},
		origin: { sequenceId: 'sequence-a', playheadMicroseconds: 100, destination: 'both' },
		clock: { monotonicOriginMicroseconds: 1_000, pauseSpans: [] },
		streams: [{
			streamId: 'video-a', role: 'camera', required: true, playability: 'unknown',
			timing: { firstPresentationMicroseconds: 0, lastPresentationEndMicroseconds: 1_000 },
			storage: {
				kind: 'encoded-media', spoolId: 'spool-a', spoolToken: 'token-a',
				sourceId: 'source-a', chunkCount: 1, mimeType: 'video/webm',
				packetCount: 1, byteLength: 4,
			},
		}],
		createdAt: 1, updatedAt: 1,
	});
}
