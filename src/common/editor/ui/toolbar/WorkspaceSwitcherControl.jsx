/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { Icon } from '@soundscaper/design-system/Icon';

import { workspaceSwitcherOptions } from '../workspace/workspace-switcher-options.ts';

// Audacity's main toolbar row ends in a "Workspace: <name>" dropdown. The
// vendored Button drops ARIA props, so the trigger is a native button wearing
// the design-system button classes; the action-bar CSS themes those already.
export default function WorkspaceSwitcherControl({ copy, snapshot, controller, run }) {
	const workspace = snapshot.preferences?.workspace;
	const options = workspaceSwitcherOptions(snapshot.productId, copy, workspace?.custom);
	const activeId = workspace?.activeId;
	const activeName = options.find((option) => option.id === activeId)?.name ?? '';
	const triggerRef = useRef(null);
	const dismissedByPointerRef = useRef(false);
	const [position, setPosition] = useState(null);
	const close = useCallback(() => setPosition(null), []);
	// The menu already closes itself on any outside pointerdown, the trigger
	// included; without this guard the following click would reopen it.
	const rememberPointerDismissal = () => {
		dismissedByPointerRef.current = Boolean(position);
	};
	const toggle = (event) => {
		if (dismissedByPointerRef.current) {
			dismissedByPointerRef.current = false;
			return;
		}
		if (position) {
			close();
			return;
		}
		const rect = triggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		setPosition({ x: rect.left, y: rect.bottom + 2, autoFocus: event.nativeEvent?.detail === 0 });
	};
	// The action bar's right column is CSS-transformed, which would anchor a
	// position: fixed menu to the column instead of the viewport.
	const menu = position && createPortal(
		<ContextMenu
			isOpen
			onClose={close}
			x={position.x}
			y={position.y}
			autoFocus={position.autoFocus}
			className="kw-audio-editor__workspace-switcher-menu"
		>
			{options.map((option) => (
				<ContextMenuItem
					key={option.id}
					label={option.name}
					checked={option.id === activeId}
					onClick={() => run(() => controller.actions.preferences.setWorkspace(option.id))}
					onClose={close}
				/>
			))}
		</ContextMenu>,
		document.body,
	);
	return (
		<span data-workspace-switcher>
			<button
				ref={triggerRef}
				type="button"
				className="button button--secondary button--small kw-audio-editor__action-bar-button kw-audio-editor__workspace-switcher"
				aria-haspopup="menu"
				aria-expanded={Boolean(position)}
				onPointerDown={rememberPointerDismissal}
				onClick={toggle}
			>
				<span className="button__text">{`${copy.workspace}: ${activeName}`}</span>
				<Icon name="caret-down" size={10} />
			</button>
			{menu}
		</span>
	);
}
