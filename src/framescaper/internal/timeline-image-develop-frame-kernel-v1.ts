/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { normalizeFramescaperImageSourceV2, framescaperImageSourceResourceReferencesV2 } from '../../common/editor/timeline-image-model-v2.ts';
import { normalizeFramescaperImageSourceV3, framescaperImageSourceResourceReferencesV3 } from '../../common/editor/timeline-image-model-v3.ts';
import { FRAMESCAPER_IMAGE_MODEL_LIMITS_V1 as LIMITS, type FramescaperImageSourceV1 } from '../../common/editor/timeline-image-model.ts';
import { openFramescaperImageFramePackV1 } from '../../common/editor/timeline-image-frame-pack-v1.ts';
import type { ImageDevelopFrameOptionsV2 } from '../../common/editor/imaging/image-develop-frame-v2.ts';
import { captureCubeLutSourceV1 } from '../../common/editor/imaging/cube-lut-source-scope-v1.ts';
import { normalizeImageDevelopStateV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import { captureMaskRasterSourceV1 } from '../../common/editor/imaging/mask-raster-source-scope-v1.ts';
import { withCubeLutResourceV1 } from '../../common/editor/imaging/cube-lut-resource-v1.ts';
import type { ImageDevelopFrameViewV1 } from '../../common/editor/imaging/image-develop-frame-core.ts';
import { planImageDevelopMasksV1, planAdmittedImageDevelopMasksV1 } from '../../common/editor/imaging/image-develop-mask-plan-v1.ts';
import { admitImageDevelopBrushMaskAuthorityV1 } from '../../common/editor/imaging/image-develop-brush-mask-v1.ts';
import { planImageDevelopRepairSpotsV1 } from '../../common/editor/imaging/image-develop-repair-plan-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted, FILL = Uint8Array.prototype.fill;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const PIXEL_LIMITS = Object.freeze({ maximumSidePixels: LIMITS.maximumDimension, maximumPixels: LIMITS.maximumPixelsPerFrame, maximumBytes: LIMITS.maximumPixelsPerFrame * 4 });
const PROFILE = Object.freeze({ source: PIXEL_LIMITS, render: PIXEL_LIMITS });

/** Fixed profiles share one immutable pack borrow; no editable metadata projection escapes. */
export async function withFramescaperImageDevelopFrameForProfileV1<Result>(profile: 'legacy2' | 'current3', value: unknown,
	consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, optionsValue: ImageDevelopFrameOptionsV2): Promise<Result> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported Frame image execution profile.');
	const input = record(value, 'Frame editable image request', ['source', 'read', 'assertCurrent', 'signal'], ['source', 'read']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'Frame editable image request') : undefined;
	if (signal !== undefined) assertSignal(signal);
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Editable image delivery requires a scoped consumer.');
	const source = profile === 'legacy2' ? normalizeFramescaperImageSourceV2(field(input, 'source', 'Frame editable image request'))
		: normalizeFramescaperImageSourceV3(field(input, 'source', 'Frame editable image request'));
	const computation = source.develop.processVersion === 3 ? normalizeImageDevelopStateV2({ processVersion: 2,
		effects: source.develop.effects, geometry: source.develop.geometry, masks: source.develop.masks, maskBindings: source.develop.maskBindings }) : source.develop;
	if (source.develop.processVersion === 3) planImageDevelopRepairSpotsV1(source.develop.repairs, source.canonical.width, source.canonical.height);
	if (source.schemaVersion === 3) planAdmittedImageDevelopMasksV1(admitImageDevelopBrushMaskAuthorityV1(computation), source.canonical.width, source.canonical.height, PIXEL_LIMITS);
	else planImageDevelopMasksV1(computation, source.canonical.width, source.canonical.height, PIXEL_LIMITS);
	const rawRead = field(input, 'read', 'Frame editable image request');
	if (typeof rawRead !== 'function') throw new TypeError('Editable image requires an authenticated range reader.');
	const rawCurrent = Object.hasOwn(input, 'assertCurrent') ? field(input, 'assertCurrent', 'Frame editable image request') : undefined;
	if (rawCurrent !== undefined && typeof rawCurrent !== 'function') throw new TypeError('Editable image currentness requires a method.');
	const current = async () => { check(); if (rawCurrent) await Reflect.apply(rawCurrent, value, []); check(); };
	const read = (offset: number, length: number) => Reflect.apply(rawRead, value, [offset, length]) as Uint8Array | Promise<Uint8Array>;
	const options = record(optionsValue, 'Frame image resource options', profile === 'legacy2' ? ['source'] : ['source', 'maskSource'], []);
	const references = source.schemaVersion === 2 ? { luts: framescaperImageSourceResourceReferencesV2(source), brushes: [] }
		: framescaperImageSourceResourceReferencesV3(source);
	const lutSource = references.luts.length ? captureCubeLutSourceV1(field(options, 'source', 'Frame image LUT source')) : undefined;
	const maskSource = references.brushes.length ? captureMaskRasterSourceV1(field(options, 'maskSource', 'Frame image brush source')) : undefined;
	const { develop: _develop, developed: _developed, provenance: _provenance, ...packed } = source;
	const packSource: FramescaperImageSourceV1 = { ...packed, schemaVersion: 1 };
	// Capture full metadata and both resource receivers before this optional
	// execution entry can yield. Legacy recipes keep their exact shared V2 path.
	await current();
	const run = profile === 'current3' && source.develop.processVersion === 3
		? (await import('../../common/editor/imaging/image-develop-frame-v3.ts')).withImageDevelopFrameV3
		: (await import('../../common/editor/imaging/image-develop-frame-v2.ts')).withImageDevelopFrameV2;
	await current();
	const pack = await openFramescaperImageFramePackV1({ source: packSource, read, assertCurrent: current, ...(signal === undefined ? {} : { signal }) });
	for (const reference of references.luts) {
		let verified = false;
		await lutSource!.withBytes(reference, bytes => withCubeLutResourceV1({ reference, bytes, ...(signal === undefined ? {} : { signal }) }, () => { verified = true; }), signal === undefined ? undefined : { signal });
		if (!verified) throw new Error('Editable image resource source did not authenticate its declared body.'); await current();
	}
	const pixels = await pack.readFrame(0, signal), backing = pixels.buffer, length = Number(Reflect.apply(SIZE, pixels.buffer, []));
	let outcome: { value: Result } | { error: unknown };
	try {
		await current();
		outcome = { value: await run({ frame: { descriptor: { schemaVersion: 1, width: source.canonical.width, height: source.canonical.height,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels }, develop: source.develop, ...(signal === undefined ? {} : { signal }) }, async view => {
			if (view.frame.descriptor.width !== source.developed.width || view.frame.descriptor.height !== source.developed.height) throw new Error('Editable image natural output differs from its declared dimensions.');
			await current(); const result = await consume(view); await current(); return result;
		}, PROFILE, { ...(lutSource ? { source: lutSource } : {}), ...(maskSource ? { maskSource } : {}) }) };
	} catch (error) { outcome = { error }; }
	let cleanup: { error: unknown } | undefined;
	try {
		// The canonical pack decoder returns an F-byte view over its F+1 guard
		// allocation. Pin the native allocation, not the exposed view geometry.
		const retained = Number(Reflect.apply(SIZE, backing, []));
		if (retained !== 0 && retained !== length) throw new TypeError('Frame Original backing changed before native retirement.');
		if (retained !== 0) Reflect.apply(FILL, new Uint8Array(backing), [0]);
	} catch (error) { cleanup = { error }; }
	if ('error' in outcome) { if (cleanup && !Object.is(outcome.error, cleanup.error)) throw new AggregateError([outcome.error, cleanup.error], 'Frame image execution and Original retirement failed.', { cause: outcome.error }); throw outcome.error; }
	if (cleanup) throw cleanup.error; return outcome.value;
}
function assertSignal(value: unknown): asserts value is AbortSignal {
	if (typeof value !== 'object' || value === null) throw new TypeError('Editable image requires a native cancellation signal.'); Reflect.apply(CHECK, value, []);
	if (Object.getPrototypeOf(value) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value, key))) throw new TypeError('Editable image requires native cancellation behavior without overrides.');
}
