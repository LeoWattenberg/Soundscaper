/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { prepareFramescaperHdrImageOriginalCurrentV1 } from '../../common/editor/timeline-image-model-hdr-current-v1.ts';
import { prepareLinearDevelopMetadataCurrentV1 } from '../../common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { normalizeImageDevelopStateThroughV4 } from '../../common/editor/imaging/image-develop-state-v4.ts';
import { prepareImageDevelopAuthoringCurrentV1 } from '../../common/editor/imaging/image-develop-authoring-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../common/editor/photo-library-develop-linear-port-v1.ts';
import { IMAGE_DEVELOP_REPAIR_LIMITS_V1 } from '../../common/editor/imaging/image-develop-repair-spots-v1.ts';

const RESERVE = 32n * 1024n * 1024n;
const MAXIMUM_WORKING_BYTES = 1024 * 1024 * 1024;
const METADATA_ONLY = Object.freeze({ async withBytes<Result>(): Promise<Result> { throw new TypeError('Metadata-only HDR planning cannot read resource bodies.'); } });
export interface FramescaperHdrImageWorkingOptionsCurrentV1 {
	readonly develop?: unknown; readonly maskOverlay?: unknown; readonly authoringBytes?: number; readonly temporaryBodyBytes?: number;
}
/** Three conservative resident pack backings are shared by separate decode,
 * native Develop and display phases. Encoded decode snapshots retire before
 * Float32 is lent, so no decoder working set overlaps downstream rendering. */
export function prepareFramescaperHdrImageWorkingCurrentV1(value: unknown, optionsValue: FramescaperHdrImageWorkingOptionsCurrentV1 = {}) {
	const hdr = prepareFramescaperHdrImageOriginalCurrentV1(value), options = record(optionsValue, 'Frame HDR working options',
		['develop', 'maskOverlay', 'authoringBytes', 'temporaryBodyBytes'], []);
	const source = hdr.source, develop = Object.hasOwn(options, 'develop') ? normalizeImageDevelopStateThroughV4(field(options, 'develop', 'Frame HDR working options')) : source.develop;
	if (develop.processVersion === 4 && develop.rawDevelopment.mode !== 'canonical') throw new RangeError('Generated HDR cannot select a RAW decoder profile.');
	const prepared = prepareLinearDevelopMetadataCurrentV1({ frame: { descriptor: source.hdr.descriptor }, develop: prepareImageDevelopAuthoringCurrentV1(develop),
		...(Object.hasOwn(options, 'maskOverlay') ? { maskOverlay: field(options, 'maskOverlay', 'Frame HDR working options') } : {}) },
		PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source: METADATA_ONLY, maskSource: METADATA_ONLY });
	const authoring = bounded(options, 'authoringBytes', 64 * 1024 * 1024), temporary = bounded(options, 'temporaryBodyBytes', 16 * 1024 * 1024);
	const extras = BigInt(authoring) + BigInt(temporary) * 3n, pack = BigInt(source.assetByteLength), frame = BigInt(hdr.frameBytes);
	const descriptor = prepared.finalDescriptor, output = BigInt(descriptor.width) * BigInt(descriptor.height) * 16n, display = output / 4n;
	const decode = hdr.decodeWorkingBytes + extras;
	const render = BigInt(prepared.peakWorkingBytes) + extras + RESERVE;
	const presentation = frame + output + BigInt(prepared.masks.peakWorkingBytes) + display * 2n + extras + RESERVE;
	const repair = authoring ? frame * 3n + BigInt(IMAGE_DEVELOP_REPAIR_LIMITS_V1.maximumScratchBytes) + extras + RESERVE : 0n;
	const working = maximum(decode, render, presentation, repair), peakWorkingBytes = pack * 3n + working;
	if (peakWorkingBytes > BigInt(MAXIMUM_WORKING_BYTES)) throw new RangeError('Frame HDR image exceeds its 1 GiB working byte bound.');
	return Object.freeze({ maximumWorkingBytes: MAXIMUM_WORKING_BYTES, descriptor,
		decodePeakBytes: pack * 3n + decode, renderPeakBytes: pack * 3n + maximum(render, presentation, repair), peakWorkingBytes, recipeWorkingBytes: pack + working });
}
function bounded(input: Readonly<Record<string, unknown>>, key: string, maximum: number): number {
	if (!Object.hasOwn(input, key)) return 0;
	const value = field(input, key, 'Frame HDR working options');
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError('Frame HDR retained work exceeds its byte bound.');
	return value;
}
function maximum(...values: readonly bigint[]): bigint { return values.reduce((left, right) => left > right ? left : right, 0n); }
