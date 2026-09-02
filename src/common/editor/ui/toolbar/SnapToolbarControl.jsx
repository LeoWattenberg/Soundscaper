/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useRef, useState } from 'react';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { Icon } from '@soundscaper/design-system/Icon';
import { ToolbarButtonGroup } from '@soundscaper/design-system/Toolbar';

import { selectAudioEditorEditBlock } from '../../edit-blocking.ts';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import { createSnapMenu, snapMenuCurrentLabel } from '../application-menu-model.js';

// Audacity's Play toolbar keeps the musical divisions flat and folds the
// other unit families into submenus; the groups reuse the View menu's labels.
const SUBMENU_GROUP_IDS = Object.freeze(['snap-time', 'snap-video', 'snap-cd']);

export default function SnapToolbarControl({ controller, snapshot, copy, run }) {
	const project = snapshot.project;
	const disabled = selectAudioEditorEditBlock(snapshot).blocked || !project;
	const snapEnabled = Boolean(project?.snap?.enabled);
	const setSnap = useCallback(
		(settings) => run(() => controller.actions.timeline.setSnap(settings)),
		[controller, run],
	);
	const menu = createSnapMenu(copy, project, disabled, setSnap);
	const groups = Object.fromEntries(menu.items.map((item) => [item.id, item]));
	const currentLabel = snapMenuCurrentLabel(menu);
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
	const leaf = (item, closesMenu) => (
		<ContextMenuItem
			key={item.id}
			label={item.label}
			checked={item.checked}
			disabled={item.disabled}
			onClick={item.onClick}
			onClose={closesMenu ? close : undefined}
		/>
	);
	return (
		<ToolbarButtonGroup className="kw-audio-editor__snap-control" gap={4}>
			<span data-snap-control>
				<PreferenceCheckbox
					label={copy.snap}
					checked={snapEnabled}
					disabled={disabled}
					onChange={(enabled) => setSnap({ enabled })}
				/>
				<button
					ref={triggerRef}
					type="button"
					className="kw-audio-editor__snap-interval"
					data-snap-interval
					aria-haspopup="menu"
					aria-expanded={Boolean(position)}
					aria-label={`${copy.snapInterval}: ${currentLabel}`}
					disabled={disabled || !snapEnabled}
					onPointerDown={rememberPointerDismissal}
					onClick={toggle}
				>
					<span className="kw-audio-editor__snap-interval-label">{currentLabel}</span>
					<Icon name="caret-down" size={10} />
				</button>
				<ContextMenu
					isOpen={Boolean(position)}
					onClose={close}
					x={position?.x || 0}
					y={position?.y || 0}
					autoFocus={Boolean(position?.autoFocus)}
					className="kw-audio-editor__snap-menu"
				>
					{groups['snap-musical'].items.map((item) => leaf(item, true))}
					<ContextMenuItem isDivider />
					{leaf(groups['snap-triplets'], false)}
					<ContextMenuItem isDivider />
					{SUBMENU_GROUP_IDS.map((groupId) => (
						<ContextMenuItem
							key={groupId}
							label={groups[groupId].label}
							hasSubmenu
							checked={groups[groupId].items.some((item) => item.checked)}
							onClose={close}
						>
							{groups[groupId].items.map((item) => leaf(item, true))}
						</ContextMenuItem>
					))}
				</ContextMenu>
			</span>
		</ToolbarButtonGroup>
	);
}
