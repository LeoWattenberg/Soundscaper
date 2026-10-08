/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ComponentProps } from 'react';
import { PhotoLibraryDefinitionReader } from '../../src/common/editor/controller/shared/photo-library-definition-reader.ts';
import type PhotoImportDialog from '../../src/common/editor/ui/lightscaper/PhotoImportDialog.tsx';

export const importDialogCopy = {
	photoImportOptions: 'Import options', photoImportRename: 'Rename display names', photoImportNameTemplate: 'Template', photoImportSequenceStart: 'Start', photoImportSequencePadding: 'Padding',
	photoImportMetadataHelp: 'Unchecked keeps source facts; checked blank clears authored display.', photoImportOverride: 'Override {field}',
	photoMetadataTitle: 'Title', photoCaption: 'Caption', photoCreator: 'Creator', photoCopyright: 'Copyright', photoLocation: 'Location',
	photoImportPreset: 'Preset', photoImportPresetNew: 'New preset', photoImportPresetName: 'Name', photoImportPresetLoad: 'Load', photoImportPresetSave: 'Save',
	photoImportPresetDelete: 'Delete', photoImportPresetReload: 'Reload', photoImportPresetFailed: 'Preset failed', photoWorking: 'Working',
	photoKeywords: 'Keywords', photoImportAddKeyword: 'Add keyword', photoImportRemoveKeyword: 'Remove keyword', photoImportNoKeywords: 'No keywords',
	photoImportPreviousKeywords: 'Previous keywords', photoImportNextKeywords: 'Next keywords', photoDefinitionRoot: 'Top level', photoDefinitionUp: 'Parent',
	photoDefinitionNext: 'Next definitions', photoDefinitionReload: 'Reload definitions', photoDefinitionChoose: 'Choose', photoDefinitionOpen: 'Open',
	photoDefinitionClear: 'Clear selection', photoDefinitionSelected: 'Selected', photoDefinitionEmpty: 'No definitions', photoDefinitionFailed: 'Definition unavailable',
};

export function importDialogProps(): ComponentProps<typeof PhotoImportDialog> {
	return { title: 'Import photos', filesLabel: 'Choose files', importLabel: 'Import', cancelLabel: 'Cancel', failureLabel: 'Import failed', busy: false, error: null, copy: importDialogCopy,
		definitionReader: new PhotoLibraryDefinitionReader(), readDefinitions: async () => ({ rootRevision: 0, rows: [], parent: null, selected: null, cursor: null }),
		readDefinition: async () => { throw new Error('Unexpected definition'); }, createId: () => 'preset',
		readPresets: async () => ({ revision: 0, presets: [] }), applyPreset: async () => { throw new Error('Unexpected preset write'); },
		onClose: () => undefined, onImport: async () => ({ outcome: 'failed' }) };
}
