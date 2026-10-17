/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { MotionVector2 } from '../../motion-property.ts';
import type { MotionTrackingSource } from '../../motion-tracking-authority.ts';
import { motionTrackingSourceTime } from '../../motion-tracking-authority.ts';
import { createMotionMediaProvider } from '../../motion-media-provider.ts';
import { motionSurfaceToRgba8 } from '../../motion-surface.ts';
import { loadMotionscaperAssetBytes, type MotionAssetReader } from '../../../../motionscaper/editor-render-resources.ts';
interface Drag { readonly pointerId: number; readonly index: number; readonly original: readonly MotionVector2[] }
export default function MotionTrackingFrame({ copy, source, store, frame, points, disabled, onPoints }: Readonly<{
	copy: Readonly<Record<string, string>>; source: MotionTrackingSource; store: MotionAssetReader; frame: number;
	points: readonly MotionVector2[]; disabled: boolean; onPoints: (points: readonly MotionVector2[]) => void;
}>) {
	const canvas = useRef<HTMLCanvasElement>(null), svg = useRef<SVGSVGElement>(null), drag = useRef<Drag | null>(null);
	const [error, setError] = useState<string | null>(null), [ready, setReady] = useState(false);
	const { width, height } = source.asset;
	useEffect(() => {
		if (disabled) return;
		const abort = new AbortController(); const provider = createMotionMediaProvider({ loadAsset: (asset, signal) => loadMotionscaperAssetBytes(asset, store, signal) });
		setReady(false); setError(null);
		void (async () => {
			try {
				const surface = await provider.decodeFootage(source.asset, motionTrackingSourceTime(source.composition, source.layer, frame), abort.signal);
				abort.signal.throwIfAborted(); const context = canvas.current?.getContext('2d'); if (!context || !canvas.current) return;
				canvas.current.width = width; canvas.current.height = height;
				context.putImageData(new ImageData(new Uint8ClampedArray(motionSurfaceToRgba8(surface, 'srgb')), width, height), 0, 0); setReady(true);
			} catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : copy.motionscaperTrackingFailed!); }
			finally { provider.dispose(); }
		})();
		return () => { abort.abort(); provider.dispose(); };
	}, [source.asset, source.composition, source.layer, store, frame, disabled, width, height, copy]);
	const change = (index: number, point: MotionVector2) => onPoints(points.map((value, offset) => offset === index ? point : value));
	const move = (event: PointerEvent<SVGSVGElement>) => {
		const active = drag.current, box = svg.current?.getBoundingClientRect(); if (disabled || !active || active.pointerId !== event.pointerId || !box) return;
		change(active.index, [Math.max(0, Math.min(width - 1, (event.clientX - box.left) * width / box.width)), Math.max(0, Math.min(height - 1, (event.clientY - box.top) * height / box.height))]);
	};
	return <>
		<div style={{ position: 'relative', width: '100%', maxWidth: 640, aspectRatio: `${width}/${height}`, marginInline: 'auto' }}>
			<canvas ref={canvas} width={width} height={height} aria-label={copy.motionscaperTrackingRawFrame} style={{ width: '100%', height: '100%', display: 'block' }}
				data-motion-tracking-frame={ready ? frame : undefined} />
			<svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={copy.motionscaperTrackingPoint} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
				onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { const active = drag.current; drag.current = null; if (active) onPoints(active.original); }}>
				{points.length === 4 && <polygon points={points.map(point => point.join(',')).join(' ')} fill="none" stroke="#ffd740" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
				{points.map(([x, y], index) => <circle key={index} cx={x} cy={y} r={Math.max(width, height) / 90} fill="#ffd740" stroke="#111" strokeWidth={1} vectorEffect="non-scaling-stroke"
					role="button" aria-label={`${copy.motionscaperTrackingPoint} ${index + 1}`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} data-motion-tracking-point={index}
					onPointerDown={(event) => { if (disabled || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); svg.current?.setPointerCapture(event.pointerId); drag.current = { pointerId: event.pointerId, index, original: points }; }}
					onKeyDown={(event) => { if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const step = event.shiftKey ? 10 : 1;
						change(index, [x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)]); }} />)}
			</svg>
		</div>
		{error && <p role="alert">{copy.motionscaperTrackingFailed} {error}</p>}
	</>;
}
