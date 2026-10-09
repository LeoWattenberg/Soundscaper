/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard, AudioEditorCommand } from './protocol.ts';
import type { AudioEditorClipboardV7 } from './clipboard-codec-v7.ts';

export type CurrentAudioEditorClipboardDescriptor = AudioEditorClipboard | AudioEditorClipboardV7;
export interface CurrentAudioEditorClipboardPasteCommandV2 extends Omit<
	Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>, 'clipboard'
> {
	readonly clipboard: CurrentAudioEditorClipboardDescriptor;
}
export interface AudioEditorClipboardPasteCommandV2 extends CurrentAudioEditorClipboardPasteCommandV2 {
	readonly clipboard: AudioEditorClipboardV7;
}
export interface AudioEditorClipboardCommandBatchV2 {
	readonly type: 'batch';
	readonly commands: readonly CurrentAudioEditorMutationCommandV2[];
}
export type CurrentAudioEditorMutationCommandV2 = AudioEditorCommand | CurrentAudioEditorClipboardPasteCommandV2 | AudioEditorClipboardCommandBatchV2;
export function isCurrentClipboardPasteCommandV2(command: CurrentAudioEditorMutationCommandV2): command is AudioEditorClipboardPasteCommandV2 {
	return command.type === 'clipboard/paste' && command.clipboard.schemaVersion === 7;
}
