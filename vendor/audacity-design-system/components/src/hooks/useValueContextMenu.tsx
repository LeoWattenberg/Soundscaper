/** Shared direct-entry menu, ported from Audacity design system 20ce5547. */
import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { ContextMenuItem } from '../ContextMenuItem/ContextMenuItem';

export interface ValueContextMenuOptions {
	onEnterValue: () => void;
	onReset?: () => void;
	resetLabel?: string;
	disabled?: boolean;
}

export function useValueContextMenu({ onEnterValue, onReset, resetLabel = 'default', disabled = false }: ValueContextMenuOptions) {
	const [position, setPosition] = useState<{ x: number; y: number; host: Element } | null>(null);
	const openerRef = useRef<HTMLElement | null>(null);
	const close = useCallback(() => {
		setPosition(null);
		if (openerRef.current?.isConnected) openerRef.current.focus();
	}, []);
	const onContextMenu = useCallback((event: React.MouseEvent) => {
		if (disabled) return;
		event.preventDefault();
		event.stopPropagation();
		openerRef.current = event.currentTarget.querySelector<HTMLElement>('input, [role="slider"], [role="spinbutton"]') ?? event.currentTarget as HTMLElement;
		setPosition({ x: event.clientX, y: event.clientY,
			host: event.currentTarget.closest('[data-audio-editor]') ?? event.currentTarget.ownerDocument.body });
	}, [disabled]);
	return {
		onContextMenu, close, open: position !== null,
		menu: position && createPortal(<div onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
			<ContextMenu isOpen onClose={close} x={position.x} y={position.y} className="value-context-menu" autoFocus>
			<ContextMenuItem label="Enter value…" onClick={() => { close(); onEnterValue(); }} />
			{onReset && <ContextMenuItem label={`Reset to ${resetLabel}`} onClick={() => { close(); onReset(); }} />}
			</ContextMenu>
		</div>, position.host),
	};
}
