import { useEffect, useRef } from 'react';
import { ContextMenu, Icon } from '@dilsonspickles/components';
// This file renders .add-track-flyout* markup by class name without mounting
// the AddTrackFlyout component, so its stylesheet must be imported explicitly
// or tree-shaking drops it with the unused component module.
import '../../../../../vendor/audacity-design-system/components/src/AddTrackFlyout/AddTrackFlyout.css';

import { AUDIO_EDITOR_TRACK_COLORS } from '../../project-audio-factory.js';
import { colorName } from './TimelineOverlayComponents.jsx';

export function ContainerAddTrackFlyout({
	isOpen,
	onSelectTrackType,
	mutationsBlocked,
	showMasterTrack,
	onToggleMasterTrack,
	markersAvailable,
	showMarkers,
	onToggleMarkers,
	onClose,
	x,
	y,
	autoFocus,
	triggerRef,
	className = '',
	copy,
}) {
	const flyoutRef = useRef(null);
	const firstOptionRef = useRef(null);

	useEffect(() => {
		if (!isOpen) return undefined;
		const handleClickOutside = (event) => {
			if (flyoutRef.current && !flyoutRef.current.contains(event.target)) onClose();
		};
		const timer = window.setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
		return () => {
			window.clearTimeout(timer);
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen, onClose]);

	useEffect(() => {
		if (!isOpen) return undefined;
		const handleKeyDown = (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
				window.setTimeout(() => triggerRef?.current?.focus(), 0);
				return;
			}
			if (event.key === 'Tab') {
				onClose();
				return;
			}
			if (!['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
			const options = [...(flyoutRef.current?.querySelectorAll('.add-track-flyout__option:not(:disabled)') || [])];
			const currentIndex = options.indexOf(document.activeElement);
			if (currentIndex < 0 || !options.length) return;
			event.preventDefault();
			const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
			const nextIndex = (currentIndex + direction + options.length) % options.length;
			options[currentIndex].tabIndex = -1;
			options[nextIndex].tabIndex = 0;
			options[nextIndex].focus();
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isOpen, onClose, triggerRef]);

	useEffect(() => {
		if (!isOpen || !autoFocus) return undefined;
		const timer = window.setTimeout(() => {
			const firstEnabled = flyoutRef.current?.querySelector('.add-track-flyout__option:not(:disabled)');
			(firstEnabled || firstOptionRef.current)?.focus();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [autoFocus, isOpen]);

	useEffect(() => {
		if (!isOpen || !flyoutRef.current) return;
		const flyout = flyoutRef.current;
		const rect = flyout.getBoundingClientRect();
		const adjustedX = Math.max(10, Math.min(x, window.innerWidth - rect.width - 10));
		const adjustedY = Math.max(10, Math.min(y, window.innerHeight - rect.height - 10));
		flyout.style.left = `${adjustedX}px`;
		flyout.style.top = `${adjustedY}px`;
	}, [isOpen, x, y]);

	if (!isOpen) return null;
	const options = [
		{ type: 'audio', label: copy.audioTrack, icon: 'microphone' },
		{ type: 'video', label: copy.videoTrack || 'Video track', icon: 'play' },
		{ type: 'label', label: copy.labelTrack, icon: 'label' },
		{ type: 'send', label: copy.addSendTrack || copy.addSendBus, icon: 'automation' },
	];
	return (
		<div
			ref={flyoutRef}
			className={`add-track-flyout ${className}`}
			style={{ position: 'fixed', left: `${x}px`, top: `${y}px` }}
		>
			<div className="add-track-flyout__triangle" style={{ left: 88 }} />
			<div className="add-track-flyout__body" role="menu" aria-label={copy.addTrack}>
				<div className="add-track-flyout__options">
					{options.map((option, index) => (
						<button
							key={option.type}
							ref={index === 0 ? firstOptionRef : undefined}
							type="button"
							className="add-track-flyout__option"
							role="menuitem"
							tabIndex={index === 0 ? 0 : -1}
							disabled={mutationsBlocked}
							onClick={() => onSelectTrackType(option.type)}
						>
							<Icon name={option.icon} size={16} />
							<span className="add-track-flyout__option-label">{option.label}</span>
						</button>
					))}
				</div>
				<div className="add-track-flyout__separator" role="separator" />
				<div className="add-track-flyout__row">
					<label className="add-track-flyout__checkbox-control">
						<input type="checkbox" checked={showMasterTrack} disabled={mutationsBlocked} onChange={onToggleMasterTrack} />
						<span>{copy.masterTrack}</span>
					</label>
				</div>
				{markersAvailable && <div className="add-track-flyout__row">
					<label className="add-track-flyout__checkbox-control">
						<input
							type="checkbox"
							data-show-markers-toggle
							checked={showMarkers}
							onChange={onToggleMarkers}
						/>
						<span>{copy.showMarkers}</span>
					</label>
				</div>}
			</div>
		</div>
	);
}

export function TrackColorPicker({ isOpen, x, y, color, copy, onChange, onClose }) {
	return (
		<ContextMenu
			isOpen={isOpen}
			x={x}
			y={y}
			autoFocus
			onClose={onClose}
			className="audio-editor-track-color-picker"
		>
			<div className="audio-editor-track-color-picker__label">{copy.trackColor}</div>
			{AUDIO_EDITOR_TRACK_COLORS.map((candidate) => (
				<button
					key={candidate}
					type="button"
					role="menuitem"
					className="audio-editor-track-color-picker__swatch"
					data-color={candidate}
					data-selected={color === candidate ? 'true' : 'false'}
					style={{ backgroundColor: `var(--clip-${candidate}-body)` }}
					aria-label={`${copy.trackColor}: ${colorName(copy, candidate)}`}
					aria-current={color === candidate ? 'true' : undefined}
					onClick={() => {
						onChange(candidate);
						onClose();
					}}
				/>
			))}
		</ContextMenu>
	);
}
