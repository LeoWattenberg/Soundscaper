/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { TextInput } from '@soundscaper/design-system/TextInput';

interface OutputTrackNameEditorProps {
	readonly name: string;
	readonly label: string;
	readonly blocked: boolean;
	readonly onCommit: (name: string) => unknown;
	readonly onClose: (restoreKeyboardFocus: boolean) => void;
}

/** Complete one rename before its input is removed or loses native focus. */
export function OutputTrackNameEditor({
	name: initialName, label, blocked, onCommit, onClose,
}: OutputTrackNameEditorProps) {
	const editorRef = useRef<HTMLLabelElement>(null);
	const completedRef = useRef(false);
	const [name, setName] = useState(initialName);
	useEffect(() => setName(initialName), [initialName]);
	useEffect(() => {
		const input = editorRef.current?.querySelector('input');
		input?.focus();
		input?.select();
	}, []);
	const complete = (save: boolean, restoreKeyboardFocus: boolean): void => {
		if (completedRef.current) return;
		completedRef.current = true;
		const nextName = name.trim();
		if (save && !blocked && nextName && nextName !== initialName) onCommit(nextName);
		onClose(restoreKeyboardFocus);
	};
	return <label
		ref={editorRef}
		className="audio-editor-output-name-editor"
		onBlur={() => complete(true, false)}
		onKeyDown={event => {
			if (event.key !== 'Enter' && event.key !== 'Escape') return;
			event.preventDefault();
			complete(event.key === 'Enter', true);
		}}
	>
		<span className="kw-audio-editor-sr-only">{label}: {initialName}</span>
		<TextInput value={name} disabled={blocked} width="100%" onChange={setName} />
	</label>;
}
