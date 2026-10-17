/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { prepareFramescaperRawImageOriginalCurrentV1 } from '../../common/editor/timeline-image-raw-original-plan-current-v1.ts';
import { prepareLinearDevelopMetadataCurrentV1 } from '../../common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../common/editor/photo-library-develop-linear-port-v1.ts';
import { normalizeImageDevelopStateThroughV4 } from '../../common/editor/imaging/image-develop-state-v4.ts';
import { prepareImageDevelopAuthoringCurrentV1 } from '../../common/editor/imaging/image-develop-authoring-current-v1.ts';
import { prepareFramescaperRawImageEncodedCurrentV1 } from '../../common/editor/timeline-image-raw-encoded-plan-current-v1.ts';
import { framescaperImagePackSourceCurrentV1 } from '../../common/editor/timeline-image-pack-source-current-v1.ts';
import { IMAGE_DEVELOP_REPAIR_LIMITS_V1 } from '../../common/editor/imaging/image-develop-repair-spots-v1.ts';

export const FRAMESCAPER_RAW_IMAGE_WORKING_BYTES_CURRENT_V1 = 1024 * 1024 * 1024;
export const FRAMESCAPER_RAW_IMAGE_AUTHORING_BYTES_CURRENT_V1 = 64 * 1024 * 1024;
const RESERVE = 32n * 1024n * 1024n;
/** Preparation-only capabilities. Their executable plans never escape this
 * scalar calculation. Actual rendering separately captures genuine native body
 * readers and authenticates every declaration; these ports perform no I/O. */
const METADATA_ONLY = Object.freeze({ async withBytes<Result>(): Promise<Result> {
	throw new TypeError('A metadata-only Frame RAW plan cannot borrow a resource body.');
} });

export interface FramescaperRawImageWorkingOptionsCurrentV1 {
	readonly develop?: unknown;
	readonly maskOverlay?: unknown;
	readonly authoringBytes?: number;
	readonly temporaryBodyBytes?: number;
}

/** Phasewise aggregate includes the conservative three-pack retention, actual
 * decoder maximum, native Original, at most two Float32 stage planes, resources,
 * final RGBA8 presentation/host copy and optional retained authoring work.
 * Worker retirement precedes the render phase; those peaks are never summed. */
export function prepareFramescaperRawImageWorkingCurrentV1(value: unknown,
	optionsValue: FramescaperRawImageWorkingOptionsCurrentV1 = {}) {
	const raw = prepareFramescaperRawImageOriginalCurrentV1(value), options = record(optionsValue, 'Frame RAW working options',
		['develop', 'maskOverlay', 'authoringBytes', 'temporaryBodyBytes'], []);
	const develop = Object.hasOwn(options, 'develop') ? normalizeImageDevelopStateThroughV4(field(options, 'develop', 'Frame RAW working options')) : raw.source.develop;
	const source = raw.source, derived = develop.processVersion === 4 && develop.rawDevelopment.mode !== 'canonical';
	if (derived && (source.raw.descriptor.width < 16 || source.raw.descriptor.height < 16)) throw new RangeError('Frame RAW recovery requires at least sixteen pixels per side.');
	const encoded = derived ? prepareFramescaperRawImageEncodedCurrentV1({ pack: framescaperImagePackSourceCurrentV1(source), raw: source.raw }) : undefined;
	const inputDescriptor = derived ? { ...source.raw.descriptor, sampleFormat: 'float32' as const } : source.raw.descriptor;
	// This is scalar planning only. Actual execution retains the complete saved
	// recipe and independently requires its active native source authority.
	const prepared = prepareLinearDevelopMetadataCurrentV1({ frame: { descriptor: inputDescriptor }, develop: prepareImageDevelopAuthoringCurrentV1(develop),
		...(Object.hasOwn(options, 'maskOverlay') ? { maskOverlay: field(options, 'maskOverlay', 'Frame RAW working options') } : {}) },
		PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source: METADATA_ONLY, maskSource: METADATA_ONLY });
	const authoringBytes = bounded(options, 'authoringBytes', FRAMESCAPER_RAW_IMAGE_AUTHORING_BYTES_CURRENT_V1);
	const temporaryBodyBytes = bounded(options, 'temporaryBodyBytes', 16 * 1024 * 1024);
	const descriptor = prepared.finalDescriptor;
	const packBytes = BigInt(source.assetByteLength), originalBytes = BigInt(raw.originalBytes), frameBytes = BigInt(derived ? raw.frameBytes * 2 : raw.frameBytes);
	const extras = BigInt(authoringBytes) + BigInt(temporaryBodyBytes) * 3n;
	const finalFloat = BigInt(descriptor.width) * BigInt(descriptor.height) * 16n, displayBytes = finalFloat / 4n;
	const decode = (encoded?.decodeWorkingBytes ?? raw.decodeWorkingBytes) + extras;
	const render = originalBytes + BigInt(prepared.peakWorkingBytes) + extras + RESERVE;
	const display = originalBytes + frameBytes + finalFloat + BigInt(prepared.masks.peakWorkingBytes) + displayBytes * 2n + extras + RESERVE;
	// Repair Apply can borrow the same canonical Original with a later local
	// recipe. Reserve its established serial scratch ceiling before that borrow.
	const repair = authoringBytes ? originalBytes + frameBytes + BigInt(source.canonical.width) * BigInt(source.canonical.height) * 32n
		+ BigInt(IMAGE_DEVELOP_REPAIR_LIMITS_V1.maximumScratchBytes) + extras + RESERVE : 0n;
	const working = maximum(decode, render, display, repair), peakWorkingBytes = packBytes * 3n + working;
	if (peakWorkingBytes > BigInt(FRAMESCAPER_RAW_IMAGE_WORKING_BYTES_CURRENT_V1)) throw new RangeError('Frame RAW image exceeds its 1 GiB working byte bound.');
	return Object.freeze({ maximumWorkingBytes: FRAMESCAPER_RAW_IMAGE_WORKING_BYTES_CURRENT_V1,
		decodePeakBytes: packBytes * 3n + decode, renderPeakBytes: packBytes * 3n + maximum(render, display, repair), peakWorkingBytes,
		// Execution's resident snapshots + one reading snapshot already charge2P.
		recipeWorkingBytes: packBytes + working, descriptor });
}
function bounded(input: Readonly<Record<string, unknown>>, key: string, maximum: number): number {
	if (!Object.hasOwn(input, key)) return 0;
	const value = field(input, key, 'Frame RAW working options');
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError('Frame RAW retained work exceeds its scalar byte bound.');
	return value;
}
function maximum(...values: readonly bigint[]): bigint { return values.reduce((a, b) => a > b ? a : b, 0n); }
