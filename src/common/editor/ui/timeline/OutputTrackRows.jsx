import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';
import { EnvelopeCurve } from '@soundscaper/design-system/EnvelopeCurve';
import { EnvelopeInteractionLayer } from '@soundscaper/design-system/EnvelopeInteractionLayer';
import { TextInput } from '@soundscaper/design-system/TextInput';
import { TrackControlPanel } from '@soundscaper/design-system/TrackControlPanel';

import {
	designValueToPan,
	designVolumeToGainDb,
	framesToSeconds,
	gainDbToDesignVolume,
	panToDesignValue,
} from '../../design-system-adapters.js';
import { timelineContentLeft } from './timeline-scroll-space.ts';
import {
	createEnvelopeValueEvaluator,
	envelopeFramesToDesignPoints,
	envelopeValueToDb,
	mergeDesignEnvelopePoints,
} from '../../automation.js';
import {
	DEFAULT_TRACK_HEIGHT as TRACK_HEIGHT,
	dbToLinear,
	linearToDb,
} from './geometry.ts';
import { COLLAPSED_TRACK_HEIGHT } from './constants.ts';
import { focusFirst, focusPanelControl } from './timeline-navigation.js';
import { TimelineGridLines } from './TimelineGridLines.jsx';
import { OutputTelemetryMeters } from './TrackTelemetryMeters.tsx';

