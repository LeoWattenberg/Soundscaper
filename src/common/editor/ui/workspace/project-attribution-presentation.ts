/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	exportProjectAttributionCsv,
	formatProjectAttributionTime,
	type ProjectAttributionReport,
	type ProjectAttributionSource,
} from '../../project-attribution-report.ts';
import type {
	AttributionCsvFileService,
	AttributionMetadataPresentation,
	AttributionReportPresentation,
	AttributionSourcePresentation,
} from '../attribution-presentation-contract.ts';
import type {
	SourceAttributionContributionV1,
	SourceImportOriginV1,
	SourceMetadataV1,
	SourceMetadataValue,
} from '../../source-provenance.ts';

export function presentProjectAttributionReport(
	report: ProjectAttributionReport,
): AttributionReportPresentation {
	return Object.freeze({
		occurrences: Object.freeze(report.sources.flatMap((source) => source.uses.map((use) => Object.freeze({
			key: use.kind === 'project-bin'
				? `${source.sourceId}:${use.kind}:${use.id}`
				: `${source.sourceId}:${use.kind}:${use.sequenceId}:${use.id}`,
			clipName: use.title,
			trackName: use.kind === 'project-bin' ? '' : use.trackName,
			useTimeLabel: use.kind === 'project-bin' ? ''
				: `${formatProjectAttributionTime(use.startFrame, report.sampleRate)}–${formatProjectAttributionTime(use.endFrame, report.sampleRate)}`,
			...(use.kind === 'project-bin' ? { projectBin: true } : {
				sequenceId: use.sequenceId,
				sequenceName: use.sequenceName,
			}),
			sources: presentSources(source),
		})))),
	});
}

export async function saveProjectAttributionCsv(
	report: ProjectAttributionReport,
	projectTitle: unknown,
	fileService: AttributionCsvFileService,
): Promise<unknown> {
	return fileService.saveFile({
		purpose: 'attribution-csv',
		suggestedName: `${safeFileSegment(projectTitle)}-attribution.csv`,
		mimeType: 'text/csv;charset=utf-8',
		text: exportProjectAttributionCsv(report),
	});
}

function presentSources(source: ProjectAttributionSource): readonly AttributionSourcePresentation[] {
	if (source.contributions.length === 0) {
		return Object.freeze([Object.freeze({
			key: `${source.sourceId}:legacy`,
			name: source.sourceName,
			metadata: Object.freeze([
				...presentMetadata(source.sourceMetadata),
				...warningFields(source.warnings),
			]),
		})]);
	}
	const sourceFields = Object.freeze([
		...presentMetadata(source.sourceMetadata, 'source.'),
		...warningFields(source.warnings, 'source.warning'),
	]);
	return Object.freeze(source.contributions.map((contribution, index) => presentContribution(
		source,
		contribution,
		index === 0 ? sourceFields : [],
	)));
}

function presentContribution(
	source: ProjectAttributionSource,
	contribution: SourceAttributionContributionV1,
	sourceFields: readonly AttributionMetadataPresentation[],
): AttributionSourcePresentation {
	const { origin } = contribution;
	return Object.freeze({
		key: `${source.sourceId}:${contribution.id}`,
		name: origin.kind === 'freesound'
			? origin.title ?? origin.originalFileName ?? source.sourceName
			: origin.originalFileName ?? source.sourceName,
		...(source.classification === 'derived' ? { modified: true } : {}),
		...(origin.kind === 'freesound' ? {
			url: origin.soundUrl,
			creator: origin.creator,
			creatorUrl: origin.creatorUrl,
			licenseName: origin.license.name,
			licenseUrl: origin.license.url,
		} : {}),
		metadata: Object.freeze([
			...presentOriginMetadata(origin),
			...presentMetadata(contribution.metadata),
			...contribution.attachments.map((attachment) => Object.freeze({
				key: `attachment:${attachment.path}`,
				label: `attachment: ${attachment.path}`,
				value: [
					attachment.kind,
					attachment.name,
					attachment.description,
					attachment.mimeType,
					`${String(attachment.byteLength)} bytes`,
					`SHA-256 ${attachment.sha256}`,
				].filter(Boolean).join(' · '),
			})),
			...warningFields(contribution.warnings),
			...sourceFields,
		]),
	});
}

function presentOriginMetadata(origin: SourceImportOriginV1): AttributionMetadataPresentation[] {
	if (origin.kind === 'local-file') {
		return [
			metadataField('origin.kind', origin.kind),
			metadataField('origin.originalFileName', origin.originalFileName),
			metadataField('origin.mimeType', origin.mimeType),
			...(Object.hasOwn(origin, 'byteLength')
				? [metadataField('origin.byteLength', origin.byteLength)] : []),
			...(Object.hasOwn(origin, 'lastModified')
				? [metadataField('origin.lastModified', origin.lastModified)] : []),
		];
	}
	return [
		metadataField('origin.kind', origin.kind),
		metadataField('origin.soundId', origin.soundId),
		metadataField('origin.license.family', origin.license.family),
		metadataField('origin.importedVariant', origin.importedVariant),
		...(origin.originalFileName
			? [metadataField('origin.originalFileName', origin.originalFileName)] : []),
		...(origin.mimeType ? [metadataField('origin.mimeType', origin.mimeType)] : []),
	];
}

function metadataField(key: string, value: unknown): AttributionMetadataPresentation {
	return Object.freeze({ key, label: key, value: String(value) });
}

function presentMetadata(
	metadata: SourceMetadataV1,
	prefix = '',
): AttributionMetadataPresentation[] {
	return [
		...flattenMetadata(metadata.normalized, `${prefix}normalized`),
		...flattenMetadata(metadata.raw, `${prefix}raw`),
		...flattenMetadata(metadata.namespaces, `${prefix}namespaces`),
	];
}

function flattenMetadata(
	value: SourceMetadataValue,
	path: string,
): AttributionMetadataPresentation[] {
	if (Array.isArray(value)) return [{ key: path, label: path, value: JSON.stringify(value) }];
	if (isMetadataObject(value)) {
		return Object.keys(value).sort(compareText).flatMap((key) => (
			flattenMetadata(value[key]!, `${path}.${key}`)
		));
	}
	return [{ key: path, label: path, value: String(value) }];
}

function isMetadataObject(
	value: SourceMetadataValue,
): value is Readonly<{ readonly [key: string]: SourceMetadataValue }> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function warningFields(
	warnings: readonly string[],
	keyPrefix = 'warning',
): AttributionMetadataPresentation[] {
	return warnings.map((warning, index) => Object.freeze({
		key: `${keyPrefix}:${String(index)}`,
		label: 'warning',
		value: warning,
	}));
}

function safeFileSegment(value: unknown): string {
	const safe = String(value ?? '')
		.trim()
		.replaceAll(/[=+\-@\t\r\n]+/gu, '')
		.replaceAll(/[^\p{L}\p{N}._]+/gu, '-')
		.replaceAll(/^-+|-+$/gu, '')
		.slice(0, 120);
	return safe || 'project';
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
