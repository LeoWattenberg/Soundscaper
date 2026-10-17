/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import React, { act } from 'react';
import PhotoDevelopRawDevelopmentDialogCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopRawDevelopmentDialogCurrentV1.tsx';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { ImageDevelopStateThroughV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import type { PhotoLibraryDevelopOriginalCapabilityCurrentV1 } from '../src/common/editor/photo-library-develop-port-current-v1.ts';
import type { PhotoLibraryDevelopOriginalPortCurrentV1 } from '../src/common/editor/photo-library-develop-original-current-v1.ts';
import { withDecodedRawRecoveryFrameV2 } from '../src/common/editor/raw/libraw-runtime-v2.ts';
import { compilePinnedLibRawRecoveryModuleV2 } from '../src/common/editor/raw/libraw-runtime-asset-v2.ts';
import { rawRecoveryWorkerFixtureV2 } from './helpers/lightscaper-raw-recovery-worker-current-fixture.ts';
import { rawRecoveryDngFixtureV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';

let module: WebAssembly.Module;
test.before(async () => {
	const bytes = new Uint8Array(await readFile(new URL('../runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm', import.meta.url)));
	try { module = await compilePinnedLibRawRecoveryModuleV2(bytes); } finally { bytes.fill(0); }
});
function disabled(node: Parameters<typeof reactProps>[0]): boolean {
	const value: unknown = Object.getOwnPropertyDescriptor(reactProps(node), 'disabled')?.value;
	assert.equal(typeof value, 'boolean'); assert.equal(node.hasAttribute('disabled'), value);
	return value === true;
}

async function nativeDialog() {
	const workers = await rawRecoveryWorkerFixtureV2(), bytes = rawRecoveryDngFixtureV1().bytes;
	const applied: Readonly<ImageDevelopStateThroughV4>[] = [], planes: Float32Array[] = [], entered = deferred<void>(), release = deferred<void>();
	const retirements = new Set<() => Promise<void>>(); let closes = 0, holding = true, current = true;
	let develop: Readonly<ImageDevelopStateThroughV4> = defaultImageDevelopStateV2();
	const original: PhotoLibraryDevelopOriginalPortCurrentV1 = { async withFrame() { throw new Error('No byte/canonical frame can prove selected RAW processing.'); },
		withDerivedFrame(request, consume, options) {
			return withDecodedRawRecoveryFrameV2({ bytes, profile: request.profile, ...(options?.signal ? { signal: options.signal } : {}) }, async view => {
				planes.push(view.frame.pixels); const result = await consume({ ...view, photoId: request.photoId, revision: request.expectedRevision });
				if (holding) { holding = false; entered.resolve(); await release.promise; } return result;
			}, { loadModule: async () => module, createWorker: workers.createWorker });
		} };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopRawDevelopmentDialogCurrentV1 photoId="photo" revision={7} develop={develop}
		original={original} locale="en" isCurrent={() => current} onApply={value => { applied.push(value); }} onClose={() => { closes++; }}
		registerRetirement={retire => { retirements.add(retire); return () => { retirements.delete(retire); }; }} />);
	const button = (name: string) => { const node = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(node, name); return node; };
	const choose = async (mode: string) => { await act(async () => { reactProps(mounted.dom.one('select')).onChange?.({ currentTarget: { value: mode } }); await settle(); }); };
	const click = async (name: string) => { await act(async () => { reactProps(button(name)).onClick?.({}); await settle(); }); };
	const ready = async () => { await waitFor(async () => { await act(async () => { await settle(); }); return !disabled(button('Apply')); }, 'joined RAW mode proof'); };
	return { ...mounted, original, applied, planes, workers, entered, release, retirements, button, choose, click, ready, closes: () => closes,
		stale() { current = false; }, async replace() { develop = structuredClone(defaultImageDevelopStateV2()); await mounted.render(); },
		async dispose() { release.resolve(); await mounted.dispose(); await Promise.allSettled([...retirements].map(retire => retire())); await workers.close(); },
	};
}

