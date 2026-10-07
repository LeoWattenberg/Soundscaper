/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef } from 'react';
import { Icon } from '@soundscaper/design-system/Icon';

interface Props {
	readonly labels: Readonly<{ create: string; import: string; export: string; delete: string }>;
	readonly selectedId: string | null;
	readonly exportDisabled: boolean;
	onCreate(): void;
	onImport(): void;
	onExport(): void;
	onDelete(): void;
}

/** Library deletion can permanently disable its pressed control. */
export default function MacroLibraryActions({ labels, selectedId, exportDisabled,
	onCreate, onImport, onExport, onDelete }: Props) {
	const createRef = useRef<HTMLButtonElement>(null);
	const deleteRef = useRef<HTMLButtonElement>(null);
	const deleting = useRef<HTMLButtonElement | null>(null);
	useLayoutEffect(() => {
		const control = deleting.current;
		if (!control) return;
		deleting.current = null;
		const document = control.ownerDocument;
		if (selectedId || document.activeElement !== control && document.activeElement !== document.body) return;
		createRef.current?.focus();
	}, [selectedId]);
	const remove = (): void => {
		const control = deleteRef.current;
		deleting.current = control?.ownerDocument.activeElement === control ? control : null;
		onDelete();
	};
	const actions = [
		{ key: 'create', icon: 'plus', disabled: false, invoke: onCreate },
		{ key: 'import', icon: 'import', disabled: false, invoke: onImport },
		{ key: 'export', icon: 'export', disabled: exportDisabled, invoke: onExport },
		{ key: 'delete', icon: 'trash', disabled: !selectedId, invoke: remove },
	] as const;
	return <div className="audio-editor-macros-palette__library-actions">
		{actions.map(action => <button key={action.key} type="button"
			ref={action.key === 'create' ? createRef : action.key === 'delete' ? deleteRef : undefined}
			className="audio-editor-macros-palette__icon-button" aria-label={labels[action.key]}
			disabled={action.disabled} onClick={action.invoke}>
			<Icon name={action.icon} size={16} />
		</button>)}
	</div>;
}
