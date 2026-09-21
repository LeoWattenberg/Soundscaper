/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectAttributionReport,
	ProjectAttributionSource,
} from './project-attribution-report.ts';

export const PROJECT_ATTRIBUTION_CSV_COLUMNS = Object.freeze([
	'project_source_id',
	'source_name',
	'source_kind',
	'mime_type',
	'classification',
	'origin_summary',
	'provider_summary',
	'creator_summary',
	'source_urls',
	'license_summary',
	'license_urls',
	'source_titles',
	'original_filenames',
	'imported_variants',
	'sequence_id',
	'sequence_name',
	'track_id',
	'track_name',
	'use_kind',
	'use_id',
	'clip_title',
	'use_start_timecode',
	'use_end_timecode',
	'use_start_frame',
	'use_end_frame',
	'project_sample_rate',
	'attribution_json',
	'metadata_json',
	'warnings_json',
] as const);

/** Serialize one RFC 4180 row for every current clip or active comp occurrence. */
export function exportProjectAttributionCsv(report: ProjectAttributionReport): string {
	const lines: string[] = [PROJECT_ATTRIBUTION_CSV_COLUMNS.map(csvCell).join(',')];
	for (const source of report.sources) {
		const summaries = summarizeContributions(source);
		const attributionJson = JSON.stringify(source.contributions);
		const metadataJson = JSON.stringify({
			contributions: source.contributions.map(({ id, metadata, attachments }) => ({
				id, metadata, attachments,
			})),
			source: source.sourceMetadata,
		});
		const warningsJson = JSON.stringify([
			...source.warnings, ...source.contributions.flatMap(({ warnings }) => warnings),
		]);
		for (const use of source.uses) {
			const timelineUse = use.kind === 'project-bin' ? null : use;
			const row = [
				source.sourceId,
				source.sourceName,
				source.sourceKind,
				source.mimeType,
				source.classification,
				summaries.origins,
				summaries.providers,
				summaries.creators,
				summaries.sourceUrls,
				summaries.licenses,
				summaries.licenseUrls,
				summaries.titles,
				summaries.originalFileNames,
				summaries.importedVariants,
				timelineUse?.sequenceId ?? '',
				timelineUse?.sequenceName ?? '',
				timelineUse?.trackId ?? '',
				timelineUse?.trackName ?? '',
				use.kind,
				use.id,
				use.title,
				timelineUse ? formatProjectAttributionTime(timelineUse.startFrame, report.sampleRate) : '',
				timelineUse ? formatProjectAttributionTime(timelineUse.endFrame, report.sampleRate) : '',
				timelineUse?.startFrame ?? '',
				timelineUse?.endFrame ?? '',
				report.sampleRate,
				attributionJson,
				metadataJson,
				warningsJson,
			];
			lines.push(row.map(csvCell).join(','));
		}
	}
	return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/** Format non-negative sample frames as an unbounded-hour millisecond timestamp. */
export function formatProjectAttributionTime(frame: number, sampleRate: number): string {
	const safeFrame = nonNegativeSafeInteger(frame, 'attribution frame');
	const rate = positiveSafeInteger(sampleRate, 'project sample rate');
	const totalMilliseconds = (BigInt(safeFrame) * 1_000n) / BigInt(rate);
	const milliseconds = totalMilliseconds % 1_000n;
	const totalSeconds = totalMilliseconds / 1_000n;
	const seconds = totalSeconds % 60n;
	const totalMinutes = totalSeconds / 60n;
	const minutes = totalMinutes % 60n;
	const hours = totalMinutes / 60n;
	return [pad(hours, 2), pad(minutes, 2), pad(seconds, 2)].join(':') + '.' + pad(milliseconds, 3);
}

function summarizeContributions(source: ProjectAttributionSource): Record<string, string> {
	if (source.contributions.length === 0) {
		return {
			origins: 'Legacy source',
			providers: '',
			creators: '',
			sourceUrls: '',
			licenses: '',
			licenseUrls: '',
			titles: source.sourceName,
			originalFileNames: source.sourceName,
			importedVariants: '',
		};
	}
	return {
		origins: uniqueSummary(source.contributions.map(({ origin }) => origin.kind)),
		providers: uniqueSummary(source.contributions.map(({ origin }) => (
			origin.kind === 'freesound' ? 'Freesound' : 'Local file'
		))),
		creators: uniqueSummary(source.contributions.flatMap(({ origin }) => (
			origin.kind === 'freesound' ? [origin.creator] : []
		))),
		sourceUrls: uniqueSummary(source.contributions.flatMap(({ origin }) => (
			origin.kind === 'freesound' ? [origin.soundUrl] : []
		))),
		licenses: uniqueSummary(source.contributions.flatMap(({ origin }) => (
			origin.kind === 'freesound' ? [origin.license.name] : []
		))),
		licenseUrls: uniqueSummary(source.contributions.flatMap(({ origin }) => (
			origin.kind === 'freesound' ? [origin.license.url] : []
		))),
		titles: uniqueSummary(source.contributions.map(({ origin }) => (
			origin.kind === 'freesound' ? origin.title ?? origin.originalFileName ?? '' : origin.originalFileName
		)).filter(Boolean)),
		originalFileNames: uniqueSummary(source.contributions.flatMap(({ origin }) => (
			origin.originalFileName ? [origin.originalFileName] : []
		))),
		importedVariants: uniqueSummary(source.contributions.flatMap(({ origin }) => (
			origin.kind === 'freesound' ? [origin.importedVariant] : []
		))),
	};
}

function uniqueSummary(values: readonly string[]): string {
	return [...new Set(values)].join('; ');
}

function csvCell(value: unknown): string {
	const text = typeof value === 'number' ? String(value) : defendSpreadsheetFormula(String(value ?? ''));
	return '"' + text.replaceAll('"', '""') + '"';
}

function defendSpreadsheetFormula(value: string): string {
	return /^[=+\-@\t\r\n]/u.test(value) ? "'" + value : value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(name + ' must be a positive safe integer.');
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(name + ' must be a non-negative safe integer.');
	}
	return Number(value);
}

function pad(value: number | bigint, length: number): string {
	return String(value).padStart(length, '0');
}