for (const locale of ['en', 'de']) test(`RAW source mode dialog ${locale} keeps canonical changes explicit and refuses unavailable recovery`, async () => {
	const applied: Readonly<ImageDevelopStateThroughV4>[] = []; let closes = 0, reads = 0;
	const original: PhotoLibraryDevelopOriginalCapabilityCurrentV1 = { async withFrame() { reads++; throw new Error('No canonical decode is needed.'); } };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopRawDevelopmentDialogCurrentV1 photoId="photo" revision={7}
		develop={defaultImageDevelopStateV2()} original={original} locale={locale} isCurrent={() => true}
		onApply={value => { applied.push(value); }} onClose={() => { closes++; }} registerRetirement={() => () => undefined} />);
	const button = (name: string) => { const node = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(node, name); return node; };
	try {
		assert.equal(applied.length, 0); assert.equal(reads, 0);
		await act(async () => { reactProps(button(locale === 'de' ? 'Anwenden' : 'Apply')).onClick?.({}); await settle(); });
		assert.deepEqual(applied, [defaultImageDevelopStateV2()]);
		const select = mounted.dom.one('select');
		await act(async () => { reactProps(select).onChange?.({ currentTarget: { value: 'recovery' } }); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.find('[role="alert"]') !== null; }, 'unavailable RAW recovery authoring');
		assert.equal(disabled(button(locale === 'de' ? 'Anwenden' : 'Apply')), true); assert.equal(applied.length, 1); assert.equal(reads, 0);
		await act(async () => { reactProps(button(locale === 'de' ? 'Schließen' : 'Close')).onClick?.({}); await settle(); });
		assert.equal(closes, 1);
	} finally { await mounted.dispose(); }
});

test('RAW mode choices join cancelled native proof before canonical becomes ready and never auto-apply', async () => {
	const f = await nativeDialog();
	try {
		await f.choose('recovery'); await f.entered.promise; assert.equal(disabled(f.button('Apply')), true);
		await f.choose('canonical'); assert.equal(disabled(f.button('Apply')), true); assert.equal(f.workers.statistics.created, 1);
		assert.ok(f.planes[0]?.some(value => value !== 0)); assert.equal(f.applied.length, 0);
		f.release.resolve(); await f.ready(); assert.ok(f.planes.every(plane => plane.every(value => value === 0)));
		await f.click('Apply'); assert.deepEqual(f.applied, [defaultImageDevelopStateV2()]); assert.equal(f.workers.statistics.created, 1);
	} finally { await f.dispose(); }
});

test('RAW recovery Apply is enabled only after genuine native proof and output retirement', async () => {
	const f = await nativeDialog();
	try {
		await f.choose('recovery'); await f.entered.promise; assert.equal(disabled(f.button('Apply')), true); assert.equal(f.applied.length, 0);
		f.release.resolve(); await f.ready(); assert.ok(f.planes.every(plane => plane.every(value => value === 0)));
		await f.click('Apply'); assert.equal(f.applied[0]?.processVersion, 4);
		if (f.applied[0]?.processVersion !== 4) assert.fail('A proven source mode must retain state4.');
		assert.equal(f.applied[0].rawDevelopment.mode, 'recovery'); assert.equal(f.workers.active(), 0);
	} finally { await f.dispose(); }
});

test('Close joins held RAW proof; stale source state still leaves Close usable', async () => {
	const f = await nativeDialog();
	try {
		await f.choose('headroom'); await f.entered.promise; f.stale(); await f.click('Close');
		assert.equal(f.closes(), 0); assert.equal(f.applied.length, 0); assert.ok(f.planes[0]?.some(value => value !== 0));
		const joined = [...f.retirements][0]!(); assert.equal(await remainsPending(joined), true);
		f.release.resolve(); await joined;
		await waitFor(async () => { await act(async () => { await settle(); }); return f.closes() === 1; }, 'joined RAW source Close');
		assert.ok(f.planes.every(plane => plane.every(value => value === 0))); assert.equal(f.applied.length, 0);
	} finally { await f.dispose(); }
});