export function OutputTrackDock({
	controller,
	rows,
	focusedOutputKey,
	onFocusOutput,
	onMenu,
	panelWidth,
	trackHeaderWidth = panelWidth,
	verticalRulerWidth,
	viewportWidth,
	timelineWidth,
	scrollX,
	pixelsPerSecond,
	sampleRate,
	rulerScale,
	durationFrames,
	selection,
	height,
	automationToolEnabled,
	stripEnvelopeAvailable,
	blocked,
	mobile,
	copy,
	run,
	onOpenEffects,
}) {
	const dockRef = useRef(null);
	const outputRows = useCallback(() => [
		...(dockRef.current?.querySelectorAll(':scope > [data-output-track-row]') || []),
	], []);
	const focusOutputPanel = useCallback((rowIndex, lastControl = false) => {
		const panel = outputRows()[rowIndex]?.querySelector('.track-control-panel');
		return lastControl ? focusPanelControl(panel, true) : focusFirst(panel);
	}, [outputRows]);
	const focusOutputLane = useCallback((rowIndex) => (
		focusFirst(outputRows()[rowIndex]?.querySelector('[data-output-lane]'))
	), [outputRows]);

	return (
		<div
			ref={dockRef}
			className="audio-editor-output-dock"
			data-output-track-dock
			aria-label={copy.output}
			style={{ height }}
			onDragEnter={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
			onDragOver={(event) => {
				event.preventDefault();
				event.stopPropagation();
				if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
			}}
			onDrop={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			{rows.map(({ key, scope, bus }, rowIndex) => <OutputTrackRow
				key={key}
				controller={controller}
				rowKey={key}
				scope={scope}
				bus={bus}
				focused={focusedOutputKey === key}
				onFocus={() => onFocusOutput(key)}
				onMenu={(anchor) => onMenu(scope, scope === 'master' ? null : bus.id, anchor)}
				onFocusPanel={(lastControl = false) => focusOutputPanel(rowIndex, lastControl)}
				onFocusLane={() => focusOutputLane(rowIndex)}
				onFocusPreviousLane={() => rowIndex > 0 && focusOutputLane(rowIndex - 1)}
				onFocusNextPanel={() => rowIndex + 1 < rows.length && focusOutputPanel(rowIndex + 1)}
				onNavigatePanel={(direction) => {
					const targetIndex = rowIndex + (direction === 'down' ? 1 : -1);
					return targetIndex >= 0 && targetIndex < rows.length && focusOutputPanel(targetIndex);
				}}
				onNavigateLane={(direction) => {
					const targetIndex = rowIndex + (direction === 'down' ? 1 : -1);
					return targetIndex >= 0 && targetIndex < rows.length && focusOutputLane(targetIndex);
				}}
				panelWidth={panelWidth}
				trackHeaderWidth={trackHeaderWidth}
				verticalRulerWidth={verticalRulerWidth}
				viewportWidth={viewportWidth}
				timelineWidth={timelineWidth}
				scrollX={scrollX}
				pixelsPerSecond={pixelsPerSecond}
				sampleRate={sampleRate}
				rulerScale={rulerScale}
				durationFrames={durationFrames}
				selection={selection}
				automationToolEnabled={automationToolEnabled}
				stripEnvelopeAvailable={stripEnvelopeAvailable}
				blocked={blocked}
				mobile={mobile}
				copy={copy}
				run={run}
				onOpenEffects={onOpenEffects}
			/>)}
		</div>
	);
}

export function OutputTrackRow({
	controller,
	rowKey,
	scope,
	bus,
	focused,
	onFocus,
	onMenu,
	onFocusPanel,
	onFocusLane,
	onFocusPreviousLane,
	onFocusNextPanel,
	onNavigatePanel,
	onNavigateLane,
	panelWidth,
	trackHeaderWidth = panelWidth,
	verticalRulerWidth,
	viewportWidth,
	timelineWidth,
	scrollX,
	pixelsPerSecond,
	sampleRate,
	rulerScale,
	durationFrames,
	selection,
	automationToolEnabled,
	stripEnvelopeAvailable,
	blocked,
	mobile,
	copy,
	run,
	onOpenEffects,
}) {
	const canonicalDurationFrames = Math.max(1, durationFrames);
	const envelopeStartFrame = Math.max(0, Math.min(
		canonicalDurationFrames - 1,
		Math.floor(scrollX / pixelsPerSecond * sampleRate),
	));
	const envelopeEndFrame = Math.max(
		envelopeStartFrame + 1,
		Math.min(
			canonicalDurationFrames,
			Math.ceil((scrollX + viewportWidth) / pixelsPerSecond * sampleRate),
		),
	);
	const envelopeDurationFrames = envelopeEndFrame - envelopeStartFrame;
	const envelopeDurationSeconds = framesToSeconds(envelopeDurationFrames, { sampleRate });
	const envelopeLeft = CLIP_CONTENT_OFFSET
		+ framesToSeconds(envelopeStartFrame, { sampleRate }) * pixelsPerSecond;
	const envelopeWidth = Math.max(1, envelopeDurationSeconds * pixelsPerSecond);
	const rowHeight = bus.collapsed === false ? TRACK_HEIGHT : COLLAPSED_TRACK_HEIGHT;
	const canonicalPoints = useMemo(() => {
		const projected = envelopeFramesToDesignPoints(bus.envelope, sampleRate, {
			startFrame: envelopeStartFrame,
			endFrame: envelopeEndFrame,
		});
		const evaluate = createEnvelopeValueEvaluator(bus.envelope, canonicalDurationFrames);
		const withBoundaries = [...projected];
		if (!withBoundaries.some((point) => point.time === 0)) {
			withBoundaries.unshift({ time: 0, db: envelopeValueToDb(evaluate(envelopeStartFrame)) });
		}
		if (!withBoundaries.some((point) => Math.abs(point.time - envelopeDurationSeconds) < 1e-6)) {
			withBoundaries.push({
				time: envelopeDurationSeconds,
				db: envelopeValueToDb(evaluate(envelopeEndFrame)),
			});
		}
		return withBoundaries;
	}, [
		bus.envelope,
		canonicalDurationFrames,
		envelopeDurationSeconds,
		envelopeEndFrame,
		envelopeStartFrame,
		sampleRate,
	]);
	const previewRef = useRef(null);
	const rowRef = useRef(null);
	const [previewPoints, setPreviewPoints] = useState(null);
	const [envelopeEditActive, setEnvelopeEditActive] = useState(false);
	const displayedPoints = previewPoints || canonicalPoints;
	const curvePoints = displayedPoints;
	const update = useCallback((changes) => {
		if (scope === 'master') return controller.actions.mixer.updateMaster(changes);
		return controller.actions.mixer.updateBus(scope, bus.id, changes);
	}, [bus.id, controller, scope]);

	useEffect(() => {
		if (!stripEnvelopeAvailable || !envelopeEditActive) return undefined;
		const finishEnvelopeEdit = () => globalThis.setTimeout(() => {
			const points = previewRef.current;
			setEnvelopeEditActive(false);
			if (!points) return;
			previewRef.current = null;
			setPreviewPoints(null);
			run(() => update({
				envelope: mergeDesignEnvelopePoints(
					bus.envelope,
					points,
					sampleRate,
					canonicalDurationFrames,
					{
						startFrame: envelopeStartFrame,
						endFrame: envelopeEndFrame,
						maximumValue: 16,
					},
				),
			}));
		}, 0);
		document.addEventListener('mouseup', finishEnvelopeEdit);
		return () => document.removeEventListener('mouseup', finishEnvelopeEdit);
	}, [bus.envelope, canonicalDurationFrames, envelopeEditActive, envelopeEndFrame, envelopeStartFrame, run, sampleRate, stripEnvelopeAvailable, update]);

	useEffect(() => {
		if (automationToolEnabled) return;
		previewRef.current = null;
		setPreviewPoints(null);
		setEnvelopeEditActive(false);
	}, [automationToolEnabled]);
	useEffect(() => {
		if (previewRef.current === null) setPreviewPoints(null);
	}, [bus.envelope]);

	const lineColor = scope === 'group' ? '#3975ad' : scope === 'send' ? '#7854b8' : '#7f8996';
	return (
		<div
			ref={rowRef}
			className="audio-editor-output-track-row"
			data-output-track-row
			data-output-scope={scope}
			data-output-id={scope === 'master' ? 'master' : bus.id}
			data-output-key={rowKey}
			data-collapsed={bus.collapsed === false ? 'false' : 'true'}
			data-focused={focused ? 'true' : 'false'}
			style={{ height: rowHeight, '--output-track-color': lineColor }}
		>
			<OutputTrackControls
				controller={controller}
				scope={scope}
				bus={bus}
				trackHeight={rowHeight}
				panelWidth={panelWidth}
				trackHeaderWidth={trackHeaderWidth}
				focused={focused}
				onFocus={onFocus}
				onMenu={onMenu}
				onFocusPanel={onFocusPanel}
				onTabOut={onFocusLane}
				onShiftTabOut={onFocusPreviousLane}
				onNavigateVertical={onNavigatePanel}
				blocked={blocked}
				mobile={mobile}
				copy={copy}
				run={run}
				update={update}
				onOpenEffects={onOpenEffects}
			/>
			<div
				className="audio-editor-output-lane-viewport"
				style={{ left: panelWidth, right: verticalRulerWidth, width: viewportWidth }}
			>
				{rulerScale && <TimelineGridLines
					variant="fill"
					scale={rulerScale}
					pixelsPerSecond={pixelsPerSecond}
					scrollX={scrollX}
					viewportWidth={viewportWidth}
					height={rowHeight}
					sampleRate={sampleRate}
				/>}
				<div
					className="audio-editor-output-lane"
					data-output-lane
					data-output-scope={scope}
					data-output-id={scope === 'master' ? 'master' : bus.id}
					role="region"
					tabIndex={0}
					aria-label={`${scope === 'master' ? copy.master : bus.name}: ${stripEnvelopeAvailable ? copy.volumeEnvelope || copy.clipGain : copy.output}`}
					style={{
						width: timelineWidth,
						height: rowHeight,
						transform: `translate3d(calc(${-scrollX}px - var(--timeline-render-origin-x, 0px)), 0, 0)`,
					}}
					onFocus={onFocus}
					onKeyDown={(event) => {
						if (event.key === 'Tab') {
							const moved = event.shiftKey ? onFocusPanel() : onFocusNextPanel();
							if (!moved) return;
							event.preventDefault();
							event.stopPropagation();
						} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
							if (!onNavigateLane(event.key === 'ArrowDown' ? 'down' : 'up')) return;
							event.preventDefault();
							event.stopPropagation();
						} else if (event.key === 'Escape') {
							event.preventDefault();
							event.stopPropagation();
							onFocusPanel();
						} else if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
							event.preventDefault();
							event.stopPropagation();
							const anchor = rowRef.current?.querySelector('[aria-label="Track menu"]')
								|| rowRef.current?.querySelector('.track-control-panel');
							onMenu(anchor);
						}
					}}
				>
					{selection && <div
						className="audio-editor-output-time-selection"
						aria-hidden="true"
						style={{
							left: timelineContentLeft(CLIP_CONTENT_OFFSET + selection.startTime * pixelsPerSecond),
							width: Math.max(1, (selection.endTime - selection.startTime) * pixelsPerSecond),
						}}
					/>}
					{stripEnvelopeAvailable && <div
						className="audio-editor-output-envelope"
						style={{ left: timelineContentLeft(envelopeLeft), width: envelopeWidth }}
						onMouseDownCapture={(event) => {
							if (event.button === 0 && automationToolEnabled && !blocked) setEnvelopeEditActive(true);
						}}
					>
						<EnvelopeCurve
							points={curvePoints}
							x={0}
							y={0}
							width={envelopeWidth}
							height={rowHeight}
							startTime={0}
							duration={envelopeDurationSeconds}
							pixelsPerSecond={pixelsPerSecond}
							lineColor={lineColor}
							pointColor="#ffffff"
							active={false}
						/>
						<EnvelopeInteractionLayer
							envelopePoints={displayedPoints}
							onEnvelopePointsChange={(points) => {
								if (blocked || !automationToolEnabled) return;
								previewRef.current = points;
								setPreviewPoints(points);
								setEnvelopeEditActive(true);
							}}
							enabled={automationToolEnabled && !blocked}
							width={envelopeWidth}
							height={rowHeight}
							duration={envelopeDurationSeconds}
						/>
					</div>}
					<div
						className="audio-editor-output-playhead"
						aria-hidden="true"
					/>
				</div>
			</div>
			{verticalRulerWidth > 0 && <div
				className="audio-editor-output-ruler"
				aria-hidden="true"
				style={{ width: verticalRulerWidth }}
			/>}
		</div>
	);
}

