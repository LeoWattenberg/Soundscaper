/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { readExactSafeVisualText } from '../safe-visual-text.ts';

import { IMAGE_HDR_ORIGINAL_LIMITS_V1 } from './image-hdr-original-profile-v1.ts';
export { IMAGE_HDR_ORIGINAL_MIME_TYPE_V1, IMAGE_HDR_ORIGINAL_FORMAT_V1, IMAGE_HDR_ORIGINAL_SUFFIX_V1,
	IMAGE_HDR_ORIGINAL_MAGIC_V1, IMAGE_HDR_ORIGINAL_LIMITS_V1 } from './image-hdr-original-profile-v1.ts';

export interface ImageHdrOriginalInputV1 {
	readonly product: 'lightscaper' | 'framescaper';
	readonly ownerId: string;
	readonly sourceId: string;
	readonly revision: number | null;
	readonly original: Readonly<{ fileName: string; mimeType: string | null; sha256: string; byteLength: number; width: number; height: number }>;
	readonly profile: 'encoded-srgb8' | 'linear-srgb16';
	readonly exposureMultiplier: number;
	/** Candidate placement in the reference coordinate system. */
	readonly offset: Readonly<{ x: number; y: number }>;
	readonly alignmentError: number;
	readonly alignmentSupport: number;
}
export interface ImageHdrOriginalProvenanceV1 {
	readonly schemaVersion: 1;
	readonly operation: 'hdr-merge-v1';
	readonly referenceIndex: number;
	readonly alignment: 'none' | 'ward-mtb-v1';
	readonly deghost: Readonly<{ mode: 'off' | 'reference-v1'; threshold: number }>;
	readonly inputs: readonly Readonly<ImageHdrOriginalInputV1>[];
	/** Exact common intersection in the reference coordinate system. */
	readonly output: Readonly<{ x: number; y: number; width: number; height: number }>;
}
const NAME = 'HDR Original provenance', LIMITS = IMAGE_HDR_ORIGINAL_LIMITS_V1;

/** Closed evidence only: this admission does not authenticate source bodies or
 * certify that alignment/reconstruction ran. Native source owners do that. */
export function normalizeImageHdrOriginalProvenanceV1(value: unknown): Readonly<ImageHdrOriginalProvenanceV1> {
	const input = record(value, NAME, ['schemaVersion', 'operation', 'referenceIndex', 'alignment', 'deghost', 'inputs', 'output']);
	if (field(input, 'schemaVersion', NAME) !== 1 || field(input, 'operation', NAME) !== 'hdr-merge-v1') throw new RangeError('Unsupported HDR Original provenance version or operation.');
	const inputs = Object.freeze(array(field(input, 'inputs', NAME), 'HDR source inputs', 2, LIMITS.maximumInputs).map(normalizeInput));
	const referenceIndex = integer(field(input, 'referenceIndex', NAME), 0, inputs.length - 1, 'HDR reference index');
	const alignment = choice(field(input, 'alignment', NAME), ['none', 'ward-mtb-v1'] as const, 'HDR alignment');
	const rawDeghost = record(field(input, 'deghost', NAME), 'HDR deghost', ['mode', 'threshold']);
	const deghost = Object.freeze({ mode: choice(field(rawDeghost, 'mode', NAME), ['off', 'reference-v1'] as const, 'HDR deghost mode'),
		threshold: finite(field(rawDeghost, 'threshold', NAME), 0, 1, 'HDR deghost threshold') });
	const rawOutput = record(field(input, 'output', NAME), 'HDR output intersection', ['x', 'y', 'width', 'height']);
	const output = Object.freeze({ x: integer(field(rawOutput, 'x', NAME), -128, 128, 'HDR output x'), y: integer(field(rawOutput, 'y', NAME), -128, 128, 'HDR output y'),
		width: integer(field(rawOutput, 'width', NAME), 1, LIMITS.maximumSide, 'HDR output width'), height: integer(field(rawOutput, 'height', NAME), 1, LIMITS.maximumSide, 'HDR output height') });
	if (output.width * output.height > LIMITS.maximumPixels) throw new RangeError('HDR output exceeds its pixel limit.');
	const reference = inputs[referenceIndex]!;
	if (reference.exposureMultiplier !== 1 || reference.offset.x !== 0 || reference.offset.y !== 0) throw new RangeError('HDR reference requires unit exposure and zero placement.');
	if (alignment === 'none' && inputs.some(source => source.offset.x !== 0 || source.offset.y !== 0)) throw new RangeError('Unaligned HDR sources require zero placement.');
	const x = Math.max(...inputs.map(source => source.offset.x)), y = Math.max(...inputs.map(source => source.offset.y));
	const right = Math.min(...inputs.map(source => source.offset.x + source.original.width));
	const bottom = Math.min(...inputs.map(source => source.offset.y + source.original.height));
	if (output.x !== x || output.y !== y || output.width !== right - x || output.height !== bottom - y) throw new RangeError('HDR output must be the exact common source intersection.');
	const result = Object.freeze({ schemaVersion: 1 as const, operation: 'hdr-merge-v1' as const, referenceIndex, alignment, deghost, inputs, output });
	if (new TextEncoder().encode(canonical(result)).byteLength > LIMITS.maximumMetadataBytes) throw new RangeError('HDR provenance exceeds its metadata byte limit.');
	return result;
}

