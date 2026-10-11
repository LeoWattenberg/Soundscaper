/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createMotionPreviewClient } from '../../controller/composition/motion-preview-client.ts';
import type { MotionPreviewClient } from '../../controller/composition/motion-preview-types.ts';
import { createMotionMediaProvider } from '../../motion-media-provider.ts';
import { divideRationals, type Rational } from '../../timeline-time.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import { loadMotionscaperAssetBytes, type MotionAssetReader } from '../../../../motionscaper/editor-render-resources.ts';
interface CanvasRequest { readonly project: MotionscaperProject; readonly compositionId: string; readonly frame: Rational }
/** One persistent preview client, one replaceable draft, and no authored publication from pointer motion. */
export function useMotionCanvasPreview(canvas: RefObject<HTMLCanvasElement | null>, request: CanvasRequest, store: MotionAssetReader): Readonly<{ error: string | null; ready: boolean }> {
	const [error, setError] = useState<string | null>(null); const [ready, setReady] = useState(false);
	const submit = useRef<((request: CanvasRequest) => void) | null>(null); const latest = useRef(request); latest.current = request;
	useEffect(() => {
		let disposed = false; let client: MotionPreviewClient | null = null; let pending: CanvasRequest | null = null; let draining = false;
		const loadAsset = (asset: Parameters<typeof loadMotionscaperAssetBytes>[0], signal?: AbortSignal) => loadMotionscaperAssetBytes(asset, store, signal);
		const provider = createMotionMediaProvider({ loadAsset });
		const drain = async () => {
			if (draining || !client) return; draining = true;
			try {
				while (pending && !disposed) {
					const next = pending; pending = null; setError(null);
					const composition = next.project.compositions.find(item => item.id === next.compositionId); if (!composition) continue;
					try {
						await client.setProject(next.project, loadAsset, provider.decodeFootage);
						if (!pending && !disposed) await client.seek({ compositionId: next.compositionId, time: divideRationals(next.frame, composition.frameRate) });
					} catch (failure) { if (!pending && !disposed) setError(failure instanceof Error ? failure.message : String(failure)); }
				}
			} finally { draining = false; }
		};
		submit.current = next => { pending = next; client?.pause(); void drain(); };
		void (async () => {
			try {
				client = await createMotionPreviewClient({ onState: state => { if (!disposed && state.status === 'error') setError(state.error); },
					onFrame: frame => {
						if (disposed || pending || !canvas.current) return; const context = canvas.current.getContext('2d');
						if (!context) throw new Error('Canvas preview is unavailable.');
						canvas.current.width = frame.width; canvas.current.height = frame.height;
						context.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
						canvas.current.dataset.motionRendered = String(frame.revision); setReady(true);
					} });
				if (disposed) { client.dispose(); return; } pending = latest.current; await drain();
			} catch (failure) { if (!disposed) setError(failure instanceof Error ? failure.message : String(failure)); }
		})();
		return () => { disposed = true; pending = null; submit.current = null; client?.dispose(); provider.dispose(); };
	}, [canvas, store]);
	useEffect(() => { submit.current?.(request); }, [request]);
	return { error, ready };
}
