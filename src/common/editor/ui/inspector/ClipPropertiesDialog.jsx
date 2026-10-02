/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import ClipPropertiesBody from './ClipPropertiesBody.jsx';

export { clipRenameTitle } from './ClipPropertiesBody.jsx';

export function ClipPropertiesDialog({ isOpen, controller, snapshot, copy, onClose, focusField = null }) {
	const initialFocus = ['pitchCents', 'speedRatio'].includes(focusField)
		? `[data-clip-field="${focusField}"] input` : 'first';
	return (
		<AudioEditorDialogShell
			isOpen={isOpen}
			initialFocus={initialFocus}
			title={copy.clipProperties || copy.clip}
			onClose={onClose}
			width={720}
			className="audio-editor-clip-properties-dialog"
			dataAttributes={{ 'data-clip-properties-dialog': '' }}
			footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="primary" onClick={onClose}>{copy.done}</Button>} />}
		>
			<ClipPropertiesBody key={JSON.stringify([snapshot.project?.id ?? null, snapshot.selectedClipId ?? null])} controller={controller} snapshot={snapshot} copy={copy} />
		</AudioEditorDialogShell>
	);
}

export default ClipPropertiesDialog;
