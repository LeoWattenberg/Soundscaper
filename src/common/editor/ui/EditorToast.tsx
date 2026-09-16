/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { Toast } from '@soundscaper/design-system/Toast/Toast';

export interface EditorToastAction {
	readonly label: string;
	readonly onClick: () => void;
	readonly disabled?: boolean;
}

export interface EditorToastProps {
	readonly id: string;
	readonly title: string;
	readonly description?: string;
	readonly type?: 'info' | 'warning' | 'error' | 'success';
	readonly actions?: readonly EditorToastAction[];
	readonly dismissLabel: string;
	readonly onDismiss: () => void;
}

/** Controlled notifications stay within the editor that owns their state. */
export default function EditorToast({
	id, title, description, type = 'info', actions = [], dismissLabel, onDismiss,
}: EditorToastProps) {
	const toastRef = useRef<HTMLElement>(null);
	const dismiss = () => {
		toastRef.current?.closest('[data-audio-editor]')?.querySelector<HTMLElement>('[data-chrome-drawer-toggle], [role="menuitem"]')?.focus({ preventScroll: true });
		onDismiss();
	};
	return <section ref={toastRef} className="kw-audio-editor__toast" aria-label={title} data-editor-toast={id}>
		<Toast id={id} type={type} title={title} description={description} showCloseButton={false} />
		<div className="kw-audio-editor__toast-actions">
			{actions.map((action) => <Button
				key={action.label}
				variant="secondary"
				disabled={action.disabled}
				onClick={action.onClick}
			>{action.label}</Button>)}
			<Button variant="secondary" onClick={dismiss}>{dismissLabel}</Button>
		</div>
	</section>;
}

/** Mount while the warning applies; mounting again starts a new notification. */
export function EditorWarningToast(props: Omit<EditorToastProps, 'onDismiss'>) {
	const [dismissed, setDismissed] = useState(false);
	if (dismissed) return null;
	return <EditorToast {...props} type={props.type ?? 'warning'} onDismiss={() => setDismissed(true)} />;
}
