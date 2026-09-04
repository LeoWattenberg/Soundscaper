/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	dialogSettingsFromPreset,
	presetFormatFromDialog,
	presetSettingsFromDialog,
} from './export-preset-model.ts';
import { conformExportDialogOutput } from './export-dialog-output-options.ts';
import { normalizeExportDialogAudioSettings } from './export-dialog-audio-codec-options.ts';

/**
 * The Export dialog's preset row: applying a stored preset to the dialog, and
 * saving, deleting, importing or writing out the one it is showing.
 *
 * It lives beside the dialog rather than inside it because the dialog is at the
 * maintained size ceiling, and because every one of these callbacks is the same
 * shape — read or write the preset store, then settle the dialog's own preset
 * state — with no markup between them.
 *
 * @param {{
 *   controller: any,
 *   settings: Record<string, unknown>,
 *   presetId: string,
 *   presetName: string,
 *   presetKind: 'audio' | 'video',
 *   desktop: boolean,
 *   projectChannelCount: number,
 *   setSettings: (update: (current: any) => any) => void,
 *   setPresetId: (id: string) => void,
 *   setPresetName: (name: string) => void,
 * }} options
 */
export function createExportPresetActions({
	controller, settings, presetId, presetName, presetKind, desktop, projectChannelCount,
	setSettings, setPresetId, setPresetName,
}) {
	const store = controller.actions.export.presets;
	return {
		onApply: (id) => {
			setPresetId(id);
			if (!id) return;
			const preset = store.apply(id);
			setPresetName(preset.label);
			// A preset states the delivered form and never the span, so applying one
			// over a chosen loop or selection has to put the dialog back on a whole
			// delivery rather than leave it showing a form it is not delivering.
			setSettings((current) => conformExportDialogOutput(normalizeExportDialogAudioSettings(
				{ ...current, ...dialogSettingsFromPreset(preset) }, desktop, projectChannelCount,
			)));
		},
		onNameChange: setPresetName,
		onSave: async (name) => {
			const preset = await store.save({
				...(presetId && name === undefined ? { id: presetId } : {}),
				label: (name ?? presetName).trim(),
				kind: presetKind,
				format: presetFormatFromDialog(settings.format, presetKind),
				settings: presetSettingsFromDialog(settings, presetKind),
			});
			setPresetId(preset.id);
			setPresetName(preset.label);
		},
		onDelete: async () => {
			await store.delete(presetId);
			setPresetId('');
			setPresetName('');
		},
		onImport: async (file) => { await store.import(await file.text()); },
		onExport: () => store.saveToFile(presetId),
	};
}
