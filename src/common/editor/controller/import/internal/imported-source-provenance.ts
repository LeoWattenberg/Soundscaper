/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	inspectImportedMediaMetadata,
	type ImportedMediaMetadataInspection,
} from '../../../imported-media-metadata.ts';
import {
	createImportedSourceProvenance,
	normalizeSourceProvenance,
	type SourceMetadataRecord,
	type SourceMetadataValue,
	type SourceProvenanceV1,
} from '../../../source-provenance.ts';
import {
	freezeProjectImportOptions,
	type NormalizedProjectImportOptions,
} from './project-import-options.ts';

export type ImportedMediaMetadataInspector = (
	file: Blob,
	options?: Readonly<{ signal?: AbortSignal }>,
) => Promise<ImportedMediaMetadataInspection>;

export interface PrepareImportedSourceProvenanceOptions {
	readonly createContributionId: () => string;
	readonly existing?: SourceProvenanceV1;
	readonly signal?: AbortSignal;
	readonly inspectMetadata?: ImportedMediaMetadataInspector;
}

/** Attach one immutable import origin and the file's bounded embedded metadata. */
export async function prepareImportedSourceProvenance(
	file: File,
	options: PrepareImportedSourceProvenanceOptions,
): Promise<SourceProvenanceV1> {
	options.signal?.throwIfAborted();
	const existing = options.existing
		? normalizeSourceProvenance(options.existing, 'import source provenance')
		: undefined;
	const inspected = await (options.inspectMetadata ?? inspectImportedMediaMetadata)(file, {
		...(options.signal ? { signal: options.signal } : {}),
	});
	options.signal?.throwIfAborted();
	if (existing) return enrichExistingProvenance(existing, inspected);
	return createImportedSourceProvenance({
		id: options.createContributionId(),
		origin: {
			kind: 'local-file',
			originalFileName: file.name,
			mimeType: file.type || 'application/octet-stream',
			byteLength: file.size,
			lastModified: canonicalFileTimestamp(file.lastModified),
		},
		metadata: inspected.metadata,
		attachments: inspected.attachments,
		warnings: inspected.warnings,
	});
}

export async function prepareAttributedImportOptions(
	file: File,
	options: Readonly<NormalizedProjectImportOptions>,
	createContributionId: () => string,
): Promise<Readonly<NormalizedProjectImportOptions>> {
	const sourceProvenance = await prepareImportedSourceProvenance(file, {
		createContributionId,
		...(options.sourceProvenance ? { existing: options.sourceProvenance } : {}),
		...(options.signal ? { signal: options.signal } : {}),
	});
	return freezeProjectImportOptions(
		{ ...options, sourceProvenance },
		Boolean(options.timelineStartExplicit),
	);
}

function enrichExistingProvenance(
	value: SourceProvenanceV1,
	inspected: ImportedMediaMetadataInspection,
): SourceProvenanceV1 {
	const existing = normalizeSourceProvenance(value, 'import source provenance');
	if (existing.classification !== 'imported' || existing.contributions.length !== 1) {
		throw new TypeError('An attributed import must carry exactly one imported contribution.');
	}
	const contribution = existing.contributions[0];
	if (!contribution) throw new TypeError('An attributed import contribution is required.');
	const inspectedMetadata = inspected.metadata;
	return createImportedSourceProvenance({
		...contribution,
		metadata: {
			normalized: mergeMetadataRecords(
				inspectedMetadata.normalized,
				contribution.metadata.normalized,
			),
			raw: mergeMetadataRecords(inspectedMetadata.raw, contribution.metadata.raw),
			namespaces: mergeMetadataRecords(
				inspectedMetadata.namespaces,
				contribution.metadata.namespaces,
			),
		},
		attachments: [...contribution.attachments, ...inspected.attachments],
		warnings: [...contribution.warnings, ...inspected.warnings],
	});
}

function mergeMetadataRecords(
	base: Readonly<Record<string, unknown>> | undefined,
	override: SourceMetadataRecord,
): SourceMetadataRecord {
	const baseRecord = base ?? {};
	const result: Record<string, SourceMetadataValue> = {};
	const keys = [...new Set([...Object.keys(baseRecord), ...Object.keys(override)])].sort(compareText);
	for (const key of keys) {
		const hasBase = Object.hasOwn(baseRecord, key);
		const hasOverride = Object.hasOwn(override, key);
		const value = hasBase && hasOverride
			? mergeMetadataValues(
				baseRecord[key] as SourceMetadataValue,
				override[key]!,
			)
			: hasOverride ? override[key]! : baseRecord[key] as SourceMetadataValue;
		Object.defineProperty(result, key, {
			value,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	return result;
}

function mergeMetadataValues(
	base: SourceMetadataValue,
	override: SourceMetadataValue,
): SourceMetadataValue {
	if (metadataValuesEqual(base, override)) return override;
	if (isMetadataRecord(base) && isMetadataRecord(override)) {
		return mergeMetadataRecords(base, override);
	}
	return [base, override];
}

function metadataValuesEqual(left: SourceMetadataValue, right: SourceMetadataValue): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) && Array.isArray(right)
			&& left.length === right.length
			&& left.every((value, index) => metadataValuesEqual(value, right[index]!));
	}
	if (!isMetadataRecord(left) || !isMetadataRecord(right)) return false;
	const leftKeys = Object.keys(left).sort(compareText);
	const rightKeys = Object.keys(right).sort(compareText);
	return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => (
		key === rightKeys[index]
		&& metadataValuesEqual(left[key]!, right[key]!)
	));
}

function isMetadataRecord(value: SourceMetadataValue): value is SourceMetadataRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function canonicalFileTimestamp(value: number): string | null {
	if (!Number.isFinite(value) || value < 0) return null;
	const timestamp = new Date(value);
	return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}
