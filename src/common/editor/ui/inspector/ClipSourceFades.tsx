/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { ClipFadeOverlays } from '../timeline/ClipFadeOverlays.tsx';
import type { ClipFadeChanges } from '../timeline/ClipFadeOverlays.tsx';
import type { FadeClip } from '../timeline/clip-fade-geometry.ts';

interface Props {
	readonly rootRef: RefObject<HTMLDivElement | null>;
	readonly clip: FadeClip & { readonly id: string };
	readonly startFrame: number;
	readonly endFrame: number;
	readonly width: number;
	readonly sampleRate: number;
	readonly blocked: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly onChange: (id: string, changes: ClipFadeChanges) => void;
}
const NO_CROSSFADES: ReadonlySet<string> = new Set();

/** The same fade curves and grips as the timeline, cropped to the source viewport. */
export default function ClipSourceFades({ rootRef, clip, startFrame, endFrame, width, sampleRate, blocked, copy, onChange }: Props) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => { setMounted(true); }, []);
	const clips = useMemo(() => [{ ...clip, kind: 'audio' }], [clip]);
	const selectedIds = useMemo(() => new Set([clip.id]), [clip.id]);
	const first = Math.max(startFrame, clip.timelineStartFrame);
	const last = Math.min(endFrame, clip.timelineStartFrame + clip.durationFrames);
	return <>
		<div className="audio-editor-source-fade-target" data-clip-id={clip.id}
			style={{ left: (first - startFrame) / (endFrame - startFrame) * width, width: Math.max(0, last - first) / (endFrame - startFrame) * width }} />
		{mounted && <ClipFadeOverlays rootRef={rootRef} clips={clips} selectedIds={selectedIds} startFrame={startFrame} endFrame={endFrame}
			pixelsPerSecond={width * sampleRate / (endFrame - startFrame)} sampleRate={sampleRate} blocked={blocked} showFadeShapeHandles
			crossfadedFadeEdges={NO_CROSSFADES} handleTabIndex={0} onChange={onChange} onTabOut={() => rootRef.current?.focus()}
			copy={{ ...copy, fadeIn: copy.fadeIn, fadeOut: copy.fadeOut, fadeInShape: copy.fadeInShape, fadeOutShape: copy.fadeOutShape, legacyLinearFadeShape: copy.legacyLinearFadeShape }} />}
	</>;
}
