/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeFramescaperImageSourceCurrentV1 } from '../../common/editor/timeline-image-model-current-v1.ts';
import { framescaperImagePackSourceCurrentV1 } from '../../common/editor/timeline-image-pack-source-current-v1.ts';
import { prepareFramescaperRawImageOriginalCurrentV1 } from '../../common/editor/timeline-image-raw-original-plan-current-v1.ts';
import type { PixelFrameDescriptorV1, PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { readCanonicalSafeVisualText } from '../../common/editor/safe-visual-text.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import type { FramescaperStoredImageAssetStoreTimelineImage } from '../editor-selected-timeline-image-image-frame-source.ts';
import { openFramescaperNativePackOwnerCurrentV1, retireFramescaperNativeImageCurrentV1 } from './timeline-image-native-pack-owner-current-v1.ts';

const MiB = 1024n * 1024n, MAXIMUM = 1024n * MiB;
const PLANS = new WeakSet<object>();

export function prepareFramescaperHdrMergeResultNameCurrentV1(value: unknown): string {
	const name = readCanonicalSafeVisualText(value, 'HDR result filename', 512, false);
	if (!name.toLowerCase().endsWith('.lshdr') || /[\\/]/u.test(name)) throw new TypeError('HDR result requires a safe .lshdr filename.'); return name;
}

/** Canonical-only planning deliberately has no creative Develop, LUT, brush,
 * recovery or output-geometry execution/admission edge. Full Source/receipt
 * metadata is still normalized before any native media read. */
export function prepareFramescaperHdrMergeCanonicalSourceCurrentV1(value: unknown) {
	const source = normalizeFramescaperImageSourceCurrentV1(value);
	if (source.schemaVersion === 5) throw new RangeError('Generated HDR Source5 cannot be a canonical HDR bracket input.');
	if (source.canonical.frameCount !== 1 || source.canonical.hasAlpha || source.original.byteLength > 64 * 1024 * 1024) {
		throw new RangeError('HDR requires bounded opaque static canonical Originals.');
	}
	const descriptor: Readonly<PixelFrameDescriptorV1> = Object.freeze(source.schemaVersion === 4 ? { ...source.raw.descriptor }
		: { schemaVersion: 1, width: source.canonical.width, height: source.canonical.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
	const pixels = BigInt(descriptor.width) * BigInt(descriptor.height), frameBytes = pixels * BigInt(source.schemaVersion === 4 ? 8 : 4);
	const packs = BigInt(source.assetByteLength) * 3n;
	if (source.schemaVersion !== 4 && packs + frameBytes + 4096n > 512n * MiB) throw new RangeError('Canonical image frame exceeds its 512 MiB working byte bound.');
	// At most one source pack is open. A full reference guide can remain held
	// during the next decode; guide/alignment work runs after worker retirement.
	const decode = source.schemaVersion === 4 ? prepareFramescaperRawImageOriginalCurrentV1(source).decodeWorkingBytes : frameBytes + 32n * MiB;
	const decodePeakBytes = packs + decode + pixels;
	const stagePeakBytes = packs + frameBytes + pixels * 2n + 130n * MiB;
	if (decodePeakBytes > MAXIMUM || stagePeakBytes > MAXIMUM) throw new RangeError('Frame HDR canonical source exceeds its 1 GiB phase budget.');
	const plan = Object.freeze({ source, descriptor, decodePeakBytes, stagePeakBytes }); PLANS.add(plan); return plan;
}
export type FramescaperHdrMergeCanonicalPlanCurrentV1 = ReturnType<typeof prepareFramescaperHdrMergeCanonicalSourceCurrentV1>;

/** Actual authenticated byte/ABI1 word borrow. Each reader is fully joined
 * before another source opens; saved H1/H3 choices and creative resources never
 * become input authority. Source4 always calls its immutable ABI1 owner. */
export async function withFramescaperHdrMergeCanonicalSourceCurrentV1<Result>(plan: FramescaperHdrMergeCanonicalPlanCurrentV1,
	store: FramescaperStoredImageAssetStoreTimelineImage, consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>,
	options: Readonly<{ signal?: AbortSignal; assertCurrent: () => void }>): Promise<Result> {
	const raw = record(options, 'Frame HDR canonical options', ['signal', 'assertCurrent'], ['assertCurrent']);
	const signal = captureRepairSignalV1(Object.hasOwn(raw, 'signal') ? field(raw, 'signal', 'Frame HDR canonical options') : undefined);
	const current = field(raw, 'assertCurrent', 'Frame HDR canonical options');
	if (typeof current !== 'function') throw new TypeError('Frame HDR requires its pinned current-project guard.');
	const check = () => { checkRepairSignalV1(signal); Reflect.apply(current, options, []); };
	check(); if (!PLANS.has(plan) || typeof consume !== 'function') throw new TypeError('HDR requires its owned canonical plan and scoped consumer.');
	const source = plan.source;
	let reader: Awaited<ReturnType<typeof openFramescaperNativePackOwnerCurrentV1>> | undefined;
	let outcome: { value: Result } | { error: unknown };
	try {
		reader = await openFramescaperNativePackOwnerCurrentV1(store, framescaperImagePackSourceCurrentV1(source), signal, undefined,
			source.schemaVersion === 1 ? 'source1' : 'editable', source.schemaVersion === 4 ? 'preview' : 'canonical-authoring'); check();
		const owner = reader;
		const value = source.schemaVersion === 4
			? await owner.run(async admitted => {
				const { withFramescaperRawImageOriginalCurrentV1 } = await import('../../common/editor/timeline-image-raw-pack-current-v1.ts'); check();
				return withFramescaperRawImageOriginalCurrentV1({ source, read: owner.read, assertCurrent: check, ...(admitted ? { signal: admitted } : {}) },
					async view => { check(); const result = await consume(view.frame); check(); return result; });
			}, signal, true)
			: await owner.withCanonicalFrame(async frame => { check(); const result = await consume(frame); check(); return result; }, signal);
		check(); outcome = { value };
	} catch (error) { outcome = { error }; }
	await retireFramescaperNativeImageCurrentV1('error' in outcome ? outcome : undefined, reader ? [() => reader!.closeAndJoin()] : []);
	if ('value' in outcome) return outcome.value; throw outcome.error;
}
