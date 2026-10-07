import { useRef, useState } from 'react';
import { TIMELINE_ADDITIONAL_COPY } from '../../../i18n/editor-timeline-additional-copy.ts';
import { Button } from '@soundscaper/design-system/Button';
import { GhostButton } from '@soundscaper/design-system/GhostButton';
import { Icon } from '@soundscaper/design-system/Icon';
import { ToggleButton } from '@soundscaper/design-system/ToggleButton';

import { TrackNameEditor } from './TrackControls.jsx';
import { focusFirst } from './timeline-navigation.js';
import { selectTrackFromHeader } from './track-header-selection.ts';

export function VideoTrackControls({
	controller, track, panelWidth, selected, blocked, isFlatNavigation, copy, run,
	onMenu, onOpenEffects, effectsAvailable, onTabOut, onShiftTabOut, onNavigateVertical,
}) {
	const controlsRef = useRef(null);
	const [editingName, setEditingName] = useState(false);
	const controlTabIndex = isFlatNavigation ? 0 : -1;
	const handleKeyDown = (event) => {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.key === 'Tab') {
			const controls = [...controlsRef.current.querySelectorAll('button:not([disabled]), input:not([disabled])')];
			const currentIndex = controls.indexOf(document.activeElement);
			if (currentIndex < 0) return;
			event.preventDefault();
			if (event.shiftKey) {
				if (currentIndex > 0) focusFirst(controls[currentIndex - 1]);
				else onShiftTabOut?.();
			} else if (currentIndex < controls.length - 1) focusFirst(controls[currentIndex + 1]);
			else onTabOut?.();
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			if (event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
			event.preventDefault();
			onNavigateVertical?.(event.key === 'ArrowDown' ? 'down' : 'up');
		}
	};
	return <div ref={controlsRef} className="audio-editor-video-track-controls track-control-panel"
		data-track-header data-selected={selected ? 'true' : 'false'} style={{ width: panelWidth }}
		onFocusCapture={() => !selected && run(() => controller.actions.timeline.selectTrack(track.id))}
		onClick={(event) => {
			if (blocked || event.target.closest?.('button,input,textarea,select,[contenteditable="true"]')) return;
			const mode = event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
			run(() => selectTrackFromHeader(controller, track.id, mode));
		}}
		onKeyDownCapture={handleKeyDown}>
		{selected && <span className="audio-editor-track-header-selection" aria-hidden="true" />}
		<div className="track-control-panel__main">
			<div className="audio-editor-video-track-controls__title track-control-panel__header">
				<span className="audio-editor-video-track-controls__icon" aria-hidden="true"><Icon name="play" size={16} /></span>
				{editingName ? <TrackNameEditor track={track} label={copy.trackName} blocked={blocked}
					controller={controller} run={run} onClose={() => setEditingName(false)} /> :
					<span data-track-name className="track-control-panel__track-name-text" title={track.name}
						onDoubleClick={() => !blocked && setEditingName(true)}>{track.name}</span>}
				<GhostButton ariaLabel={copy.trackMenu || copy.tracksMenu} tabIndex={controlTabIndex}
					onClick={(event) => onMenu(event.currentTarget)} />
			</div>
			<div className="audio-editor-video-track-controls__actions">
				<Button variant="secondary" size="small" showIcon={false} disabled={blocked || !effectsAvailable}
					tabIndex={controlTabIndex} onClick={(event) => { event.stopPropagation(); onOpenEffects(); }}>{copy.effects || 'Effects'}</Button>
				<span data-track-action="mute"><ToggleButton active={Boolean(track.hidden)} disabled={blocked}
					ariaLabel={track.hidden ? (copy.videoVisible || 'Show video') : (copy.videoHidden || 'Hide video')}
					tabIndex={controlTabIndex} size={20} onClick={(event) => {
						event.stopPropagation(); run(() => controller.actions.track.update(track.id, { hidden: !track.hidden }));
					}}>{copy.trackMuteLetter || TIMELINE_ADDITIONAL_COPY.trackMuteLetter}</ToggleButton></span>
				<span data-track-action="solo"><ToggleButton active={Boolean(track.solo)} disabled={blocked}
					ariaLabel={copy.soloTrack || 'Solo'} tabIndex={controlTabIndex} size={20} onClick={(event) => {
						event.stopPropagation(); run(() => controller.actions.track.update(track.id, { solo: !track.solo }));
					}}>{copy.trackSoloLetter || TIMELINE_ADDITIONAL_COPY.trackSoloLetter}</ToggleButton></span>
			</div>
		</div>
	</div>;
}
