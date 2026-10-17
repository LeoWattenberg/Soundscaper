/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ComponentProps, ReactNode } from 'react';
import {
	EndGlyph, FadeGlyph, LengthGlyph, StartGlyph, TrimEndGlyph, TrimStartGlyph,
} from '@soundscaper/design-system/ClipPropertiesPanel/clip-properties-glyphs';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import EditorMusicalTimeCodeProvider from '../EditorMusicalTimeCodeProvider.tsx';

interface TimeClip {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly fadeInShape?: number;
	readonly fadeOutShape?: number;
}
interface Options {
	readonly controller?: ComponentProps<typeof EditorMusicalTimeCodeProvider>['controller'];
	readonly clip: TimeClip;
	readonly source: Readonly<{ sampleRate?: number; frameCount?: number }>;
	readonly sampleRate: number;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly onStart?: (projectFrames: number) => unknown;
	readonly onDuration?: (projectFrames: number) => unknown;
	readonly onTrimStart?: (sourceFrames: number) => unknown;
	readonly onTrimEnd?: (hiddenSourceFrames: number) => unknown;
	readonly onFade?: (side: 'in' | 'out', projectFrames: number) => unknown;
}
type Slot = 'start' | 'length' | 'end' | 'trim-start' | 'trim-end' | 'fade-in' | 'fade-out';

/** One native timecode per glyph slot; callbacks retain their owning sample clock. */
export function clipPropertiesTimeFields({ controller, clip, source, sampleRate, copy, disabled,
	onStart, onDuration, onTrimStart, onTrimEnd, onFade }: Options): Readonly<Record<Slot, ReactNode>> {
	const sourceRate = source.sampleRate || sampleRate;
	const sourceFrames = source.frameCount ?? clip.sourceStartFrame + clip.sourceDurationFrames;
	const field = (slot: Slot, name: string, label: string, value: number, glyph: ReactNode,
		onCommit: ((frames: number) => unknown) | undefined, rate = sampleRate,
		minimum = 0, maximum = Infinity, duration = false) => <div key={slot}
		className="clip-properties__field clip-properties__field--timecode"
		data-clip-properties-field={slot} data-clip-field={name} data-tooltip={label}>
		<span className="clip-properties__glyph-cell">{glyph}</span>
		<EditorMusicalTimeCodeProvider controller={controller} originFrame={duration ? clip.timelineStartFrame : undefined}>
			<AudioEditorTimeCodeInput label={label} value={value} unit="samples" rate={rate} sampleRate={rate}
				format="hh:mm:ss+milliseconds" minimum={minimum} maximum={maximum}
				disabled={disabled || !onCommit} onCommit={onCommit} />
		</EditorMusicalTimeCodeProvider>
		<span className="clip-properties__sr">{label}</span>
	</div>;
	return {
		start: field('start', 'startFrame', copy.clipStart!, clip.timelineStartFrame, <StartGlyph />, onStart),
		length: field('length', 'durationFrame', copy.clipDuration!, clip.durationFrames, <LengthGlyph />, onDuration,
			sampleRate, 1, Infinity, true),
		end: field('end', 'endFrame', copy.clipEnd!, clip.timelineStartFrame + clip.durationFrames, <EndGlyph />, undefined),
		'trim-start': field('trim-start', 'sourceInFrame', copy.clipTrimStart!, clip.sourceStartFrame, <TrimStartGlyph />,
			onTrimStart, sourceRate, 0, sourceFrames),
		'trim-end': field('trim-end', 'trimEndFrame', copy.clipTrimEnd!,
			Math.max(0, sourceFrames - clip.sourceStartFrame - clip.sourceDurationFrames), <TrimEndGlyph />,
			onTrimEnd, sourceRate, 0, sourceFrames),
		'fade-in': field('fade-in', 'fadeInFrame', copy.fadeIn!, clip.fadeInFrames ?? 0,
			<FadeGlyph side="in" shape={clip.fadeInShape ?? 'linear'} title={copy.fadeIn!} />,
			onFade && (frames => onFade('in', frames)), sampleRate, 0, clip.durationFrames, true),
		'fade-out': field('fade-out', 'fadeOutFrame', copy.fadeOut!, clip.fadeOutFrames ?? 0,
			<FadeGlyph side="out" shape={clip.fadeOutShape ?? 'linear'} title={copy.fadeOut!} />,
			onFade && (frames => onFade('out', frames)), sampleRate, 0, clip.durationFrames, true),
	};
}
