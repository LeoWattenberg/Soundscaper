/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { withMergedImageHdrPreviewCurrentV1 } from '../src/common/editor/controller/shared/image-hdr-merge-preview-current-v1.ts';
import { withImageHdrPixelStagingV1 } from '../src/common/editor/storage/image-hdr-pixel-staging-v1.ts';
import { hdrOpfsStagingFixture } from './helpers/lightscaper-hdr-opfs-staging-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

/** Native storage transport and canonical sampling are explicitly modeled;
 * real merge, lossless codec and final display owners execute unchanged. */
function previewFixture(width = 3, signal?: AbortSignal) {
	const storage = hdrOpfsStagingFixture(), planes: Uint16Array<ArrayBuffer>[] = [];
	const descriptor = { schemaVersion: 1, width, height: 1, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' } as const;
	const request = { schemaVersion: 1, referenceIndex: 0, alignment: 'none', deghost: { mode: 'off', threshold: .15 },
		inputs: [1, .25].map((exposureMultiplier, index) => ({ product: 'lightscaper', ownerId: 'preview-catalog', sourceId: `preview-${index}`, revision: 1,
			original: { fileName: `Input ${index}.dng`, mimeType: 'image/x-adobe-dng', sha256: String(index + 1).repeat(64), byteLength: 1024, width, height: 1 },
			descriptor, exposureMultiplier })), ...(signal ? { signal } : {}) };
	let active = 0, calls = 0;
	const ports = {
		async withCanonicalFrame<Result>(_index: number, consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>): Promise<Result> {
			assert.equal(active, 0); active++; calls++;
			const pixels = Uint16Array.from({ length: width * 4 }, (_, at) => at % 4 === 3 ? 65535 : at % 4 === 0 ? (Math.floor(at / 4) % 4 === 0 ? 65535 : 0) : at % 4 === 1 ? 32768 : 0);
			planes.push(pixels);
			try { return await consume(Object.freeze({ descriptor, pixels })); }
			finally { pixels.fill(0); active--; }
		},
		withStaging: <Result>(consume: Parameters<typeof withImageHdrPixelStagingV1<Result>>[0], options?: Parameters<typeof withImageHdrPixelStagingV1>[1]) =>
			withImageHdrPixelStagingV1(consume, { ...options, backend: storage.backend, acquireLease: storage.acquireLease }),
	};
	return { request, ports, storage, planes, get active() { return active; }, get calls() { return calls; } };
}

test('HDR preview runs authentic merge and codec, then lends only bounded final sRGB after canonical and staged storage retirement', async () => {
	const f = previewFixture(); let borrowed: Uint8Array | undefined;
	const result = await withMergedImageHdrPreviewCurrentV1(f.request, f.ports, view => {
		assert.equal(f.active, 0); assert.equal(f.calls, 2); assert.equal(f.storage.files.size, 0); assert.equal(f.storage.leases.size, 0);
		assert.ok(f.planes.every(plane => plane.every(value => value === 0)));
		assert.deepEqual(view.descriptor, { schemaVersion: 1, width: 3, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' });
		assert.equal(view.frame.descriptor.sampleFormat, 'unorm8'); assert.equal(view.frame.descriptor.transfer, 'srgb');
		assert.ok(view.frame.pixels instanceof Uint8Array); borrowed = view.frame.pixels;
		// Equal green captured codes with multipliers1 and1/4 have radiance
		// (32768+131072)/(2*65535)>1. Only final presentation clips it.
		assert.deepEqual([...borrowed], [255, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]);
		assert.equal(view.diagnostics.motionPixels, 0); return 'observed';
	});
	assert.equal(result, 'observed'); assert.ok(borrowed?.every(value => value === 0));
});

test('HDR preview uses established nearest fitted presentation without enlarging or retaining a full display plane', async () => {
	const f = previewFixture(4096);
	await withMergedImageHdrPreviewCurrentV1(f.request, f.ports, view => {
		assert.equal(view.descriptor.width, 4096); assert.equal(view.frame.descriptor.width, 2048); assert.equal(view.frame.descriptor.height, 1);
		assert.equal(view.frame.pixels.byteLength, 2048 * 4); assert.equal(view.frame.pixels.buffer.byteLength, 2048 * 4);
		for (let x = 0; x < 2048; x++) assert.equal(view.frame.pixels[x * 4], x % 2 === 0 ? 255 : 0);
	});
	assert.equal(f.storage.files.size, 0);
});

test('HDR preview cancellation joins its accepted display consumer before wiping the borrowed presentation', async () => {
	const abort = new AbortController(), reason = Object.freeze({ preview: 'cancelled' }), entered = deferred<void>(), release = deferred<void>();
	const f = previewFixture(3, abort.signal); let borrowed: Uint8Array | undefined;
	const operation = withMergedImageHdrPreviewCurrentV1(f.request, f.ports, async view => {
		assert.ok(view.frame.pixels instanceof Uint8Array); borrowed = view.frame.pixels; entered.resolve(); await release.promise;
	});
	const outcome = operation.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	try { await entered.promise; abort.abort(reason); assert.equal(await remainsPending(outcome), true); assert.equal(borrowed?.[0], 255); }
	finally { release.resolve(); }
	const result = await outcome; assert.ok(!result.ok); assert.equal(result.error, reason); assert.ok(borrowed?.every(value => value === 0));
	assert.equal(f.storage.files.size, 0); assert.equal(f.storage.leases.size, 0);
});

test('pre-aborted HDR preview preserves its opaque reason before hostile metadata or source access', async () => {
	const abort = new AbortController(), reason = Object.freeze({ preview: 'before admission' }); abort.abort(reason); const f = previewFixture();
	const request = { signal: abort.signal, get inputs() { assert.fail('Preview read inputs after pre-abort.'); return []; } };
	await assert.rejects(withMergedImageHdrPreviewCurrentV1(request, f.ports, () => assert.fail('Pre-abort reached display.')), (error: unknown) => error === reason);
	assert.equal(f.calls, 0); assert.equal(f.storage.files.size, 0);
});
