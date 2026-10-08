/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPortal } from 'react-dom';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';

export interface FadeShapeMenuPosition {
	readonly x: number;
	readonly y: number;
	readonly target: HTMLElement;
}

export interface FadeShapeMenuCopy {
	readonly fadeShapeLinear?: string;
	readonly fadeShapeLogarithmic?: string;
	readonly fadeShapeExponential?: string;
	readonly fadeShapeSCurve?: string;
	readonly fadeShapeConstantPower?: string;
	readonly fadeShapeConstantVolume?: string;
}

const PRESET_LABELS = {
	linear: ['fadeShapeLinear', 'Linear'],
	logarithmic: ['fadeShapeLogarithmic', 'Logarithmic'],
	exponential: ['fadeShapeExponential', 'Exponential'],
	's-curve': ['fadeShapeSCurve', 'S-curve'],
	'constant-power': ['fadeShapeConstantPower', 'Constant power'],
	'constant-volume': ['fadeShapeConstantVolume', 'Constant volume'],
} as const;

export function keyboardFadeShapeMenuPosition(target: HTMLElement): FadeShapeMenuPosition {
	const bounds = target.getBoundingClientRect();
	return { target, x: bounds.left, y: bounds.bottom };
}

export function isFadeShapeMenuKey(event: Readonly<{ key: string; shiftKey: boolean }>): boolean {
	return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

/** Share the editor's context-menu behavior without clipping the menu to a clip or track. */
export function FadeShapeMenu<Id extends keyof typeof PRESET_LABELS>({
	position, presets, selectedId, copy, onSelect, onClose,
}: Readonly<{
	position: FadeShapeMenuPosition;
	presets: readonly Readonly<{ id: Id; shape: number | undefined }>[];
	selectedId: Id | null;
	copy: FadeShapeMenuCopy;
	onSelect: (preset: Readonly<{ id: Id; shape: number | undefined }>) => void;
	onClose: () => void;
}>) {
	const menu = <div role="presentation"
		onPointerDown={event => event.stopPropagation()}
		onClick={event => event.stopPropagation()}
		onDoubleClick={event => event.stopPropagation()}
		onKeyDown={event => { if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation(); }}
		onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
		<ContextMenu isOpen x={position.x} y={position.y} onClose={onClose}
			className="audio-editor-fade-shape-menu">
			{presets.map(preset => {
				const [copyKey, fallback] = PRESET_LABELS[preset.id];
				return <ContextMenuItem key={preset.id} role="menuitemradio"
					label={copy[copyKey] || fallback} checked={selectedId === preset.id}
					onClick={() => {
						onClose();
						onSelect(preset);
						if (position.target.isConnected) position.target.focus({ preventScroll: true });
					}} />;
			})}
		</ContextMenu>
	</div>;
	const host = position.target.closest('#kw-audio-editor-design-system') ?? position.target.ownerDocument.body;
	return createPortal(menu, host);
}
