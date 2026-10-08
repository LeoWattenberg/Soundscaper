/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

interface Props {
	readonly name: string;
	readonly count: number;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly onCancel: () => void;
	readonly onConfirm: () => void;
}

/** The existing destructive confirmation owns focus and dismissal while open. */
export default function ProjectBinRemoveDialog({ name, count, copy, disabled, onCancel, onConfirm }: Props) {
	return <AudioEditorDialogShell role="alertdialog" title={copy.projectBinRemoveFromProject}
		className="kw-audio-editor__project-bin-confirm" width={480} onClose={onCancel}
		initialFocus="[data-project-bin-remove-cancel]" ariaDescribedBy="project-bin-remove-description"
		overlayDataAttributes={{ 'data-project-bin-remove-dialog': true }}>
		<p id="project-bin-remove-description">{copy.projectBinRemoveConfirm
			.replace('{name}', name).replace('{count}', String(count))}</p>
		<div className="kw-audio-editor-dialog__actions">
			<Button variant="secondary" data-project-bin-remove-cancel onClick={onCancel}>{copy.cancel}</Button>
			<Button variant="primary" disabled={disabled} onClick={onConfirm}>{copy.projectBinRemoveFromProject}</Button>
		</div>
	</AudioEditorDialogShell>;
}
