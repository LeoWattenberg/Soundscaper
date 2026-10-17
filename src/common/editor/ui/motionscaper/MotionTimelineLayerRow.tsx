/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';
import type { MotionLayer } from '../../motion-composition.ts';

export default function MotionTimelineLayerRow({ layer, durationFrames, checked, busy, copy, onSelect, onMove }: Readonly<{
	layer: MotionLayer; durationFrames: number; checked: boolean; busy: boolean; copy: Readonly<Record<string, string>>;
	onSelect: (checked: boolean) => void; onMove: (deltaFrames: number) => void;
}>) {
	const drag = useRef<{ start: number; width: number; delta: number } | null>(null); const [offset, setOffset] = useState(0);
	const first = Math.max(0, layer.inFrame.num / layer.inFrame.den); const end = Math.min(durationFrames, layer.outFrame.num / layer.outFrame.den);
	const finish = (commit: boolean) => { const delta = drag.current?.delta ?? 0; drag.current = null; setOffset(0); if (commit && delta !== 0) onMove(delta); };
	return <li className="motionscaper-timeline-row" data-motion-layer-row={layer.id} data-motion-in={`${layer.inFrame.num}/${layer.inFrame.den}`}>
		<label><input type="checkbox" checked={checked} disabled={busy} onChange={(event) => onSelect(event.currentTarget.checked)} />{layer.name}</label>
		<span>{copy[`motionscaperKind_${layer.kind}`]}</span>
		<div className="motionscaper-timeline-track">
			<button type="button" className="motionscaper-timeline-bar" disabled={busy} aria-label={`${layer.name} ${copy.motionscaperTiming}`}
				style={{ left: `${Math.min(100, first / durationFrames * 100)}%`, width: `${Math.max(0, end - first) / durationFrames * 100}%`, transform: `translateX(${offset}px)` }}
				onKeyDown={(event) => {
					if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.altKey && !event.ctrlKey && !event.metaKey) {
						event.preventDefault(); onMove((event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1));
					}
				}}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					drag.current = { start: event.clientX, width: event.currentTarget.parentElement!.getBoundingClientRect().width, delta: 0 };
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={(event) => {
					if (!drag.current) return;
					const delta = Math.round((event.clientX - drag.current.start) / drag.current.width * durationFrames);
					drag.current.delta = delta; setOffset(delta / durationFrames * drag.current.width);
				}}
				onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)}>
				{layer.inFrame.num / layer.inFrame.den}–{layer.outFrame.num / layer.outFrame.den}
			</button>
		</div>
	</li>;
}
