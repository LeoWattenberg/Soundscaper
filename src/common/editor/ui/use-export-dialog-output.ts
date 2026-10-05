/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';

import { exportChapterCount } from '../export-chapters.ts';
import { exportClipCount } from '../export-clip-boundaries.ts';
import { isVideoExportDialogFormat } from './export-dialog-model.js';
import {
	exportDialogOutputNoLabelsHint,
	exportDialogOutputOptions,
	exportDialogOutputValue,
	type ExportDialogOutputContext,
} from './export-dialog-output-options.ts';

type DataRecord = Readonly<Record<string, unknown>>;
type MasteringSequence = ExportDialogOutputContext['masteringSequences'][number];

interface OutputContext<Settings extends DataRecord> {
	readonly project: unknown;
	readonly copy: DataRecord;
	readonly hasSelection: boolean;
	readonly hasLoop: boolean;
	readonly sequences?: readonly MasteringSequence[];
	readonly settings: Settings;
	readonly setSettings: Dispatch<SetStateAction<Settings>>;
}

/** Keep the delivery choice aligned with the outputs the current project can write. */
export function useExportDialogOutput<Settings extends DataRecord>({
	project, copy, hasSelection, hasLoop, sequences, settings, setSettings,
}: OutputContext<Settings>) {
	const videoFormat = isVideoExportDialogFormat(settings.format);
	const singleFileOnly = videoFormat || settings.format === 'bw64';
	// A mastering sequence delivers one spliced mix, so split outputs and
	// programme/video formats cannot also deliver one.
	const masteringSequences = useMemo(() => (
		settings.mode !== 'mix' || singleFileOnly ? [] : sequences ?? []
	), [sequences, settings.mode, singleFileOnly]);
	const labelChapterCount = useMemo(() => exportChapterCount(project, 'labels'), [project]);
	const markerChapterCount = useMemo(() => exportChapterCount(project, 'markers'), [project]);
	const audioClipCount = useMemo(() => exportClipCount(project), [project]);
	const context = {
		hasSelection, hasLoop, labelChapterCount, markerChapterCount,
		audioClipCount, singleFileOnly, masteringSequences,
	};
	// A video delivery remains one file over the chosen span.
	const outputValue = exportDialogOutputValue(videoFormat ? { ...settings, mode: 'mix' } : settings);
	const outputOptions = exportDialogOutputOptions(copy, context);
	const outputNoLabelsHint = exportDialogOutputNoLabelsHint(copy, context);

	useEffect(() => {
		if (!hasSelection && settings.range === 'selection') {
			setSettings((current) => ({ ...current, range: 'project' }));
		}
	}, [hasSelection, settings.range, setSettings]);

	useEffect(() => {
		const chosenCount = settings.chapterSource === 'markers' ? markerChapterCount : labelChapterCount;
		if ((settings.mode === 'chapters' && chosenCount < 1)
			|| (settings.mode === 'clips' && audioClipCount < 1)) {
			setSettings((current) => ({ ...current, mode: 'mix' }));
		}
	}, [audioClipCount, labelChapterCount, markerChapterCount, settings.chapterSource, settings.mode, setSettings]);

	useEffect(() => {
		if (!settings.masteringSequenceId) return;
		const chosen = masteringSequences.find(({ id }) => id === settings.masteringSequenceId);
		if (!chosen?.deliverable) setSettings((current) => ({ ...current, masteringSequenceId: '' }));
	}, [masteringSequences, settings.masteringSequenceId, setSettings]);

	return { outputValue, outputOptions, outputNoLabelsHint };
}
