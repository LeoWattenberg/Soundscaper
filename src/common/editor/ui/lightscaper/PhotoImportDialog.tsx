/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

interface Props {
	readonly title: string;
	readonly filesLabel: string;
	readonly importLabel: string;
	readonly cancelLabel: string;
	readonly busy: boolean;
	readonly onClose: () => void;
	readonly onImport: (files: readonly File[]) => void;
}

export default function PhotoImportDialog(props: Props) {
	const input = useRef<HTMLInputElement>(null);
	const [selectedCount, setSelectedCount] = useState(0);
	return <AudioEditorDialogShell title={props.title} onClose={props.onClose}
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop"
		initialFocus="input[type=file]" closeOnOutside={false}>
		<form onSubmit={event => {
			event.preventDefault();
			const files = input.current?.files;
			if (files?.length && !props.busy) props.onImport(Object.freeze(Array.from(files)));
		}}>
			<label>{props.filesLabel}
				<input ref={input} type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
					disabled={props.busy} onChange={() => { setSelectedCount(input.current?.files?.length ?? 0); }} />
			</label>
			<div className="lightscaper-dialog-actions">
				<button type="submit" disabled={props.busy || selectedCount === 0}>{props.importLabel}</button>
				<button type="button" onClick={props.onClose}>{props.cancelLabel}</button>
			</div>
		</form>
	</AudioEditorDialogShell>;
}
