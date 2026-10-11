/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMotionscaperDeliveryAuthority } from '../desktop/motionscaper-delivery-authority.ts';
import { createMotionscaperDesktopProresSink } from '../src/motionscaper/desktop-delivery-adapter.ts';
import { createMotionSurface } from '../src/common/editor/motion-surface.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { openMotionNativeFrameReader } from '../src/common/editor/motion-native-frame-carrier-v1.ts';

test('native v1 carrier projects rendered picture fields while shutter and lens quality stay pinned in job intent', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motionscaper-quality-plan-')); const plan = { identity: { projectId: 'quality', revisionDigest: 'a'.repeat(64), compositionId: 'main' }, width: 1, height: 1, frameRate: { num: 30, den: 1 }, firstFrame: 1, frameCount: 1,
		temporal: { shutterOpenFrames: { num: -1, den: 2 }, shutterCloseFrames: { num: 1, den: 2 }, samples: 4 }, depthOfFieldSamples: 16 };
	let encoded = false;
	const authority = createMotionscaperDeliveryAuthority({ chooseOutput: () => Promise.resolve(join(directory, 'output.mov')), encoder: { async encode(request) {
		assert.deepEqual(request.plan, plan); const bytes = await readFile(request.source); const reader = await openMotionNativeFrameReader(createScapeArchiveByteSource({ size: bytes.length, read: ({ offset, length }) => bytes.slice(offset, offset + length) }), plan.identity);
		assert.ok(!('temporal' in reader.header)); assert.ok(!('depthOfFieldSamples' in reader.header)); assert.deepEqual((await reader.read(0)).pixels, new Float32Array([.2, .3, .4, 1]));
		const movie = new Uint8Array([1, 2, 3]); await writeFile(request.output, movie); encoded = true; return { frameCount: 1, audioSamples: 0, byteLength: 3, sha256: createHash('sha256').update(movie).digest('hex') };
	} } });
	try {
		const sink = await createMotionscaperDesktopProresSink(authority, { plan, suggestedName: 'output.mov' }); assert.ok(sink);
		await sink.write({ index: 0, duration: { num: 1, den: 30 }, time: { num: 1, den: 30 }, surface: { ...createMotionSurface(1, 1, [.2, .3, .4, 1]), consumedOperationIds: [] } });
		await sink.finish(); assert.ok(encoded);
	} finally { await authority.dispose(); await rm(directory, { recursive: true, force: true }); }
});
