/* SPDX-License-Identifier: AGPL-3.0-only */

export const SOURCE_PROVENANCE_SCHEMA_VERSION = 1;

export { createNonImportedSourceProvenance } from './source-provenance-root.ts';

export const SOURCE_PROVENANCE_LIMITS = Object.freeze({
	maximumContributions: 256,
	maximumAttachments: 256,
	maximumWarnings: 256,
	maximumMetadataDepth: 12,
	maximumMetadataNodes: 8_192,
	maximumKeyCodeUnits: 256,
	maximumStringCodeUnits: 65_536,
	maximumIdentifierCodeUnits: 256,
	maximumUrlCodeUnits: 2_048,
});

export type SourceProvenanceClassification = 'imported' | 'derived' | 'recorded' | 'generated';
export type FreesoundLicenseFamily = 'cc0' | 'cc-by' | 'cc-by-nc' | 'sampling-plus';
export type SourceMetadataPrimitive = string | number | boolean | null;
export type SourceMetadataValue = SourceMetadataPrimitive
	| readonly SourceMetadataValue[]
	| Readonly<{ readonly [key: string]: SourceMetadataValue }>;
export type SourceMetadataRecord = Readonly<{ readonly [key: string]: SourceMetadataValue }>;

export interface SourceMetadataV1 {
	readonly normalized: SourceMetadataRecord;
	readonly raw: SourceMetadataRecord;
	readonly namespaces: SourceMetadataRecord;
}

