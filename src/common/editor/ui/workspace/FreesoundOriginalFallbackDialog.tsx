/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

export default function FreesoundOriginalFallbackDialog({
	copy,
	onCancel,
	onConfirm,
}: Readonly<{
	copy: Readonly<Record<string, string>>;
	onCancel: () => void;
	onConfirm: () => void;
}>) {
	return <AudioEditorDialogShell
		title={copy.originalTooLargeTitle}
		onClose={onCancel}
		width={480}
		dataAttributes={{ 'data-freesound-original-fallback-dialog': 'true' }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" onClick={onCancel}>{copy.cancel}</Button>
			<Button variant="primary" onClick={onConfirm}>{copy.importHqPreview}</Button>
		</>} />}
	>
		<p>{copy.originalTooLargeDescription}</p>
	</AudioEditorDialogShell>;
}
