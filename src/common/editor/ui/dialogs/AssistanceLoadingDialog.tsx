/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import './AssistanceModelGate.css';

type Copy = Readonly<Record<string, string | undefined>>;

export function AssistanceLoadingProgress({ title, copy }: { readonly title: string; readonly copy: Copy }) {
	const label = (copy.assistanceLoadingEffect || 'Loading {effect}').replaceAll('{effect}', title);
	return <div className="kw-assistance-loading" role="status" aria-live="polite" data-assistance-loading-progress>
		<p>{label}</p>
		<progress aria-label={label} />
	</div>;
}

export default function AssistanceLoadingDialog({ title, copy, onClose }: {
	readonly title: string;
	readonly copy: Copy;
	readonly onClose: () => void;
}) {
	return <AudioEditorDialogShell title={title} onClose={onClose} width={560} initialFocus="dialog"
		dataAttributes={{ 'data-assistance-loading': 'true' }}
		footer={<DialogFooter rightContent={<span data-assistance-loading-cancel><Button variant="secondary"
			onClick={onClose}>{copy.cancel || 'Cancel'}</Button></span>} />}>
		<AssistanceLoadingProgress title={title} copy={copy} />
	</AudioEditorDialogShell>;
}
