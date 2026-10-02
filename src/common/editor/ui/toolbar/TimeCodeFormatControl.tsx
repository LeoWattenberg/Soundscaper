/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { Icon } from '@soundscaper/design-system/Icon';
import { timeCodeFormatOptionsForDomain, type TimeCodeFormat } from '@soundscaper/design-system/TimeCode';
import { useMenuTriggerDismissal } from '../use-menu-trigger-dismissal.ts';

interface TimeCodeFormatControlProps {
	readonly label: string;
	readonly format: TimeCodeFormat;
	readonly frameRate: number;
	readonly onFormatChange: (format: TimeCodeFormat) => void;
	readonly dockingLabel?: string;
	readonly onDockingChange?: () => void;
	readonly children: ReactNode;
}

/** Extend the timer's existing menu at the application boundary. */
export default function TimeCodeFormatControl({
	label, format, frameRate, onFormatChange, dockingLabel, onDockingChange, children,
}: TimeCodeFormatControlProps) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const containerRef = useRef<HTMLSpanElement>(null);
	const [timeCodeHost, setTimeCodeHost] = useState<Element | null>(null);
	const [menu, setMenu] = useState<{ x: number; y: number; keyboard: boolean } | null>(null);
	useLayoutEffect(() => {
		setTimeCodeHost(containerRef.current?.querySelector('.timecode') ?? null);
	}, []);
	const close = useCallback(() => setMenu(null), []);
	const consumeTriggerDismissal = useMenuTriggerDismissal(buttonRef, Boolean(menu));
	const options = timeCodeFormatOptionsForDomain('time', frameRate);
	const open = (keyboard: boolean) => {
		const bounds = buttonRef.current?.getBoundingClientRect();
		if (!bounds) return;
		buttonRef.current?.focus();
		setMenu({ x: bounds.left, y: bounds.bottom + 4, keyboard });
	};
	const menuItem = (option: typeof options[number]) => <ContextMenuItem
		key={option.format} label={option.label} checked={format === option.format}
		onClick={() => { close(); onFormatChange(option.format); }}
	/>;
	const menuHost = buttonRef.current?.closest('[data-audio-editor]') ?? buttonRef.current?.ownerDocument.body;
	const formatButton = <button ref={buttonRef} type="button" className="timecode__format-button" tabIndex={-1}
		aria-label={label} aria-haspopup="menu" aria-expanded={Boolean(menu)}
		onClick={(event) => {
			if (consumeTriggerDismissal()) return;
			if (menu) close();
			else open(event.detail === 0);
		}}>
		<Icon name="caret-down" size={16} />
	</button>;
	return <span ref={containerRef} className="kw-audio-editor__timecode-format-control"
		onKeyDownCapture={(event) => {
			if (event.key !== 'F10' || !event.shiftKey) return;
			event.preventDefault();
			event.stopPropagation();
			open(true);
		}}>
		{children}
		{timeCodeHost ? createPortal(formatButton, timeCodeHost) : formatButton}
		{menu && menuHost && createPortal(<ContextMenu
			isOpen onClose={close} x={menu.x} y={menu.y} autoFocus={menu.keyboard}
			className="kw-audio-editor__timecode-format-menu"
		>
			{options.filter((option) => !option.group).map(menuItem)}
			{(['Video frames', 'CD frames'] as const).map((group) => <ContextMenuItem
				key={group} label={group} hasSubmenu
				checked={options.some((option) => option.group === group && option.format === format)}
			>
				{options.filter((option) => option.group === group).map(menuItem)}
			</ContextMenuItem>)}
			{onDockingChange && <>
				<ContextMenuItem isDivider />
				<ContextMenuItem label={dockingLabel} onClick={() => { close(); onDockingChange(); }} />
			</>}
		</ContextMenu>, menuHost)}
	</span>;
}
