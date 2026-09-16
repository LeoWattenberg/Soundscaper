/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useEffectEvent, useState } from 'react';
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
	const dismissAutomatically = useEffectEvent(onDismiss);
	useEffect(() => {
		const timeout = setTimeout(() => dismissAutomatically(), 10_000);
		return () => clearTimeout(timeout);
	}, [id]);

	return <section className="kw-audio-editor__toast" aria-label={title} data-editor-toast={id}>
		<Toast id={id} type={type} title={title} description={description} showCloseButton={false} />
		<Button className="kw-audio-editor__toast-close" onClick={(event) => {
			event?.currentTarget.closest('[data-audio-editor]')?.querySelector<HTMLElement>('[data-chrome-drawer-toggle], [role="menuitem"]')?.focus({ preventScroll: true });
			onDismiss();
		}}><span aria-hidden="true">×</span><span className="kw-audio-editor-sr-only">{dismissLabel}</span></Button>
		<div className="kw-audio-editor__toast-actions">
			{actions.map((action) => <Button
				key={action.label}
				disabled={action.disabled}
				onClick={action.onClick}
			>{action.label}</Button>)}
		</div>
	</section>;
}

/** Mount while the warning applies; mounting again starts a new notification. */
export function EditorWarningToast(props: Omit<EditorToastProps, 'onDismiss' | 'type'>) {
	const [dismissed, setDismissed] = useState(false);
	if (dismissed) return null;
	return <EditorToast {...props} type="warning" onDismiss={() => setDismissed(true)} />;
}
