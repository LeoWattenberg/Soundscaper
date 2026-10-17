/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../closed-domain-value.ts';
import { prepareImageHdrMergeV1, type ImageHdrMergePlanV1 } from '../../../imaging/image-hdr-merge-contract-v1.ts';
import { normalizeImageHdrOriginalProvenanceV1, type ImageHdrOriginalProvenanceV1 } from '../../../imaging/image-hdr-original-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../../imaging/pixel-frame-repair-lifetime-v1.ts';
import { withImageHdrPixelStagingV1, type ImageHdrPixelStagingStoreV1 } from '../../../storage/image-hdr-pixel-staging-v1.ts';
import type { PixelFrameV1 } from '../../../imaging/pixel-frame-contract-v1.ts';
import type { ImageHdrMergePortsCurrentV1 } from '../image-hdr-merge-current-v1.ts';

export interface CapturedImageHdrMergeCurrentV1 {
	readonly plan: Readonly<ImageHdrMergePlanV1>;
	readonly facts: Readonly<ImageHdrOriginalProvenanceV1>;
	readonly signal?: AbortSignal;
	readonly withCanonicalFrame: ImageHdrMergePortsCurrentV1['withCanonicalFrame'];
	readonly withStaging: typeof withImageHdrPixelStagingV1;
}

/** Capture full source facts and exact receivers before the first wait. The
 * provisional zero placements validate identities only; execution replaces
 * them with actual registration and intersection before encoding. */
export function captureImageHdrMergeCurrentV1(value: unknown, portsValue: Readonly<ImageHdrMergePortsCurrentV1>): Readonly<CapturedImageHdrMergeCurrentV1> {
	const ownSignal = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('HDR merge signal requires own data.');
	const signal = captureRepairSignalV1(ownSignal?.value), check = () => { checkRepairSignalV1(signal); }; check();
	try {
		const input = record(value, 'HDR creation request', ['schemaVersion', 'referenceIndex', 'alignment', 'deghost', 'inputs', 'signal'],
			['schemaVersion', 'referenceIndex', 'alignment', 'deghost', 'inputs']);
		const sources = array(field(input, 'inputs', 'HDR creation request'), 'HDR creation inputs', 2, 9).map(source =>
			record(source, 'HDR creation input', ['product', 'ownerId', 'sourceId', 'revision', 'original', 'descriptor', 'exposureMultiplier']));
		const plan = prepareImageHdrMergeV1({ schemaVersion: field(input, 'schemaVersion', 'HDR creation request'),
			referenceIndex: field(input, 'referenceIndex', 'HDR creation request'), alignment: field(input, 'alignment', 'HDR creation request'),
			deghost: field(input, 'deghost', 'HDR creation request'), inputs: sources.map(source => ({
				descriptor: field(source, 'descriptor', 'HDR creation input'), exposureMultiplier: field(source, 'exposureMultiplier', 'HDR creation input') })) });
		const facts = normalizeImageHdrOriginalProvenanceV1({ schemaVersion: 1, operation: 'hdr-merge-v1', referenceIndex: plan.referenceIndex,
			alignment: plan.alignment, deghost: plan.deghost, inputs: sources.map((source, index) => ({
				product: field(source, 'product', 'HDR creation input'), ownerId: field(source, 'ownerId', 'HDR creation input'),
				sourceId: field(source, 'sourceId', 'HDR creation input'), revision: field(source, 'revision', 'HDR creation input'),
				original: field(source, 'original', 'HDR creation input'),
				profile: plan.inputs[index]!.descriptor.sampleFormat === 'unorm16' ? 'linear-srgb16' : 'encoded-srgb8',
				exposureMultiplier: plan.inputs[index]!.exposureMultiplier, offset: { x: 0, y: 0 }, alignmentError: 0, alignmentSupport: 0 })),
			output: { x: 0, y: 0, width: plan.width, height: plan.height } });
		if (facts.inputs.some(source => source.original.width !== plan.width || source.original.height !== plan.height)) throw new RangeError('HDR canonical descriptors must match their captured Original extents.');
		const ports = record(portsValue, 'HDR creation ports', ['withCanonicalFrame', 'withStaging'], ['withCanonicalFrame']);
		const read = field(ports, 'withCanonicalFrame', 'HDR creation ports');
		const stage = Object.hasOwn(ports, 'withStaging') ? field(ports, 'withStaging', 'HDR creation ports') : withImageHdrPixelStagingV1;
		if (typeof read !== 'function' || typeof stage !== 'function') throw new TypeError('HDR creation requires inert canonical and staging capabilities.');
		const canonical = read as ImageHdrMergePortsCurrentV1['withCanonicalFrame'];
		const staging = stage as typeof withImageHdrPixelStagingV1;
		check();
		return Object.freeze({ plan, facts, signal,
			withCanonicalFrame: <Result>(index: number, consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, admitted?: AbortSignal) =>
				Reflect.apply(canonical, portsValue, [index, consume, admitted]) as Promise<Result>,
			withStaging: <Result>(consume: (store: Readonly<ImageHdrPixelStagingStoreV1>) => Result | Promise<Result>, options?: Parameters<typeof withImageHdrPixelStagingV1>[1]) =>
				Reflect.apply(staging, portsValue, [consume, options]) as Promise<Result> });
	} catch (error) { check(); throw error; }
}