test('a replacement generation waits for old native retirement and refuses the old Apply event', async () => {
	const f = await nativeDialog();
	try {
		const staleApply = reactProps(f.button('Apply')).onClick!;
		await f.choose('recovery'); await f.entered.promise; await f.replace();
		await act(async () => { staleApply({}); await settle(); }); assert.equal(f.applied.length, 0);
		assert.equal(disabled(f.button('Apply')), true); await f.click('Apply'); assert.equal(f.applied.length, 0); assert.ok(f.planes[0]?.some(value => value !== 0));
		f.release.resolve(); await f.ready();
		assert.equal(f.applied.length, 0); await f.click('Apply');
		assert.deepEqual(f.applied, [defaultImageDevelopStateV2()]); assert.ok(f.planes.every(plane => plane.every(value => value === 0)));
	} finally { await f.dispose(); }
});

test('StrictMode replay replaces a retired scalar generation and leaves canonical Apply available', async () => {
	const develop = defaultImageDevelopStateV2(), applied: Readonly<ImageDevelopStateThroughV4>[] = [];
	const original: PhotoLibraryDevelopOriginalCapabilityCurrentV1 = { async withFrame() { throw new Error('Canonical metadata must not borrow pixels.'); } };
	const mounted = await mountPhotoImportUi(() => <React.StrictMode><PhotoDevelopRawDevelopmentDialogCurrentV1 photoId="photo" revision={7}
		develop={develop} original={original} locale="en" isCurrent={() => true} onApply={value => { applied.push(value); }} onClose={() => undefined} /></React.StrictMode>);
	try {
		const apply = () => { const node = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === 'Apply'); assert.ok(node); return node; };
		await waitFor(async () => { await act(async () => { await settle(); }); return !disabled(apply()); }, 'StrictMode replacement generation');
		await act(async () => { reactProps(apply()).onClick?.({}); await settle(); });
		assert.deepEqual(applied, [develop]);
	} finally { await mounted.dispose(); }
});

test('Close preserves an independent opaque native retirement outcome while dismissing after its join', async () => {
	const entered = deferred<void>(), release = deferred<void>(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	const cleanup = new Error('Native retirement failed.'), failure = new AggregateError([opaque.proxy, cleanup], 'Independent native outcomes.', { cause: opaque.proxy });
	let closes = 0, retire: (() => Promise<void>) | undefined;
	// This held failure models only the UI lifecycle boundary, not native pixels.
	const original: PhotoLibraryDevelopOriginalPortCurrentV1 = { async withFrame() { throw new Error('Unused canonical reader.'); },
		async withDerivedFrame() { entered.resolve(); await release.promise; throw failure; } };
	const develop = defaultImageDevelopStateV2();
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopRawDevelopmentDialogCurrentV1 photoId="photo" revision={7}
		develop={develop} original={original} locale="en" isCurrent={() => true} onApply={() => { assert.fail('Failed source must not apply.'); }}
		onClose={() => { closes++; }} registerRetirement={value => { retire = value; return () => undefined; }} />);
	try {
		await act(async () => { reactProps(mounted.dom.one('select')).onChange?.({ currentTarget: { value: 'recovery' } }); await settle(); });
		await entered.promise;
		const close = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === 'Close'); assert.ok(close);
		await act(async () => { reactProps(close).onClick?.({}); await settle(); }); assert.equal(closes, 0); assert.ok(retire);
		const joined = retire(), observed = joined.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		assert.equal(await remainsPending(joined), true);
		let result: Awaited<typeof observed> | undefined;
		await act(async () => { release.resolve(); result = await observed; await settle(); });
		assert.ok(result && !result.ok); assert.equal(result.error, failure); assert.ok(Object.is(failure.errors[0], opaque.proxy)); assert.equal(failure.errors[1], cleanup);
		await waitFor(async () => { await act(async () => { await settle(); }); return closes === 1; }, 'failed but joined RAW dialog Close');
		assert.ok(mounted.dom.find('[role="alert"]'));
	} finally { release.resolve(); await mounted.dispose(); }
});