export interface SourceMetadataAttachmentV1 {
	readonly path: string;
	readonly kind?: string;
	readonly name?: string;
	readonly mimeType?: string;
	readonly description?: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface LocalFileSourceOriginV1 {
	readonly kind: 'local-file';
	readonly originalFileName: string;
	readonly mimeType: string;
	readonly byteLength?: number | null;
	readonly lastModified?: string | null;
}

export interface FreesoundSourceOriginV1 {
	readonly kind: 'freesound';
	readonly soundId: number;
	readonly title?: string;
	readonly soundUrl: string;
	readonly creator: string;
	readonly creatorUrl: string;
	readonly license: Readonly<{
		readonly family: FreesoundLicenseFamily;
		readonly name: string;
		readonly url: string;
	}>;
	readonly importedVariant: 'preview-hq-ogg';
	readonly originalFileName?: string;
	readonly mimeType?: string;
}

export type SourceImportOriginV1 = LocalFileSourceOriginV1 | FreesoundSourceOriginV1;

export interface SourceAttributionContributionV1 {
	readonly id: string;
	readonly origin: SourceImportOriginV1;
	readonly metadata: SourceMetadataV1;
	readonly attachments: readonly SourceMetadataAttachmentV1[];
	readonly warnings: readonly string[];
}

export interface SourceProvenanceV1 {
	readonly schemaVersion: typeof SOURCE_PROVENANCE_SCHEMA_VERSION;
	readonly classification: SourceProvenanceClassification;
	readonly contributions: readonly SourceAttributionContributionV1[];
}

type DataRecord = Readonly<Record<string, unknown>>;

const CLASSIFICATIONS = new Set<SourceProvenanceClassification>([
	'imported', 'derived', 'recorded', 'generated',
]);
const FREESOUND_LICENSES = new Set<FreesoundLicenseFamily>([
	'cc0', 'cc-by', 'cc-by-nc', 'sampling-plus',
]);
const SHA256 = /^[\da-f]{64}$/u;

export function createImportedSourceProvenance(contribution: unknown): SourceProvenanceV1 {
	return normalizeSourceProvenance({
		schemaVersion: SOURCE_PROVENANCE_SCHEMA_VERSION,
		classification: 'imported',
		contributions: [contribution],
	});
}

export function normalizeSourceProvenance(
	value: unknown,
	name = 'source.provenance',
): SourceProvenanceV1 {
	const input = closedRecord(value, name, ['schemaVersion', 'classification', 'contributions']);
	if (input.schemaVersion !== SOURCE_PROVENANCE_SCHEMA_VERSION) {
		throw new RangeError(`${name}.schemaVersion must be ${String(SOURCE_PROVENANCE_SCHEMA_VERSION)}.`);
	}
	const classification = enumeration(input.classification, CLASSIFICATIONS, `${name}.classification`);
	const values = denseArray(input.contributions, `${name}.contributions`);
	if (values.length > SOURCE_PROVENANCE_LIMITS.maximumContributions) {
		throw new RangeError(
			`${name}.contributions cannot exceed ${String(SOURCE_PROVENANCE_LIMITS.maximumContributions)} entries.`,
		);
	}
	if (classification === 'imported' && values.length === 0) {
		throw new RangeError(`${name} for imported media must carry at least one contribution.`);
	}
	if ((classification === 'recorded' || classification === 'generated') && values.length !== 0) {
		throw new RangeError(`${name} for ${classification} media cannot carry imported contributions.`);
	}
	const contributions = values.map((entry, index) => (
		normalizeContribution(entry, `${name}.contributions[${String(index)}]`)
	));
	const ids = new Set<string>();
	for (const contribution of contributions) {
		if (ids.has(contribution.id)) {
			throw new RangeError(`${name}.contributions cannot repeat contribution ID ${contribution.id}.`);
		}
		ids.add(contribution.id);
	}
	return Object.freeze({
		schemaVersion: SOURCE_PROVENANCE_SCHEMA_VERSION,
		classification,
		contributions: Object.freeze(contributions),
	});
}

export function validateSourceProvenance(
	value: unknown,
	name = 'source.provenance',
): value is SourceProvenanceV1 {
	normalizeSourceProvenance(value, name);
	return true;
}

/** Canonicalize extracted tag dictionaries before they enter provenance. */
export function normalizeSourceMetadata(
	value: unknown,
	name = 'source metadata',
): SourceMetadataV1 {
	return normalizeMetadata(value, name);
}

export function copySourceProvenance(
	value: SourceProvenanceV1 | null | undefined,
): SourceProvenanceV1 | undefined {
	return value == null ? undefined : normalizeSourceProvenance(value);
}

export function mergeSourceProvenance(
	values: readonly (SourceProvenanceV1 | null | undefined)[],
): SourceProvenanceV1 {
	const contributions: SourceAttributionContributionV1[] = [];
	const contributionIndexById = new Map<string, number>();
	for (const [index, value] of values.entries()) {
		if (value == null) continue;
		const provenance = normalizeSourceProvenance(value, `source provenance input[${String(index)}]`);
		for (const contribution of provenance.contributions) {
			const contributionIndex = contributionIndexById.get(contribution.id);
			if (contributionIndex === undefined) {
				contributionIndexById.set(contribution.id, contributions.length);
				contributions.push(contribution);
				continue;
			}
			const previous = contributions[contributionIndex]!;
			if (canonicalContributionWithoutWarnings(previous) !== canonicalContributionWithoutWarnings(contribution)) {
				throw new RangeError(`Cannot merge conflicting contribution ID ${contribution.id}.`);
			}
			const warnings = [...new Set([...previous.warnings, ...contribution.warnings])];
			if (warnings.length !== previous.warnings.length) {
				contributions[contributionIndex] = normalizeContribution({
					...previous,
					warnings,
				}, `source provenance contribution ${contribution.id}`);
			}
		}
	}
	return normalizeSourceProvenance({
		schemaVersion: SOURCE_PROVENANCE_SCHEMA_VERSION,
		classification: 'derived',
		contributions,
	});
}

function canonicalContributionWithoutWarnings(contribution: SourceAttributionContributionV1): string {
	const { warnings: _warnings, ...value } = contribution;
	return canonicalJson(value);
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (!value || typeof value !== 'object') return JSON.stringify(value);
	return `{${Object.entries(value).sort(([left], [right]) => (
		left < right ? -1 : left > right ? 1 : 0
	)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

function normalizeContribution(value: unknown, name: string): SourceAttributionContributionV1 {
	const input = closedRecord(value, name, ['id', 'origin', 'metadata', 'attachments', 'warnings']);
	const metadata = input.metadata == null ? emptyMetadata() : normalizeMetadata(input.metadata, `${name}.metadata`);
	const attachmentValues = input.attachments == null ? [] : denseArray(input.attachments, `${name}.attachments`);
	if (attachmentValues.length > SOURCE_PROVENANCE_LIMITS.maximumAttachments) {
		throw new RangeError(
			`${name}.attachments cannot exceed ${String(SOURCE_PROVENANCE_LIMITS.maximumAttachments)} entries.`,
		);
	}
	const warningValues = input.warnings == null ? [] : denseArray(input.warnings, `${name}.warnings`);
	if (warningValues.length > SOURCE_PROVENANCE_LIMITS.maximumWarnings) {
		throw new RangeError(
			`${name}.warnings cannot exceed ${String(SOURCE_PROVENANCE_LIMITS.maximumWarnings)} entries.`,
		);
	}
	return Object.freeze({
		id: boundedString(input.id, `${name}.id`, SOURCE_PROVENANCE_LIMITS.maximumIdentifierCodeUnits),
		origin: normalizeOrigin(input.origin, `${name}.origin`),
		metadata,
		attachments: Object.freeze(attachmentValues.map((entry, index) => (
			normalizeAttachment(entry, `${name}.attachments[${String(index)}]`)
		))),
		warnings: Object.freeze(warningValues.map((entry, index) => boundedString(
			entry,
			`${name}.warnings[${String(index)}]`,
			SOURCE_PROVENANCE_LIMITS.maximumStringCodeUnits,
		))),
	});
}

function normalizeOrigin(value: unknown, name: string): SourceImportOriginV1 {
	const candidate = dataRecord(value, name);
	if (candidate.kind === 'local-file') {
		const input = closedRecord(candidate, name, [
			'kind', 'originalFileName', 'mimeType', 'byteLength', 'lastModified',
		]);
		return Object.freeze({
			kind: 'local-file',
			originalFileName: boundedString(
				input.originalFileName,
				`${name}.originalFileName`,
				SOURCE_PROVENANCE_LIMITS.maximumStringCodeUnits,
			),
			mimeType: boundedString(input.mimeType, `${name}.mimeType`, 256),
			...(Object.hasOwn(input, 'byteLength') ? {
				byteLength: input.byteLength === null
					? null
					: nonNegativeSafeInteger(input.byteLength, `${name}.byteLength`),
			} : {}),
			...(Object.hasOwn(input, 'lastModified') ? {
				lastModified: input.lastModified === null
					? null
					: canonicalTimestamp(input.lastModified, `${name}.lastModified`),
			} : {}),
		});
	}
	if (candidate.kind !== 'freesound') throw new RangeError(`${name}.kind must be local-file or freesound.`);
	const input = closedRecord(candidate, name, [
		'kind', 'soundId', 'title', 'soundUrl', 'creator', 'creatorUrl', 'license',
		'importedVariant', 'originalFileName', 'mimeType',
	]);
	if (input.importedVariant !== 'preview-hq-ogg') {
		throw new RangeError(`${name}.importedVariant must be preview-hq-ogg.`);
	}
	const license = closedRecord(input.license, `${name}.license`, ['family', 'name', 'url']);
	return Object.freeze({
		kind: 'freesound',
		soundId: positiveSafeInteger(input.soundId, `${name}.soundId`),
		...(Object.hasOwn(input, 'title') ? {
			title: boundedString(input.title, `${name}.title`, SOURCE_PROVENANCE_LIMITS.maximumStringCodeUnits),
		} : {}),
		soundUrl: httpsUrl(input.soundUrl, `${name}.soundUrl`),
		creator: boundedString(input.creator, `${name}.creator`, SOURCE_PROVENANCE_LIMITS.maximumStringCodeUnits),
		creatorUrl: httpsUrl(input.creatorUrl, `${name}.creatorUrl`),
		license: Object.freeze({
			family: enumeration(license.family, FREESOUND_LICENSES, `${name}.license.family`),
			name: boundedString(
				license.name,
				`${name}.license.name`,
				SOURCE_PROVENANCE_LIMITS.maximumStringCodeUnits,
			),
			url: httpsUrl(license.url, `${name}.license.url`),
		}),
		importedVariant: 'preview-hq-ogg',
		...(Object.hasOwn(input, 'originalFileName') ? {
			originalFileName: boundedString(
				input.originalFileName,
				`${name}.originalFileName`,
				SOURCE_PROVENANCE_LIMITS.maximumStringCodeUnits,
			),
		} : {}),
		...(Object.hasOwn(input, 'mimeType') ? {
			mimeType: boundedString(input.mimeType, `${name}.mimeType`, 256),
		} : {}),
	});
}

function normalizeMetadata(value: unknown, name: string): SourceMetadataV1 {
	const input = closedRecord(value, name, ['normalized', 'raw', 'namespaces']);
	const budget = { nodes: 0 };
	return Object.freeze({
		normalized: metadataRecord(input.normalized ?? {}, `${name}.normalized`, budget),
		raw: metadataRecord(input.raw ?? {}, `${name}.raw`, budget),
		namespaces: metadataRecord(input.namespaces ?? {}, `${name}.namespaces`, budget),
	});
}

function emptyMetadata(): SourceMetadataV1 {
	return Object.freeze({
		normalized: Object.freeze({}),
		raw: Object.freeze({}),
		namespaces: Object.freeze({}),
	});
}

function metadataRecord(
	value: unknown,
	name: string,
	budget: { nodes: number },
): SourceMetadataRecord {
	const normalized = metadataValue(value, name, 0, budget);
	if (normalized === null || Array.isArray(normalized) || typeof normalized !== 'object') {
		throw new TypeError(`${name} must be a JSON-compatible object.`);
	}
	return normalized as SourceMetadataRecord;
}

function metadataValue(
	value: unknown,
	name: string,
	depth: number,
	budget: { nodes: number },
): SourceMetadataValue {
	budget.nodes += 1;
	if (budget.nodes > SOURCE_PROVENANCE_LIMITS.maximumMetadataNodes) {
		throw new RangeError('Source metadata exceeds its node safety limit.');
	}
	if (depth > SOURCE_PROVENANCE_LIMITS.maximumMetadataDepth) {
		throw new RangeError(`${name} exceeds the source metadata depth safety limit.`);
	}
	if (value === null || typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		if (value.length > SOURCE_PROVENANCE_LIMITS.maximumStringCodeUnits) {
			throw new RangeError(`${name} exceeds the source metadata string safety limit.`);
		}
		return value;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError(`${name} must contain only finite numbers.`);
		return Object.is(value, -0) ? 0 : value;
	}
	if (value instanceof Date) return canonicalTimestamp(value.toISOString(), name);
	if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
		throw new TypeError(`${name} contains binary data; persist a hashed attachment descriptor instead.`);
	}
	if (Array.isArray(value)) {
		return Object.freeze(denseArray(value, name).map((entry, index) => (
			metadataValue(entry, `${name}[${String(index)}]`, depth + 1, budget)
		)));
	}
	const input = dataRecord(value, name);
	const result: Record<string, SourceMetadataValue> = {};
	for (const key of Object.keys(input).sort(compareText)) {
		if (key.length === 0 || key.length > SOURCE_PROVENANCE_LIMITS.maximumKeyCodeUnits) {
			throw new RangeError(`${name} contains an invalid metadata key.`);
		}
		Object.defineProperty(result, key, {
			value: metadataValue(input[key], `${name}.${key}`, depth + 1, budget),
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	return Object.freeze(result);
}

function normalizeAttachment(value: unknown, name: string): SourceMetadataAttachmentV1 {
	const input = closedRecord(value, name, [
		'path', 'kind', 'name', 'mimeType', 'description', 'byteLength', 'sha256',
	]);
	const digest = boundedString(input.sha256, `${name}.sha256`, 64).toLowerCase();
	if (!SHA256.test(digest)) throw new TypeError(`${name}.sha256 must be a lowercase SHA-256 digest.`);
	return Object.freeze({
		path: boundedString(input.path, `${name}.path`, 1_024),
		...(Object.hasOwn(input, 'kind') ? {
			kind: boundedString(input.kind, `${name}.kind`, SOURCE_PROVENANCE_LIMITS.maximumKeyCodeUnits),
		} : {}),
		...(Object.hasOwn(input, 'name') ? {
			name: boundedString(input.name, `${name}.name`, SOURCE_PROVENANCE_LIMITS.maximumStringCodeUnits),
		} : {}),
		...(Object.hasOwn(input, 'mimeType') ? {
			mimeType: boundedString(input.mimeType, `${name}.mimeType`, 256),
		} : {}),
		...(Object.hasOwn(input, 'description') ? {
			description: boundedString(
				input.description,
				`${name}.description`,
				SOURCE_PROVENANCE_LIMITS.maximumStringCodeUnits,
			),
		} : {}),
		byteLength: nonNegativeSafeInteger(input.byteLength, `${name}.byteLength`),
		sha256: digest,
	});
}

function closedRecord(value: unknown, name: string, keys: readonly string[]): DataRecord {
	const input = dataRecord(value, name);
	const allowed = new Set(keys);
	for (const key of Object.keys(input)) {
		if (!allowed.has(key)) throw new TypeError(`${name}.${key} is not supported.`);
	}
	return input;
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain JSON-compatible object.`);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} must not contain symbol keys.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an enumerable data property.`);
		}
	}
	return value as DataRecord;
}

function denseArray(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	if (Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`${name} must contain only dense indexed data.`);
	}
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain enumerable dense data properties.`);
		}
	}
	return value;
}

function boundedString(value: unknown, name: string, maximum: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
		throw new TypeError(`${name} must be a non-empty string of at most ${String(maximum)} code units.`);
	}
	return value;
}

function canonicalTimestamp(value: unknown, name: string): string {
	const timestamp = boundedString(value, name, 64);
	const date = new Date(timestamp);
	if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
		throw new TypeError(`${name} must be a canonical ISO timestamp.`);
	}
	return timestamp;
}

function httpsUrl(value: unknown, name: string): string {
	const text = boundedString(value, name, SOURCE_PROVENANCE_LIMITS.maximumUrlCodeUnits);
	let parsed: URL;
	try {
		parsed = new URL(text);
	} catch {
		throw new TypeError(`${name} must be a valid HTTPS URL.`);
	}
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
		throw new TypeError(`${name} must be a credential-free HTTPS URL.`);
	}
	return parsed.href;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = nonNegativeSafeInteger(value, name);
	if (result === 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function enumeration<Value extends string>(
	value: unknown,
	values: ReadonlySet<Value>,
	name: string,
): Value {
	if (typeof value !== 'string' || !values.has(value as Value)) {
		throw new RangeError(`${name} has an unsupported value.`);
	}
	return value as Value;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
