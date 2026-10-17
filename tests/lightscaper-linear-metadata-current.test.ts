/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLinearDevelopMetadataCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { prepareLinearDevelopCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-plan-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { normalizeCubeLutProfileEffectV1 } from '../src/common/editor/video-cube-lut-profile-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { LUT } from './helpers/framescaper-editable-image-current-fixture.ts';

const DESCRIPTOR = Object.freeze({ schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'unorm16' as const, primaries: 'srgb' as const, transfer: 'linear' as const });
function frame(width = 1, height = 1) { return { descriptor: { ...DESCRIPTOR, width, height }, get pixels(): never { return assert.fail('Metadata preparation must never inspect source pixels.'); } }; }
const BASE = defaultImageDevelopStateV2();
const NO_BODY = Object.freeze({ async withBytes<Result>(): Promise<Result> { assert.fail('Metadata preparation must never read a resource body.'); } });
const PORTS = Object.freeze({ source: NO_BODY, maskSource: NO_BODY });
function compare(value: unknown) {
	const scalar = prepareLinearDevelopMetadataCurrentV1(value, PROFILE, PORTS), native = prepareLinearDevelopCurrentV1(value, PROFILE, PORTS);
	assert.equal(scalar.peakWorkingBytes, native.peakWorkingBytes); assert.deepEqual(scalar.descriptor, native.descriptor);
	assert.deepEqual(scalar.masks, native.masks); assert.deepEqual(scalar.sourcePlan, native.sourcePlan);
	let final = native.descriptor; for (const stage of native.stages) if (stage.kind === 'geometry') final = stage.plan.descriptor;
	assert.deepEqual(scalar.finalDescriptor, final); return scalar;
}

test('Current scalar/native plans share independent exact empty, identity geometry and masked-stage costs without touching pixels', () => {
	assert.equal(compare({ frame: frame(), develop: BASE }).peakWorkingBytes, 32);
	const identity = createVideoEffect('develop-geometry-v1', { id: 'identity', params: {} });
	assert.equal(compare({ frame: frame(), develop: { ...BASE, effects: [identity] } }).peakWorkingBytes, 40);
	const develop = normalizeImageDevelopStateCurrentV1({ ...BASE,
		effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', enabled: false })],
		masks: [{ schemaVersion: 2, id: 'mask', name: 'Named local mask', kind: 'matte', inputs: [], nodes: [{ id: 'ramp', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'ramp' }],
		maskBindings: [{ maskId: 'mask', effectId: 'tone' }] });
	const masked = compare({ frame: frame(), develop, maskOverlay: { maskId: 'mask', effectId: 'tone' } });
	assert.equal(masked.peakWorkingBytes, 40 + masked.masks.peakWorkingBytes);
});

test('scalar/native phase costs remain exact across every color/spatial family, neutral/disabled controls and ordered geometry', () => {
	const families = ['white-balance-v1', 'tone-ladder-v1', 'chroma-v1', 'black-white-mix-v1', 'hsl-mixer-v1', 'point-curves-v1', 'parametric-curves-v1',
		'color-wheels-v1', 'post-crop-vignette-v1', 'clarity-v1', 'noise-reduction-v1', 'grain-v1', 'texture-v1', 'dehaze-v1', 'detail-sharpen-v1'];
	for (const [index, type] of families.entries()) for (const enabled of [true, false]) {
		const effect = createVideoEffect(type, { id: `effect-${String(index)}`, enabled });
		compare({ frame: frame(8, 6), develop: { ...BASE, effects: [effect] } });
	}
	const geometry = normalizeImageDevelopStateCurrentV1({ ...BASE, geometry: { ...BASE.geometry, crop: { x: .25, y: 0, width: .5, height: 1 }, flipHorizontal: true },
		effects: [createVideoEffect('clarity-v1', { id: 'clarity', params: { amount: 50 } }), createVideoEffect('develop-geometry-v1', { id: 'rotate', params: { rotationDegrees: 90 } }),
			createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })] });
	const planned = compare({ frame: { descriptor: { ...DESCRIPTOR, width: 8, height: 6 } }, develop: geometry });
	assert.deepEqual([planned.finalDescriptor.width, planned.finalDescriptor.height], [6, 4]);
});

test('Current scalar plan preserves exact LUT parser reserve and native repair scratch while executable identities remain separate', () => {
	const lut = normalizeCubeLutProfileEffectV1({ id: 'profile', type: 'cube-lut-profile-v1', enabled: true, params: { lut: LUT } });
	assert.equal(compare({ frame: frame(), develop: { ...BASE, effects: [lut] } }).peakWorkingBytes, 40 + 128 * 1024 * 1024 + 2 * LUT.byteLength);
	assert.equal(compare({ frame: frame(), develop: { ...BASE, effects: [{ ...lut, enabled: false }] } }).peakWorkingBytes, 32);
	for (const mode of ['clone', 'heal'] as const) for (const enabled of [true, false]) {
		const develop = normalizeImageDevelopStateCurrentV1({ ...BASE, processVersion: 3, repairs: { schemaVersion: 1, spots: [{ id: 'repair', mode, enabled,
			target: { x: .75, y: .5 }, source: { x: .25, y: .5 }, radius: .1, feather: .5, opacity: 1 }] } });
		compare({ frame: { descriptor: { ...DESCRIPTOR, width: 8, height: 6 } }, develop });
	}
});

test('scalar brush declarations/overlay suffix use the same body-free graph plan and malformed recipes refuse before source pixels', async () => {
	await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, body => {
		const develop = normalizeImageDevelopStateCurrentV1({ ...BASE, effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } }),
			createVideoEffect('develop-geometry-v1', { id: 'mirror', params: { flipHorizontal: 1 } })], masks: [{ schemaVersion: 2, id: 'paint', name: 'Paint', kind: 'matte',
				inputs: [{ name: 'alpha', kind: 'alpha', sourceRef: body.reference.storageKey }], nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'alpha' }], outputNodeId: 'alpha' }], maskBindings: [{ maskId: 'paint', effectId: 'tone' }] });
		const planned = compare({ frame: { descriptor: { ...DESCRIPTOR, width: 2 } }, develop, maskOverlay: { maskId: 'paint', effectId: 'tone' } });
		assert.deepEqual(planned.masks.references, [body.reference]);
	});
	const effect = createVideoEffect('tone-ladder-v1', { id: 'same' });
	assert.throws(() => prepareLinearDevelopMetadataCurrentV1({ frame: frame(), develop: { ...BASE, effects: [effect, effect] } }, PROFILE, PORTS));
	assert.throws(() => prepareLinearDevelopMetadataCurrentV1({ frame: frame(), develop: { ...BASE, effects: [{ id: 'bad', type: 'unsupported', enabled: false, params: {} }] } }, PROFILE, PORTS));
	assert.throws(() => prepareLinearDevelopMetadataCurrentV1({ frame: frame(), develop: { ...BASE, effects: [createVideoEffect('gaussian-blur', { enabled: false })] } }, PROFILE, PORTS), /Unsupported linear color/u);
});
