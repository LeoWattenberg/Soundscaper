/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { Icon } from '@soundscaper/design-system/Icon';

import { useMenuTriggerDismissal } from '../use-menu-trigger-dismissal.ts';
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
	const [position, setPosition] = useState(null);
	const close = useCallback(() => setPosition(null), []);
	const consumeTriggerDismissal = useMenuTriggerDismissal(triggerRef, Boolean(position));
	// Presets other than Audacity hide this control, so choosing one unmounts
	// the focused menu item; keep keyboard focus in the action bar instead of
	// letting it fall to the body.
	const choose = (workspaceId) => {
		const trigger = triggerRef.current;
		const bar = trigger?.closest('[role="toolbar"]');
		const ownerDocument = trigger?.ownerDocument;
		run(() => controller.actions.preferences.setWorkspace(workspaceId));
		requestAnimationFrame(() => {
			if (!ownerDocument || ownerDocument.activeElement !== ownerDocument.body) return;
			const fallback = trigger?.isConnected ? trigger : bar?.querySelector('button:not([disabled])');
			fallback?.focus();
		});
	};
	const toggle = (event) => {
		if (consumeTriggerDismissal()) return;
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
					onClick={() => choose(option.id)}
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
				onClick={toggle}
			>
				<span className="button__text">{`${copy.workspace}: ${activeName}`}</span>
				<Icon name="caret-down" size={10} />
			</button>
			{menu}
		</span>
	);
}
