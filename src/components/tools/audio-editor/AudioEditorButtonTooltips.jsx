import { useEffect, useState } from 'react';
import { Flyout } from '@dilsonspickles/components';

const BUTTON_SELECTOR = 'button';

/**
 * Supplies one hover-only Flyout for every editor button. Button labels already
 * come from the localized editor catalog, including its Audacity translations,
 * so the tooltip always follows the visible command language.
 */
export default function AudioEditorButtonTooltips({ rootRef }) {
	const [tooltip, setTooltip] = useState(null);

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return undefined;

		const show = (button) => {
			const label = buttonTooltipLabel(button);
			if (!label) return;
			const rect = button.getBoundingClientRect();
			if (!rect.width || !rect.height) return;
			const spaceAbove = rect.top;
			const spaceBelow = window.innerHeight - rect.bottom;
			const direction = spaceAbove >= spaceBelow ? 'up' : 'down';
			const next = {
				button,
				label,
				x: rect.left + rect.width / 2,
				y: direction === 'up' ? rect.top : rect.bottom,
				direction,
			};
			setTooltip((current) => sameTooltip(current, next) ? current : next);
		};

		const hide = (button) => {
			setTooltip((current) => current?.button === button ? null : current);
		};

		const onPointerOver = (event) => {
			const button = editorButton(event.target, root);
			if (button) show(button);
		};
		const onPointerOut = (event) => {
			const button = editorButton(event.target, root);
			if (button && !button.contains(event.relatedTarget)) hide(button);
		};
		const onPointerDown = (event) => {
			const button = editorButton(event.target, root);
			if (button) hide(button);
		};
		const onViewportChange = () => setTooltip((current) => {
			if (!current?.button?.isConnected) return null;
			const rect = current.button.getBoundingClientRect();
			const spaceAbove = rect.top;
			const spaceBelow = window.innerHeight - rect.bottom;
			const direction = spaceAbove >= spaceBelow ? 'up' : 'down';
			return {
				...current,
				x: rect.left + rect.width / 2,
				y: direction === 'up' ? rect.top : rect.bottom,
				direction,
			};
		});

		root.addEventListener('pointerover', onPointerOver, true);
		root.addEventListener('pointerout', onPointerOut, true);
		root.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('resize', onViewportChange);
		window.addEventListener('scroll', onViewportChange, true);
		return () => {
			root.removeEventListener('pointerover', onPointerOver, true);
			root.removeEventListener('pointerout', onPointerOut, true);
			root.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('resize', onViewportChange);
			window.removeEventListener('scroll', onViewportChange, true);
		};
	}, [rootRef]);

	return (
		<Flyout
			isOpen={Boolean(tooltip)}
			onClose={() => setTooltip(null)}
			x={tooltip?.x || 0}
			y={tooltip?.y || 0}
			direction={tooltip?.direction || 'down'}
			showArrow
			closeOnOutsideClick={false}
			closeOnEscape={false}
			ariaLabel={tooltip?.label || ''}
			role="tooltip"
			className="kw-audio-editor__button-tooltip"
		>
			<span data-audio-editor-button-tooltip>{tooltip?.label}</span>
		</Flyout>
	);
}

function editorButton(target, root) {
	if (!(target instanceof Element)) return null;
	const button = target.closest(BUTTON_SELECTOR);
	return button && root.contains(button) ? button : null;
}

function buttonTooltipLabel(button) {
	const labelledBy = button.getAttribute('aria-labelledby');
	if (labelledBy) {
		const label = labelledBy.split(/\s+/u)
			.map((id) => document.getElementById(id)?.textContent?.trim())
			.filter(Boolean)
			.join(' ');
		if (label) return label;
	}
	return button.getAttribute('aria-label')?.trim()
		|| button.closest('[title]')?.getAttribute('title')?.trim()
		|| button.textContent?.trim()
		|| '';
}

function sameTooltip(current, next) {
	return current?.button === next.button
		&& current.label === next.label
		&& current.x === next.x
		&& current.y === next.y
		&& current.direction === next.direction;
}