/** Canonical JSON is UTF-8, with lexically sorted record keys and no spaces.
 * Number/string spelling is JSON's exact round-trip representation. */
export function serializeImageHdrOriginalProvenanceV1(value: unknown): string {
	return canonical(normalizeImageHdrOriginalProvenanceV1(value));
}
function normalizeInput(value: unknown): Readonly<ImageHdrOriginalInputV1> {
	const input = record(value, 'HDR source input', ['product', 'ownerId', 'sourceId', 'revision', 'original', 'profile', 'exposureMultiplier', 'offset', 'alignmentError', 'alignmentSupport']);
	const rawOriginal = record(field(input, 'original', NAME), 'HDR source Original', ['fileName', 'mimeType', 'sha256', 'byteLength', 'width', 'height']);
	const width = integer(field(rawOriginal, 'width', NAME), 1, LIMITS.maximumSide, 'HDR source width');
	const height = integer(field(rawOriginal, 'height', NAME), 1, LIMITS.maximumSide, 'HDR source height');
	if (width * height > LIMITS.maximumPixels) throw new RangeError('HDR source exceeds its pixel limit.');
	const sha256 = field(rawOriginal, 'sha256', NAME), mimeType = field(rawOriginal, 'mimeType', NAME);
	if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256)) throw new TypeError('HDR source Original requires a lowercase SHA256.');
	if (mimeType !== null && (typeof mimeType !== 'string' || mimeType.length > 256 || !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u.test(mimeType))) throw new TypeError('HDR source MIME requires a bounded type or null.');
	const original = Object.freeze({ fileName: readExactSafeVisualText(field(rawOriginal, 'fileName', NAME), 'HDR source filename', 512, false), mimeType, sha256,
		byteLength: integer(field(rawOriginal, 'byteLength', NAME), 1, LIMITS.maximumInputOriginalBytes, 'HDR source Original length'), width, height });
	const rawOffset = record(field(input, 'offset', NAME), 'HDR source placement', ['x', 'y']);
	const offset = Object.freeze({ x: integer(field(rawOffset, 'x', NAME), -128, 128, 'HDR placement x'), y: integer(field(rawOffset, 'y', NAME), -128, 128, 'HDR placement y') });
	const revision = field(input, 'revision', NAME);
	return Object.freeze({ product: choice(field(input, 'product', NAME), ['lightscaper', 'framescaper'] as const, 'HDR source product'),
		ownerId: id(field(input, 'ownerId', NAME)), sourceId: id(field(input, 'sourceId', NAME)), revision: revision === null ? null : integer(revision, 0, Number.MAX_SAFE_INTEGER, 'HDR source revision'),
		original, profile: choice(field(input, 'profile', NAME), ['encoded-srgb8', 'linear-srgb16'] as const, 'HDR source profile'),
		exposureMultiplier: finite(field(input, 'exposureMultiplier', NAME), 1 / 65536, 65536, 'HDR exposure multiplier'), offset,
		alignmentError: finite(field(input, 'alignmentError', NAME), 0, 1, 'HDR alignment error'),
		alignmentSupport: integer(field(input, 'alignmentSupport', NAME), 0, width * height, 'HDR alignment support') });
}
function id(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('HDR provenance requires bounded stable source identities.');
	return value;
}
function finite(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0) || value < minimum || value > maximum) throw new RangeError(`${name} exceeds its finite scalar bounds.`);
	return value;
}
function integer(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = finite(value, minimum, maximum, name); if (!Number.isSafeInteger(number)) throw new RangeError(`${name} requires an exact safe integer.`); return number;
}
function choice<const Values extends readonly string[]>(value: unknown, values: Values, name: string): Values[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new RangeError(`${name} is unsupported.`); return value as Values[number];
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`).join(',')}}`;
	const text = JSON.stringify(value); if (text === undefined) throw new TypeError('HDR provenance requires closed JSON values.'); return text;
}
