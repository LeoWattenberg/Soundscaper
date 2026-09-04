/* SPDX-License-Identifier: AGPL-3.0-only */

import React, {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import { Flyout } from '@soundscaper/design-system/Flyout';

import './audio-editor-design-system/37-help-tooltip.css';

import { retainAudioEditorDialogEscapeOwner } from './dialog-escape-ownership.ts';

interface TooltipAnchor {
	readonly direction: 'down' | 'up';
	readonly x: number;
	readonly y: number;
}

type TooltipVisibilityReason = 'focus' | 'pointer' | 'press';

interface EditorHelpTooltipProps {
	/** What the tooltip explains, used to name the trigger for assistive technology. */
	readonly subject: string;
	/** The explanation itself. */
	readonly description: string;
	/** Localized word for help, used to name the trigger for assistive technology. */
	readonly helpLabel: string;
	/** Value written to {@link hookAttribute} so tests and tours can address the trigger. */
	readonly hook?: string;
	readonly hookAttribute?: string;
	readonly tooltipHookAttribute?: string;
	/** Element describing the control while the tooltip is closed. */
	readonly describedBy?: string;
	readonly className?: string;
}

/**
 * A help affordance that keeps an explanation out of the layout until it is asked for.
 * Parameter descriptions belong here rather than in a paragraph under the control.
 */
export default function EditorHelpTooltip({
	subject,
	description,
	helpLabel,
	hook,
	hookAttribute = 'data-editor-help',
	tooltipHookAttribute = 'data-editor-help-tooltip',
	describedBy,
	className,
}: EditorHelpTooltipProps) {
	const tooltipId = useId();
	const helpRef = useRef<HTMLButtonElement | null>(null);
	const visibilityReasonsRef = useRef(new Set<TooltipVisibilityReason>());
	const [tooltip, setTooltip] = useState<TooltipAnchor | null>(null);
	const tooltipOpen = tooltip !== null;
	const positionTooltip = useCallback((): void => {
		const bounds = helpRef.current?.getBoundingClientRect();
		if (!bounds) return;
		const viewportHeight = Number(window.innerHeight) || 768;
		const direction = bounds.top >= viewportHeight - bounds.bottom ? 'up' : 'down';
		setTooltip({
			direction,
			x: bounds.left + bounds.width / 2,
			y: direction === 'up' ? bounds.top : bounds.bottom,
		});
	}, []);
	const showTooltip = useCallback((reason: TooltipVisibilityReason): void => {
		visibilityReasonsRef.current.add(reason);
		positionTooltip();
	}, [positionTooltip]);
	const hideTooltip = useCallback((reason: TooltipVisibilityReason): void => {
		visibilityReasonsRef.current.delete(reason);
		if (visibilityReasonsRef.current.size === 0) setTooltip(null);
	}, []);
	const dismissTooltip = useCallback((): void => {
		visibilityReasonsRef.current.clear();
		setTooltip(null);
	}, []);
	useEffect(() => {
		if (!tooltip) return undefined;
		window.addEventListener('resize', positionTooltip);
		window.addEventListener('scroll', positionTooltip, true);
		return () => {
			window.removeEventListener('resize', positionTooltip);
			window.removeEventListener('scroll', positionTooltip, true);
		};
	}, [positionTooltip, tooltip]);
	useLayoutEffect(() => {
		if (!tooltipOpen) return undefined;
		return retainAudioEditorDialogEscapeOwner(document, dismissTooltip);
	}, [dismissTooltip, tooltipOpen]);
	const triggerAttributes = hook ? { [hookAttribute]: hook } : {};
	const tooltipAttributes = hook ? { [tooltipHookAttribute]: hook } : {};
	return <span
		className={`audio-editor-help-wrap${className ? ` ${className}` : ''}`}
		onPointerEnter={() => showTooltip('pointer')}
		onPointerLeave={() => hideTooltip('pointer')}
	>
		<button
			ref={helpRef}
			type="button"
			className="audio-editor-help"
			aria-label={`${helpLabel}: ${subject}`}
			aria-describedby={tooltip ? tooltipId : describedBy}
			{...triggerAttributes}
			data-tooltip-ignore
			onFocus={() => showTooltip('focus')}
			onBlur={() => hideTooltip('focus')}
			onClick={(event) => {
				// The trigger often sits inside the label of the control it explains,
				// and a label forwards clicks to that control unless the default is cut.
				event.preventDefault();
				event.stopPropagation();
				if (visibilityReasonsRef.current.has('press')) hideTooltip('press');
				else showTooltip('press');
			}}
		>
			<svg aria-hidden="true" viewBox="0 0 12 12">
				<circle cx="6" cy="2.5" r="1" fill="currentColor" />
				<path d="M6 5v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			</svg>
		</button>
		{tooltip && <Flyout
			id={tooltipId}
			isOpen
			onClose={dismissTooltip}
			x={tooltip.x}
			y={tooltip.y}
			direction={tooltip.direction}
			showArrow
			closeOnOutsideClick
			closeOnEscape={false}
			ariaLabel={description}
			role="tooltip"
			className="audio-editor-help-tooltip"
		>
			<span {...tooltipAttributes}>{description}</span>
		</Flyout>}
	</span>;
}