export function OutputTrackControls({
	controller,
	scope,
	bus,
	trackHeight,
	panelWidth,
	trackHeaderWidth = panelWidth,
	focused,
	onFocus,
	onMenu,
	onFocusPanel,
	onTabOut,
	onShiftTabOut,
	onNavigateVertical,
	blocked,
	mobile,
	copy,
	run,
	update,
	onOpenEffects,
}) {
	const controlsRef = useRef(null);
	const [editingName, setEditingName] = useState(false);
	const label = scope === 'master' ? copy.master : bus.name;
	return (
		<div
			ref={controlsRef}
			className="audio-editor-track-controls audio-editor-output-track-controls"
			data-output-track-header
			style={{ width: trackHeaderWidth }}
			onKeyDownCapture={(event) => {
				const panel = controlsRef.current?.querySelector('.track-control-panel');
				if (event.key !== 'Tab' || event.target !== panel) return;
				const moved = event.shiftKey ? onShiftTabOut?.() : onTabOut?.();
				if (moved) event.preventDefault();
				event.stopPropagation();
			}}
			onDoubleClick={(event) => {
				if (scope === 'master' || blocked || !(event.target instanceof Element)) return;
				if (event.target.closest('.track-control-panel__track-name-text')) setEditingName(true);
			}}
		>
			<TrackControlPanel
				trackName={label}
				trackType="stereo"
				volume={gainDbToDesignVolume(linearToDb(bus.gain))}
				pan={panToDesignValue(bus.pan)}
				isMuted={Boolean(bus.mute)}
				isSolo={Boolean(bus.solo)}
				isFocused={focused}
				height={bus.collapsed === false ? (mobile ? 'truncated' : 'default') : 'collapsed'}
				trackHeight={trackHeight}
				meterContent={<OutputTelemetryMeters
					controller={controller}
					scope={scope}
					busId={scope === 'master' ? undefined : bus.id}
				/>}
				tabIndex={0}
				onVolumeChange={(volume) => !blocked && run(() => update({
					gain: dbToLinear(designVolumeToGainDb(volume)),
				}))}
				onPanChange={(pan) => !blocked && run(() => update({ pan: designValueToPan(pan) }))}
				onMuteToggle={() => !blocked && run(() => update({ mute: !bus.mute }))}
				onSoloToggle={() => !blocked && run(() => update({ solo: !bus.solo }))}
				onEffectsClick={() => onOpenEffects?.(
					scope === 'master' ? null : bus.id,
					controlsRef.current?.getBoundingClientRect() || null,
					scope,
				)}
				onMenuClick={(event) => onMenu(event.currentTarget)}
				onClick={onFocus}
				onFocusChange={(hasFocus) => hasFocus && onFocus()}
				onNavigateVertical={onNavigateVertical}
				onTabOut={onTabOut}
				onShiftTabOut={() => {
					const panel = controlsRef.current?.querySelector('.track-control-panel');
					if (document.activeElement !== panel) return onFocusPanel?.();
					return onShiftTabOut?.();
				}}
			/>
			{editingName && <OutputTrackNameEditor
				name={bus.name}
				label={copy.trackName}
				blocked={blocked}
				onCommit={(name) => run(() => update({ name }))}
				onClose={() => setEditingName(false)}
			/>}
		</div>
	);
}

export function OutputTrackNameEditor({ name: initialName, label, blocked, onCommit, onClose }) {
	const editorRef = useRef(null);
	const [name, setName] = useState(initialName);
	useEffect(() => setName(initialName), [initialName]);
	useEffect(() => {
		const input = editorRef.current?.querySelector('input');
		input?.focus();
		input?.select();
	}, []);
	const commit = () => {
		const nextName = name.trim();
		if (nextName && nextName !== initialName) onCommit(nextName);
		onClose();
	};
	return (
		<label
			ref={editorRef}
			className="audio-editor-output-name-editor"
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					event.currentTarget.querySelector('input')?.blur();
				} else if (event.key === 'Escape') {
					event.preventDefault();
					setName(initialName);
					onClose();
				}
			}}
		>
			<span className="kw-audio-editor-sr-only">{label}: {initialName}</span>
			<TextInput value={name} disabled={blocked} width="100%" onChange={setName} />
		</label>
	);
}
