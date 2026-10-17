/* SPDX-License-Identifier: AGPL-3.0-only */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { ClipFadeOverlays } from '../timeline/ClipFadeOverlays.tsx';
import type { ClipFadeChanges } from '../timeline/ClipFadeOverlays.tsx';
import type { FadeClip } from '../timeline/clip-fade-geometry.ts';

const ClipFadesDialog = lazy(() => import('../timeline/ClipFadesDialog.tsx'));
const NO_PREVIEW = (_changes: ClipFadeChanges | null) => undefined;

interface Props {
	readonly rootRef: RefObject<HTMLDivElement | null>;
	readonly clip: FadeClip & { readonly id: string };
	readonly startFrame: number;
	readonly endFrame: number;
	readonly width: number;
	readonly sampleRate: number;
	readonly blocked: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly onPreview?: (changes: ClipFadeChanges | null) => void;
	readonly onChange: (id: string, changes: ClipFadeChanges) => void;
}
const NO_CROSSFADES: ReadonlySet<string> = new Set();

/** The same fade curves and grips as the timeline, cropped to the source viewport. */
export default function ClipSourceFades({ rootRef, clip, startFrame, endFrame, width, sampleRate, blocked, copy, onChange, onPreview = NO_PREVIEW }: Props) {
	const [mounted, setMounted] = useState(false);
	const [editingClip, setEditingClip] = useState<(FadeClip & { readonly id: string }) | null>(null);
	const close = useCallback(() => { setEditingClip(null); onPreview(null); }, [onPreview]);
	const preview = useCallback((changes: ClipFadeChanges) => onPreview(changes), [onPreview]);
	useEffect(() => { setMounted(true); }, []);
	const clips = useMemo(() => [{ ...clip, kind: 'audio' }], [clip]);
	const selectedIds = useMemo(() => new Set([clip.id]), [clip.id]);
	const first = Math.max(startFrame, clip.timelineStartFrame);
	const last = Math.min(endFrame, clip.timelineStartFrame + clip.durationFrames);
	return <>
		<div className="audio-editor-source-fade-target" data-clip-id={clip.id} tabIndex={-1}
			style={{ left: (first - startFrame) / (endFrame - startFrame) * width, width: Math.max(0, last - first) / (endFrame - startFrame) * width }} />
		{mounted && <ClipFadeOverlays rootRef={rootRef} clips={clips} selectedIds={selectedIds} startFrame={startFrame} endFrame={endFrame}
			pixelsPerSecond={width * sampleRate / (endFrame - startFrame)} sampleRate={sampleRate} blocked={blocked} showFadeShapeHandles
			crossfadedFadeEdges={NO_CROSSFADES} handleTabIndex={0} onChange={onChange} onEditFades={() => setEditingClip(clip)} onTabOut={() => rootRef.current?.focus()}
			copy={{ ...copy, fadeIn: copy.fadeIn, fadeOut: copy.fadeOut, fadeInShape: copy.fadeInShape, fadeOutShape: copy.fadeOutShape, legacyLinearFadeShape: copy.legacyLinearFadeShape }} />}
		{editingClip && <div onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}><Suspense fallback={null}><ClipFadesDialog portalHost={rootRef.current?.closest('[data-audio-editor]')} clip={editingClip} sampleRate={sampleRate} copy={copy} blocked={blocked}
			onPreview={preview} onClose={close} onApply={changes => onChange(editingClip.id, changes)} /></Suspense></div>}
	</>;
}
