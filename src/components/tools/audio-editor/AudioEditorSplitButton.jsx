import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Flyout, TransportButton } from '@dilsonspickles/components';

export default function AudioEditorSplitButton({
	icon,
	ariaLabel,
	optionsLabel = ariaLabel,
	className = '',
	disabled = false,
	pressed = false,
	arrowDisabled = false,
	children,
	...transportProps
}) {
	const arrowRef = useRef(null);
	const mainRef = useRef(null);
	const [flyout, setFlyout] = useState(null);
	const closeFlyout = useCallback(() => setFlyout(null), []);
	const openFlyout = useCallback((event) => {
		const rect = arrowRef.current?.getBoundingClientRect();
		if (!rect) return;
		setFlyout({
			x: rect.left + rect.width / 2,
			y: rect.bottom,
			direction: window.innerHeight - rect.bottom >= 260 ? 'down' : 'up',
			autoFocus: event.nativeEvent.detail === 0,
		});
	}, []);

	useEffect(() => {
		mainRef.current?.querySelector('button')?.setAttribute('aria-pressed', String(Boolean(pressed)));
	}, [pressed]);

	return (
		<span className={`kw-audio-editor__split-button ${className}`}>
			<span ref={mainRef} className="kw-audio-editor__split-button-main">
				<TransportButton icon={icon} ariaLabel={ariaLabel} disabled={disabled} className={className} {...transportProps} />
			</span>
			<button
				ref={arrowRef}
				type="button"
				className="kw-audio-editor__split-button-arrow"
				data-tooltip-ignore
				aria-label={`${optionsLabel} options`}
				aria-expanded={Boolean(flyout)}
				disabled={arrowDisabled}
				onClick={openFlyout}
			>
				<span aria-hidden="true">⌄</span>
			</button>
			<Flyout
				isOpen={Boolean(flyout)}
				onClose={closeFlyout}
				x={flyout?.x || 0}
				y={flyout?.y || 0}
				direction={flyout?.direction || 'down'}
				autoFocus={Boolean(flyout?.autoFocus)}
				triggerRef={arrowRef}
				showArrow
				closeOnOutsideClick
				closeOnEscape
				ariaLabel={`${optionsLabel} options`}
				role="menu"
				className="kw-audio-editor__split-button-flyout"
			>
				{typeof children === 'function' ? children({ close: closeFlyout }) : children}
			</Flyout>
		</span>
	);
}
