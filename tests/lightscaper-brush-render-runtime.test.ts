/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { PhotoLibraryDevelopProxyRuntimeV2 } from '../src/common/editor/photo-library-develop-proxy-port-v2.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { maskedDevelop, rgbaFrame, profile } from './helpers/lightscaper-masked-frame-fixture.ts';

test('actual Photo runtime pins explicit brush receiver/options and forwards observed coverage through proxy and full paths', async () => {
	const body = await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: new Uint8Array([0, 255]) }, prepared =>
		({ reference: prepared.reference, bytes: prepared.bytes.slice() }));
	let calls = 0, reflected = 0;
	const port: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, port); assert.deepEqual(reference, body.reference); calls++; return consume(body.bytes);
	} };
	port.withBytes = new Proxy(port.withBytes, { get() { reflected++; throw Error('Brush method metadata reflected'); } });
	const options = { maskSource: port };
	const runtime = Reflect.apply(createPhotoDevelopRenderRuntimeV2, undefined, [options]) as Readonly<PhotoLibraryDevelopProxyRuntimeV2>;
	port.withBytes = () => { throw Error('Mutable brush method replacement used'); };
	options.maskSource = { withBytes() { throw Error('Mutable brush options replacement used'); } };
	const effect = createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
	const graph = { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [{ name: 'paint', kind: 'alpha', sourceRef: body.reference.storageKey }],
		nodes: [{ id: 'painted', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'painted' };
	const develop = normalizeImageDevelopStateV1OrV2(maskedDevelop([effect], graph));
	for (const method of [runtime.withProxy, runtime.withFullResolution]) {
		const frame = rgbaFrame([0, 0, 0, 128, 0, 0, 0, 255]); let pixels: PixelFrameV1['pixels'] | undefined, coverage: Uint8Array | undefined;
		const result = await method({ frame, develop, signal: new AbortController().signal, maskOverlay: { maskId: 'mask', effectId: 'invert' } }, view => {
			assert.ok(view.maskOverlay); pixels = view.frame.pixels; coverage = view.maskOverlay.coverage;
			return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage], width: view.maskOverlay.width, height: view.maskOverlay.height };
		});
		assert.deepEqual(result, { pixels: [0, 0, 0, 128, 255, 255, 255, 255], coverage: [0, 255], width: 2, height: 1 });
		assert.ok(pixels?.every(value => value === 0)); assert.ok(coverage?.every(value => value === 0));
		assert.deepEqual([...frame.pixels], [0, 0, 0, 128, 0, 0, 0, 255]);
	}
	assert.equal(calls, 2); assert.equal(reflected, 0);
});

test('actual runtime keeps disabled bound LUT neutral while authenticating brush and forwarding its requested overlay', async () => {
	const body = await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: new Uint8Array([0, 255]) }, prepared =>
		({ reference: prepared.reference, bytes: prepared.bytes.slice() }));
	let brushReads = 0, lutReads = 0;
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { brushReads++; return consume(body.bytes); } };
	const source = { async withBytes() { lutReads++; throw Error('Disabled LUT body acquired'); } };
	const runtime = Reflect.apply(createPhotoDevelopRenderRuntimeV2, undefined, [{ maskSource, source }]) as Readonly<PhotoLibraryDevelopProxyRuntimeV2>;
	const graph = { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [{ name: 'paint', kind: 'alpha', sourceRef: body.reference.storageKey }],
		nodes: [{ id: 'painted', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'painted' };
	const develop = normalizeImageDevelopStateV1OrV2(maskedDevelop([profile(false)], graph));
	for (const method of [runtime.withProxy, runtime.withFullResolution]) {
		const frame = rgbaFrame([64, 128, 192, 128, 64, 128, 192, 255]);
		const result = await method({ frame, develop, signal: new AbortController().signal, maskOverlay: { maskId: 'mask', effectId: 'profile' } }, view => {
			assert.ok(view.maskOverlay); return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
		});
		assert.deepEqual(result, { pixels: [...frame.pixels], coverage: [0, 255] });
	}
	assert.equal(brushReads, 2); assert.equal(lutReads, 0);
});

test('runtime explicit source options are closed own-data capabilities and request-level substitution remains refused', async () => {
	let getters = 0, bodies = 0;
	const maskSource: MaskRasterSourcePortV1 = { async withBytes() { bodies++; throw Error('Forbidden body acquired'); } };
	const accessor = Object.defineProperty({}, 'maskSource', { enumerable: true, get() { getters++; return maskSource; } });
	const inherited = Object.create({ withBytes: maskSource.withBytes }) as object;
	for (const options of [accessor, { maskSource: inherited }, { maskSource: 1 }, { maskSource, future: true }]) {
		assert.throws(() => Reflect.apply(createPhotoDevelopRenderRuntimeV2, undefined, [options]));
	}
	const actual = createPhotoDevelopRenderRuntimeV2(), frame = rgbaFrame([0, 0, 0, 255]);
	const develop = normalizeImageDevelopStateV1OrV2(maskedDevelop([], { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'neutral', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], outputNodeId: 'neutral' }, []));
	const work = Reflect.apply(actual.withProxy, actual, [{ frame, develop, signal: new AbortController().signal, maskSource }, () => {}]) as Promise<void>;
	await assert.rejects(work); assert.equal(getters, 0); assert.equal(bodies, 0);
});
