/* SPDX-License-Identifier: AGPL-3.0-only */

export const LABEL_EXPORT_DIALOG_FORMATS = Object.freeze([
	Object.freeze({ id: 'txt', labelKey: 'exportLabelsTxt' }),
	Object.freeze({ id: 'srt', labelKey: 'exportLabelsSrt' }),
	Object.freeze({ id: 'vtt', labelKey: 'exportLabelsVtt' }),
] as const);

export type LabelExportDialogFormat = typeof LABEL_EXPORT_DIALOG_FORMATS[number]['id'];

export interface LabelExportDialogTrack {
	readonly id: string;
	readonly name: string;
	readonly labelCount: number;
}

interface LabelExportProject {
	readonly tracks?: readonly Readonly<Record<string, unknown>>[];
}

export function listLabelExportTracks(project: LabelExportProject | null | undefined): readonly LabelExportDialogTrack[] {
	return Object.freeze((project?.tracks || []).flatMap((track) => (
		track.type === 'label' && typeof track.id === 'string' && typeof track.name === 'string'
			? [Object.freeze({
				id: track.id,
				name: track.name,
				labelCount: Array.isArray(track.labels) ? track.labels.length : 0,
			})]
			: []
	)));
}

export function toggleLabelExportTrack(
	trackIds: readonly string[],
	trackId: string,
	checked: boolean,
): readonly string[] {
	const next = trackIds.filter((id) => id !== trackId);
	if (checked) next.push(trackId);
	return Object.freeze(next);
}

export function createLabelExportRequest(
	format: unknown,
	selectedTrackIds: readonly string[],
	availableTracks: readonly LabelExportDialogTrack[],
): Readonly<{ format: LabelExportDialogFormat; trackIds: readonly string[] }> {
	const normalizedFormat = String(format).toLowerCase() as LabelExportDialogFormat;
	if (!LABEL_EXPORT_DIALOG_FORMATS.some(({ id }) => id === normalizedFormat)) {
		throw new RangeError(`Unsupported label export format: ${String(format)}.`);
	}
	const selected = new Set(selectedTrackIds);
	const trackIds = Object.freeze(availableTracks
		.map(({ id }) => id)
		.filter((id) => selected.has(id)));
	if (!trackIds.length) throw new RangeError('Select at least one label track.');
	return Object.freeze({ format: normalizedFormat, trackIds });
}
