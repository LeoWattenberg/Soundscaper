/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type MouseEvent,
	type ReactNode,
	type RefObject,
} from 'react';
import {
	Flyout,
	ToggleToolButton,
	TransportButton,
	type TransportButtonProps,
} from '@dilsonspickles/components';

import { iconNameToChar } from '../audacity-iconcodes.js';

export interface SplitButtonFlyoutPlacement {
	readonly x: number;
	readonly y: number;
	readonly direction: 'down' | 'up';
	readonly autoFocus: boolean;
}

export interface AudioEditorSplitButtonProps {
	readonly icon: TransportButtonProps['icon'];
	readonly ariaLabel: string;
	readonly optionsAriaLabel: string;
	readonly className?: string;
	readonly disabled?: boolean;
	readonly pressed?: boolean;
	readonly arrowDisabled?: boolean;
	readonly toggle?: boolean;
	readonly active?: boolean;
	readonly recording?: boolean;
	readonly state?: TransportButtonProps['state'];
	readonly onClick?: () => void;
	readonly children?: ReactNode | ((controls: Readonly<{ close: () => void }>) => ReactNode);
}

export function splitButtonFlyoutPlacement(
	rect: Pick<DOMRect, 'bottom' | 'left' | 'width'>,
	viewportHeight: number,
	autoFocus: boolean,
): SplitButtonFlyoutPlacement {
	return {
		x: rect.left + rect.width / 2,
		y: rect.bottom,
		direction: viewportHeight - rect.bottom >= 260 ? 'down' : 'up',
		autoFocus,
	};
}

/** Typed boundary around the pinned design-system transport and flyout DOM. */
export default function AudioEditorSplitButton({
	icon,
	ariaLabel,
	optionsAriaLabel,
	className = '',
	disabled = false,
	pressed = false,
	arrowDisabled = false,
	toggle = false,
	active,
	recording,
	state,
	onClick,
	children,
}: AudioEditorSplitButtonProps) {
	const arrowRef = useRef<HTMLButtonElement>(null);
	const mainRef = useRef<HTMLSpanElement>(null);
	const [flyout, setFlyout] = useState<SplitButtonFlyoutPlacement | null>(null);
	const closeFlyout = useCallback(() => setFlyout(null), []);
	const openFlyout = useCallback((event: MouseEvent<HTMLButtonElement>) => {
		const rect = arrowRef.current?.getBoundingClientRect();
		if (!rect) return;
		setFlyout(splitButtonFlyoutPlacement(
			rect,
			window.innerHeight,
			event.nativeEvent.detail === 0,
		));
	}, []);

	useEffect(() => {
		const vendorButton = mainRef.current?.querySelector('button');
		if (vendorButton) vendorButton.ariaPressed = String(Boolean(pressed));
	}, [pressed]);

	return (
		<span className={`kw-audio-editor__split-button ${className}`}>
			<span ref={mainRef} className="kw-audio-editor__split-button-main">
				{toggle
					? <ToggleToolButton
						icon={icon}
						ariaLabel={ariaLabel}
						disabled={disabled}
						isActive={pressed}
						onClick={onClick}
					/>
					: <TransportButton
						icon={icon}
						ariaLabel={ariaLabel}
						disabled={disabled}
						className={className}
						active={active}
						recording={recording}
						state={state}
						onClick={onClick}
					/>}
			</span>
			<button
				ref={arrowRef}
				type="button"
				className="kw-audio-editor__split-button-arrow"
				data-tooltip-ignore
				aria-label={optionsAriaLabel}
				aria-expanded={Boolean(flyout)}
				disabled={arrowDisabled}
				onClick={openFlyout}
			>
				<span className="kw-audio-editor__split-button-arrow-icon" aria-hidden="true">{iconNameToChar('DOWN')}</span>
			</button>
			<Flyout
				isOpen={Boolean(flyout)}
				onClose={closeFlyout}
				x={flyout?.x || 0}
				y={flyout?.y || 0}
				direction={flyout?.direction || 'down'}
				autoFocus={Boolean(flyout?.autoFocus)}
				triggerRef={arrowRef as RefObject<HTMLElement>}
				showArrow
				closeOnOutsideClick
				closeOnEscape
				ariaLabel={optionsAriaLabel}
				role="menu"
				className="kw-audio-editor__split-button-flyout"
			>
				{typeof children === 'function' ? children({ close: closeFlyout }) : children}
			</Flyout>
		</span>
	);
}
