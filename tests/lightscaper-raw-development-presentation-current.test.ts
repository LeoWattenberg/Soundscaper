/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopPresentationCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import type { PhotoDevelopPresentationPortsCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { setImageDevelopRawDevelopmentCurrentV1 } from '../src/common/editor/imaging/image-develop-raw-development-current-v1.ts';
import { withLinearPixelFrameDisplayV1 } from '../src/common/editor/imaging/pixel-frame-linear-display-v1.ts';
import { withPhotoOriginalDerivedFrameCurrentV1 } from '../src/lightscaper/preview/photo-original-derived-frame-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { rawDerivedOriginalFixtureCurrentV1, rawDerivedOriginalNativeCurrentV1 } from './helpers/lightscaper-raw-derived-original-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

async function fixture() {
	const source = rawDerivedOriginalFixtureCurrentV1(6), canonical = await rawDerivedOriginalNativeCurrentV1(), derived = await rawDerivedOriginalNativeCurrentV1();
	const before = {} as HTMLCanvasElement, after = {} as HTMLCanvasElement;
	const calls = { original: 0, derived: 0, preview: 0 }, events: string[] = [], painted = new Map<HTMLCanvasElement, Uint8Array>();
	const expected = { before: new Uint8Array(), after: new Uint8Array() };
	const hooks = { retire: async (): Promise<void> => undefined, wrongProfile: false };
	const ports: PhotoDevelopPresentationPortsCurrentV1 = {
		async withOriginalFrame(request, consume, options) {
			assert.equal(this, ports); assert.equal(request.photoId, source.binding.photoId); calls.original++; events.push('before-start');
			const result = await canonical.ports.withRawFrame!({ bytes: source.bytes, ...(options?.signal ? { signal: options.signal } : {}) }, async view => {
				await withLinearPixelFrameDisplayV1({ frame: view.frame }, encoded => { expected.before = new Uint8Array(encoded.pixels); }, 'full');
				return consume({ photoId: source.binding.photoId, revision: 7, frame: view.frame });
			});
			assert.ok(canonical.words.every(buffer => new Uint8Array(buffer).every(value => value === 0))); events.push('before-retired');
			await hooks.retire(); return result;
		},
		async withDerivedFrame(request, consume, options) {
			assert.equal(this, ports); calls.derived++; assert.ok(events.includes('before-retired')); events.push('after-start');
			assert.equal(canonical.canonical.active(), 0); assert.ok(canonical.words.every(buffer => new Uint8Array(buffer).every(value => value === 0)));
			return withPhotoOriginalDerivedFrameCurrentV1({ binding: source.binding, body: source.body, profile: request.profile,
				...(options?.signal ? { signal: options.signal } : {}) }, async view => {
				await withLinearPixelFrameDisplayV1({ frame: view.frame }, encoded => { expected.after = new Uint8Array(encoded.pixels); }, 'full');
				return consume({ ...view, photoId: source.binding.photoId, revision: 7,
					...(hooks.wrongProfile ? { profile: request.profile === 'linear-headroom-v1' ? 'highlight-recovery-v1' : 'linear-headroom-v1' } : {}) });
			}, derived.ports);
		},
		async readPreview() { calls.preview++; throw new Error('RAW authoring cannot use a culling preview.'); },
		async loadProxy() { assert.equal(this, ports); return createPhotoDevelopRenderRuntimeCurrentV1(); },
		paint(target, frame) { assert.equal(this, ports); painted.set(target, new Uint8Array(frame.pixels));
			return Object.freeze({ byteLength: frame.pixels.byteLength, width: frame.descriptor.width, height: frame.descriptor.height }); },
		clear(target) { assert.equal(this, ports); painted.delete(target); },
	};
	return { ports, source, canonical, derived, calls, events, hooks, painted, expected,
		view(mode: 'headroom' | 'recovery', resolution: 'proxy' | 'full' = 'proxy') {
			return { photoId: source.binding.photoId, revision: 7, before, after, resolution,
				develop: setImageDevelopRawDevelopmentCurrentV1(defaultImageDevelopStateV1(), { schemaVersion: 1, mode }) };
		}, before, after,
		async close() { await Promise.all([canonical.close(), derived.close()]); },
	};
}

test('Current RAW Before remains canonical while After uses the actual selected native profile, sequentially at both resolutions', async () => {
	for (const mode of ['headroom', 'recovery'] as const) for (const resolution of ['proxy', 'full'] as const) {
		const f = await fixture(), owner = new PhotoLibraryDevelopPresentationCurrentV1(f.ports);
		try {
			owner.setView(f.view(mode, resolution)); await owner.drain();
			assert.equal(owner.snapshot().status, 'ready'); assert.deepEqual(f.painted.get(f.before), f.expected.before);
			assert.deepEqual(f.painted.get(f.after), f.expected.after); assert.notDeepEqual(f.expected.before, f.expected.after);
			assert.deepEqual(f.events, ['before-start', 'before-retired', 'after-start']);
			assert.deepEqual(f.calls, { original: 1, derived: 1, preview: 0 });
			assert.deepEqual(owner.snapshot().extent, { before: { width: 96, height: 128 }, after: { width: 96, height: 128 } });
			assert.ok(f.derived.words.every(buffer => new Uint8Array(buffer).every(value => value === 0)));
			assert.ok(f.derived.floats.every(buffer => new Uint8Array(buffer).every(value => value === 0)));
		} finally { await owner.close(); await f.close(); }
	}
});

test('Close joins held canonical Before retirement and prevents the derived read and ready publication', async () => {
	const f = await fixture(), owner = new PhotoLibraryDevelopPresentationCurrentV1(f.ports), entered = deferred<void>(), release = deferred<void>();
	f.hooks.retire = async () => { entered.resolve(); await release.promise; };
	try {
		owner.setView(f.view('recovery'));
		const work = owner.drain(); await Promise.race([entered.promise, work.then(() => assert.fail('Before was not borrowed.'))]);
		const closing = owner.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.calls.derived, 0);
		release.resolve(); await work; await closing; assert.equal(f.calls.derived, 0); assert.equal(f.painted.size, 0);
	} finally { release.resolve(); await owner.close(); await f.close(); }
});

test('Current recovery requires its named derived capability and refuses profile drift without falling back to preview pixels', async () => {
	const missing = await fixture();
	assert.equal(Reflect.deleteProperty(missing.ports, 'withDerivedFrame'), true);
	const first = new PhotoLibraryDevelopPresentationCurrentV1(missing.ports);
	try {
		first.setView(missing.view('recovery')); await first.drain(); assert.equal(first.snapshot().status, 'failed');
		assert.deepEqual(missing.calls, { original: 0, derived: 0, preview: 0 });
	} finally { await first.close(); await missing.close(); }
	const f = await fixture(), owner = new PhotoLibraryDevelopPresentationCurrentV1(f.ports); f.hooks.wrongProfile = true;
	try {
		owner.setView(f.view('headroom')); await owner.drain(); assert.equal(owner.snapshot().status, 'failed');
		assert.equal(f.calls.preview, 0); assert.equal(f.painted.size, 0);
		assert.ok(f.derived.floats.every(buffer => new Uint8Array(buffer).every(value => value === 0)));
	} finally { await owner.close(); await f.close(); }
});
