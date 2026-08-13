/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { acquireVideoExportTimingIndexes } from '../src/common/editor/controller/video-export-timing.ts';
import {
	boundVideoSourceTimingViewInfo,
	videoSourceFrameTime,
} from '../src/common/editor/video-source-timing-view.ts';
import { registeredVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';

const CFR_SHA256 = '31'.repeat(32);
const VFR_SHA256 = '32'.repeat(32);
const NTSC = Object.freeze({ num: 30_000, den: 1_001 });
const publication = createVideoTimingAssetPublication(VFR_SHA256, {
	timescale: 90_000,
	presentationTicks: [0n, 3_003n, 7_007n],
	finalFrameDurationTicks: 5_005n,
});

test('requested CFR export timing is bound exactly without loading unrelated VFR bytes', async () => {
	const fixture = timingFixture();
	const lease = await acquireVideoExportTimingIndexes(
		fixture.project,
		fixture.store,
		fixture.dependencies,
		{ assertCurrent() {}, requiredSourceIds: ['camera-cfr'] },
	);
	try {
		assert.deepEqual(fixture.loads, []);
		assert.deepEqual([...lease.timingBySourceId.keys()], ['camera-cfr']);
		const timing = lease.timingBySourceId.get('camera-cfr');
		assert.deepEqual(boundVideoSourceTimingViewInfo(timing), {
			sourceId: 'camera-cfr', frameCount: 3, kind: 'cfr',
		});
		assert.deepEqual(videoSourceFrameTime(timing!, { numerator: 1n, denominator: 1n }), {
			numerator: 1_001n, denominator: 30_000n,
		});
		assert.equal(Object.isFrozen(lease.timingBySourceId), true);
		assert.throws(
			() => (lease.timingBySourceId as Map<string, unknown>).set('forged', Object.freeze({})),
			/immutable/iu,
		);
		assert.throws(
			() => Map.prototype.set.call(
				lease.timingBySourceId, 'intrinsic-forgery', timing,
			),
			/(?:incompatible|Map)/iu,
		);
		assert.deepEqual([...lease.timingBySourceId.keys()], ['camera-cfr']);
	} finally {
		lease.release();
	}
});

test('requested VFR export timing loads, verifies, binds, and restores only that source', async () => {
	const fixture = timingFixture();
	const lease = await acquireVideoExportTimingIndexes(
		fixture.project,
		fixture.store,
		fixture.dependencies,
		{ assertCurrent() {}, requiredSourceIds: ['camera-vfr'] },
	);
	const source = fixture.sources.find(({ id }) => id === 'camera-vfr')!;
	try {
		assert.deepEqual(fixture.loads, [publication.reference.storageKey]);
		assert.equal(registeredVideoTimingIndex(source)?.presentationTicks[2], 7_007n);
		const timing = lease.timingBySourceId.get('camera-vfr');
		assert.deepEqual(boundVideoSourceTimingViewInfo(timing), {
			sourceId: 'camera-vfr', frameCount: 3, kind: 'vfr',
		});
		assert.deepEqual(videoSourceFrameTime(timing!, { numerator: 2n, denominator: 1n }), {
			numerator: 7_007n, denominator: 90_000n,
		});
	} finally {
		assert.equal(lease.release(), true);
	}
	assert.equal(registeredVideoTimingIndex(source), undefined);
});

test('required export timing IDs must be unique active visible video sources', async () => {
	const fixture = timingFixture();
	await assert.rejects(
		acquireVideoExportTimingIndexes(
			fixture.project,
			fixture.store,
			fixture.dependencies,
			{ assertCurrent() {}, requiredSourceIds: ['camera-vfr', 'camera-vfr'] },
		),
		/duplicate/iu,
	);
	await assert.rejects(
		acquireVideoExportTimingIndexes(
			fixture.project,
			fixture.store,
			fixture.dependencies,
			{ assertCurrent() {}, requiredSourceIds: ['hidden-camera'] },
		),
		/active visible/iu,
	);
	assert.deepEqual(fixture.loads, []);
});

test('export timing captures source identity before asynchronous VFR loading', async () => {
	const fixture = timingFixture();
	let continueLoad!: () => void;
	const gate = new Promise<void>((resolve) => { continueLoad = resolve; });
	const acquisition = acquireVideoExportTimingIndexes(
		fixture.project,
		{
			async loadMediaAsset(storageKey: string) {
				fixture.loads.push(storageKey);
				await gate;
				return blobFromBytes(publication.bytes);
			},
		},
		fixture.dependencies,
		{ assertCurrent() {}, requiredSourceIds: ['camera-vfr'] },
	);
	const source = fixture.sources.find(({ id }) => id === 'camera-vfr')! as unknown as Record<string, unknown>;
	source.contentSha256 = CFR_SHA256;
	continueLoad();
	const lease = await acquisition;
	try {
		assert.deepEqual(boundVideoSourceTimingViewInfo(lease.timingBySourceId.get('camera-vfr')), {
			sourceId: 'camera-vfr', frameCount: 3, kind: 'vfr',
		});
	} finally {
		lease.release();
	}
});

function timingFixture() {
	const cfr = Object.freeze({
		id: 'camera-cfr', kind: 'video', contentSha256: CFR_SHA256,
		frameRate: NTSC, sourceFrameCount: 3, timingAsset: null,
		timingDecision: Object.freeze({ mode: 'conform-cfr-at-ingest', rate: NTSC }),
	});
	const vfr = {
		id: 'camera-vfr', kind: 'video', contentSha256: VFR_SHA256,
		frameRate: NTSC, sourceFrameCount: 3, timingAsset: publication.reference,
		timingDecision: Object.freeze({ mode: 'exact', rate: NTSC, backend: 'demuxer' }),
	};
	const hidden = Object.freeze({
		id: 'hidden-camera', kind: 'video', contentSha256: CFR_SHA256,
		frameRate: NTSC, sourceFrameCount: 3, timingAsset: null,
		timingDecision: Object.freeze({ mode: 'conform-cfr-at-ingest', rate: NTSC }),
	});
	const clips = Object.freeze([
		Object.freeze({ id: 'cfr-clip', kind: 'video', sourceId: cfr.id }),
		Object.freeze({ id: 'vfr-clip', kind: 'video', sourceId: vfr.id }),
		Object.freeze({ id: 'hidden-clip', kind: 'video', sourceId: hidden.id }),
	]);
	const sources = Object.freeze([cfr, vfr, hidden]);
	const project = Object.freeze({
		tracks: Object.freeze([
			Object.freeze({ id: 'picture', type: 'video', hidden: false, clipIds: Object.freeze(['cfr-clip', 'vfr-clip']) }),
			Object.freeze({ id: 'hidden', type: 'video', hidden: true, clipIds: Object.freeze(['hidden-clip']) }),
		]),
		clips,
		sources,
	});
	const loads: string[] = [];
	return {
		project,
		sources,
		loads,
		store: {
			loadMediaAsset(storageKey: string) {
				loads.push(storageKey);
				return Promise.resolve(blobFromBytes(publication.bytes));
			},
		},
		dependencies: {
			findClip: (_project: unknown, id: string) => clips.find((clip) => clip.id === id),
			findSource: (_project: unknown, id: string) => sources.find((source) => source.id === id),
		},
	};
}

function blobFromBytes(bytes: Uint8Array): Blob {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return new Blob([copy]);
}
