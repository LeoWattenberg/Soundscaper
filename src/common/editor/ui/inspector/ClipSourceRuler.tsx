/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState, type PointerEvent } from 'react';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { Icon } from '@soundscaper/design-system/Icon';
import { createClipSourceRulerTicks } from './clip-source-ruler-model.ts';
import type { SourceSelection } from './clip-source-editor-types.ts';
import type { HoldTempoMap } from '../../timeline-time.ts';
import type { SignatureMap } from '../../musical-grid.ts';

export interface SourceRulerOptions {
	readonly global: boolean;
	readonly beats: boolean;
	readonly scroll: boolean;
	readonly pinned: boolean;
	readonly clickToPlay: boolean;
	readonly selectionFollows: boolean;
}
export const INITIAL_SOURCE_RULER_OPTIONS: SourceRulerOptions = {
	global: false, beats: false, scroll: true, pinned: false, clickToPlay: true, selectionFollows: false,
};
interface Props {
	readonly copy: Readonly<Record<string, string>>;
	readonly width: number;
	readonly sampleRate: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly clipStartFrame: number;
	readonly projectStartFrame: number;
	readonly tempoMap: HoldTempoMap;
	readonly signatureMap?: SignatureMap;
	readonly options: SourceRulerOptions;
	readonly playing: boolean;
	readonly positionFrame: number;
	readonly onSeekFrame: (frame: number) => void;
	readonly loop: boolean;
	readonly loopRange: SourceSelection | null;
	readonly selection: SourceSelection | null;
	readonly disabled: boolean;
	readonly onOptions: (options: SourceRulerOptions) => void;
	readonly onPlay: () => void;
	readonly onStop: () => void;
	readonly onLoop: () => void;
	readonly onClearLoop: () => void;
	readonly onLoopSelection: () => void;
	readonly onSelectionLoop: () => void;
	readonly onSeek: (event: PointerEvent<SVGSVGElement>) => void;
}

export default function ClipSourceRuler(props: Props) {
	const { copy, width, startFrame, endFrame, options, onOptions } = props;
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
	const close = () => setMenu(null);
	const set = (changes: Partial<SourceRulerOptions>) => onOptions({ ...options, ...changes });
	const ticks = createClipSourceRulerTicks({ ...props, global: options.global, beats: options.beats });
	const x = (frame: number) => (frame - startFrame) / (endFrame - startFrame) * width;
	const loopRange = props.loopRange ?? props.selection ?? { startFrame, endFrame };
	const item = (label: string, checked: boolean, action: () => void, disabled = false) => <ContextMenuItem
		label={label} checked={checked} disabled={disabled} onClick={action} onClose={close} />;
	return <div className="audio-editor-source-ruler">
		<div className="audio-editor-source-ruler__transport" role="group" aria-label={copy.toolbarTransport}>
			<button type="button" aria-label={props.playing ? copy.pause : copy.play} disabled={props.disabled} onClick={props.onPlay}><Icon name={props.playing ? 'pause' : 'play'} size={16} /></button>
			<button type="button" aria-label={copy.stop} onClick={props.onStop}><Icon name="stop" size={16} /></button>
			<button type="button" aria-label={copy.loop} aria-pressed={props.loop} onClick={props.onLoop}><Icon name="loop" size={16} /></button>
		</div>
		<svg className="audio-editor-source-ruler__scale" role="slider" tabIndex={0} aria-label={copy.clipSourceTimeline}
			aria-valuenow={props.positionFrame / props.sampleRate} aria-valuemin={startFrame / props.sampleRate} aria-valuemax={endFrame / props.sampleRate}
			data-time-origin={options.global ? 'global' : 'local'} width={width} height={40}
			onPointerDown={props.onSeek} onContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }}
			onKeyDown={event => {
				if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
					event.preventDefault(); event.stopPropagation();
					const frame = event.key === 'Home' ? startFrame : event.key === 'End' ? endFrame : props.positionFrame + (event.key === 'ArrowLeft' ? -1 : 1) * Math.round(props.sampleRate * (event.shiftKey ? 1 : 0.1));
					props.onSeekFrame(Math.max(startFrame, Math.min(endFrame, frame)));
				}
				if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
				event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom });
			} }}>
			{(props.loop || props.loopRange) && <rect className="audio-editor-source-ruler__loop" x={x(loopRange.startFrame)} y={0}
				width={x(loopRange.endFrame) - x(loopRange.startFrame)} height={20} opacity={props.loop ? 0.3 : 0.12} />}
			{props.selection && <rect className="audio-editor-source-ruler__selection" x={x(props.selection.startFrame)} y={20}
				width={x(props.selection.endFrame) - x(props.selection.startFrame)} height={20} />}
			{ticks.map(tick => <g key={tick.frame} transform={`translate(${(tick.frame - startFrame) / (endFrame - startFrame) * width},0)`}>
				<line y1={23} y2={40} /><text x={4} y={16}>{tick.label}</text>
			</g>)}
		</svg>
		<ContextMenu isOpen={Boolean(menu)} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={close} autoFocus>
			{item(copy.clipSourceMinutes, !options.beats, () => set({ beats: false }))}
			{item(copy.clipSourceBeats, options.beats, () => set({ beats: true }))}
			<ContextMenuItem isDivider />
			{item(copy.clipSourceGlobalTime, options.global, () => set({ global: true }))}
			{item(copy.clipSourceLocalTime, !options.global, () => set({ global: false }))}
			<ContextMenuItem isDivider />
			{item(copy.updateDisplayWhilePlaying, options.scroll, () => set({ scroll: !options.scroll }))}
			{item(copy.pinnedPlayhead, options.pinned, () => set({ pinned: !options.pinned }))}
			{item(copy.playbackOnRulerClick, options.clickToPlay, () => set({ clickToPlay: !options.clickToPlay }))}
			<ContextMenuItem isDivider />
			<ContextMenuItem label={copy.loopRegion} checked={props.loop} onClick={props.onLoop} onClose={close} hasSubmenu>
				<ContextMenuItem label={copy.clearLoopRegion} onClick={props.onClearLoop} onClose={close} />
				<ContextMenuItem label={copy.loopToSelection} onClick={props.onLoopSelection} onClose={close} />
				<ContextMenuItem label={copy.selectionToLoop} onClick={props.onSelectionLoop} onClose={close} />
				{item(copy.selectionFollowsLoop, options.selectionFollows, () => set({ selectionFollows: !options.selectionFollows }))}
			</ContextMenuItem>
			<ContextMenuItem isDivider />
			{item(copy.showVerticalRulers, true, () => undefined, true)}
		</ContextMenu>
	</div>;
}
