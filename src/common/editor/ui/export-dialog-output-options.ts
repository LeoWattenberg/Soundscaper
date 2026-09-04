/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What the export dialog delivers, asked once.
 *
 * The dialog used to ask two questions — a form (one mix or a stem per track)
 * and a range (the project, the selection, the loop) — whose answers only make
 * sense in a few combinations. Here they are one choice, so every option names a
 * whole delivery: the project as one mix, one file per track, one file per
 * label, or one of the sub-ranges the timeline already has.
 */

type DataRecord = Readonly<Record<string, unknown>>;

export interface ExportDialogOutputSettings {
	readonly mode: 'mix' | 'stems' | 'chapters';
	readonly range: 'project' | 'selection' | 'loop';
	readonly masteringSequenceId: string;
}

export interface ExportDialogOutputOption {
	readonly value: string;
	readonly label: string;
	readonly disabled?: boolean;
}

export interface ExportDialogOutputContext {
	readonly hasSelection: boolean;
	readonly hasLoop: boolean;
	readonly chapterCount: number;
	/** BW64 carries one authored programme, so it delivers one file over one range. */
	readonly singleFileOnly: boolean;
	readonly masteringSequences: readonly Readonly<{
		id: string;
		name: string;
		deliverable?: boolean;
	}>[];
}

const MASTERING_SEQUENCE_PREFIX = 'mastering-sequence:';

/** The option the dialog's current settings are already on. */
export function exportDialogOutputValue(settings: DataRecord): string {
	const sequenceId = settings.masteringSequenceId;
	if (typeof sequenceId === 'string' && sequenceId !== '') return `${MASTERING_SEQUENCE_PREFIX}${sequenceId}`;
	if (settings.mode === 'stems') return 'stems';
	if (settings.mode === 'chapters') return 'chapters';
	if (settings.range === 'selection') return 'selection';
	if (settings.range === 'loop') return 'loop';
	return 'project';
}

/** The form, span, and sequence one chosen option means, stated together. */
export function exportDialogOutputSettings(value: string): ExportDialogOutputSettings {
	if (value.startsWith(MASTERING_SEQUENCE_PREFIX)) {
		return Object.freeze({
			mode: 'mix',
			range: 'project',
			masteringSequenceId: value.slice(MASTERING_SEQUENCE_PREFIX.length),
		});
	}
	if (value === 'stems' || value === 'chapters') {
		return Object.freeze({ mode: value, range: 'project', masteringSequenceId: '' });
	}
	return Object.freeze({
		mode: 'mix',
		range: value === 'selection' || value === 'loop' ? value : 'project',
		masteringSequenceId: '',
	});
}

/**
 * Settings that state a form the dialog can no longer pair with a sub-range.
 *
 * A preset carries the form and never the span, so applying one over a chosen
 * loop or selection would leave the dialog showing a whole-project delivery
 * while the request still named the sub-range.
 */
export function conformExportDialogOutput<Settings extends DataRecord>(settings: Settings): Settings {
	if (settings.mode !== 'stems' && settings.mode !== 'chapters') return settings;
	if (settings.range === 'project' && !settings.masteringSequenceId) return settings;
	return Object.freeze({ ...settings, range: 'project', masteringSequenceId: '' });
}

export function exportDialogOutputOptions(
	copy: DataRecord,
	context: ExportDialogOutputContext,
): readonly ExportDialogOutputOption[] {
	const text = (key: string, fallback: string) => (typeof copy[key] === 'string' ? copy[key] as string : fallback);
	return Object.freeze([
		{ value: 'project', label: text('entireProject', 'Entire project') },
		{
			value: 'stems',
			label: text('exportOutputStems', 'Individual stems (split by tracks)'),
			disabled: context.singleFileOnly,
		},
		{
			value: 'loop',
			label: text('exportOutputLoop', 'In/Out (looping region)'),
			disabled: !context.hasLoop,
		},
		{
			value: 'chapters',
			label: text('exportOutputChapters', 'Chapters (split by labels)'),
			disabled: context.singleFileOnly || context.chapterCount < 1,
		},
		{
			value: 'selection',
			label: text('currentSelection', 'Current selection'),
			disabled: !context.hasSelection,
		},
		...context.masteringSequences.map((sequence) => ({
			value: `${MASTERING_SEQUENCE_PREFIX}${sequence.id}`,
			label: sequence.name,
			disabled: sequence.deliverable === false,
		})),
	]);
}
