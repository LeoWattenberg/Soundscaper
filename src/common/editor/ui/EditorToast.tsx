/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';
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
	return <section className="kw-audio-editor__toast" aria-label={title} data-editor-toast={id}>
		<Toast id={id} type={type} title={title} description={description} showCloseButton={false} />
		<div className="kw-audio-editor__toast-actions">
			{actions.map((action) => <Button
				key={action.label}
				disabled={action.disabled}
				onClick={action.onClick}
			>{action.label}</Button>)}
			<Button onClick={(event) => {
				event?.currentTarget.closest('[data-audio-editor]')?.querySelector<HTMLElement>('[data-chrome-drawer-toggle], [role="menuitem"]')?.focus({ preventScroll: true });
				onDismiss();
			}}>{dismissLabel}</Button>
		</div>
	</section>;
}

/** Mount while the warning applies; mounting again starts a new notification. */
export function EditorWarningToast(props: Omit<EditorToastProps, 'onDismiss' | 'type'>) {
	const [dismissed, setDismissed] = useState(false);
	if (dismissed) return null;
	return <EditorToast {...props} type="warning" onDismiss={() => setDismissed(true)} />;
}
