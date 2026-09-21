/* SPDX-License-Identifier: AGPL-3.0-only */

export interface AttributionMetadataPresentation {
	readonly key: string;
	readonly label: string;
	readonly value: string;
}

export interface AttributionSourcePresentation {
	readonly key: string;
	readonly name: string;
	readonly modified?: boolean;
	readonly url?: string;
	readonly creator?: string;
	readonly creatorUrl?: string;
	readonly licenseName?: string;
	readonly licenseUrl?: string;
	readonly metadata: readonly AttributionMetadataPresentation[];
}

export interface AttributionOccurrencePresentation {
	readonly key: string;
	readonly clipName: string;
	readonly trackName: string;
	readonly sequenceId?: string;
	readonly sequenceName?: string;
	readonly useTimeLabel: string;
	readonly projectBin?: boolean;
	readonly sources: readonly AttributionSourcePresentation[];
}

export interface AttributionReportPresentation {
	readonly occurrences: readonly AttributionOccurrencePresentation[];
}

export interface AttributionCsvFileService {
	saveFile(request: Readonly<{
		purpose: 'attribution-csv';
		suggestedName: string;
		mimeType: 'text/csv;charset=utf-8';
		text: string;
	}>): PromiseLike<unknown> | unknown;
}
