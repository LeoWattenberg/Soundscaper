/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMotionPreviewRenderSession, type MotionPreviewSessionOptions } from './controller/composition/motion-preview-render-session.ts';
import type { MotionPreviewBackend } from './controller/composition/motion-preview-types.ts';
import type { MotionSurface } from './motion-surface.ts';
import { validateMotionSurface } from './motion-surface.ts';
import type { Rational } from './timeline-time.ts';
import type { MotionPreviewWorkerRequest, MotionPreviewWorkerScope } from './motion-preview-worker-protocol.ts';

/** Worker resources are bounded to one outstanding host request and one outstanding frame. */
export function createMotionPreviewWorkerRuntime(scope: MotionPreviewWorkerScope, sessionFactory: (options: MotionPreviewSessionOptions) => MotionPreviewBackend = createMotionPreviewRenderSession) {
	let session: MotionPreviewBackend | null = null; let disposed = false;
	let active: { id: number; controller: AbortController } | null = null; let resourceId = 0;
	const resources = new Map<number, { resolve(value: Uint8Array | MotionSurface): void; reject(error: Error): void }>();
	const listener = (event: MessageEvent<MotionPreviewWorkerRequest>): void => { void handle(event.data).catch((error: unknown) => {
		const request = event.data;
		if ('requestId' in request) fail(request.requestId, error);
	}); };
	scope.addEventListener('message', listener);
	return { dispose };

	async function handle(message: MotionPreviewWorkerRequest): Promise<void> {
		if (disposed) return;
		if (message.type === 'dispose') { dispose(); return; }
		if (message.type === 'asset-result' || message.type === 'footage-result' || message.type === 'resource-error') {
			const pending = resources.get(message.resourceId); if (!pending) return; resources.delete(message.resourceId);
			if (message.type === 'resource-error') { const error = new Error(message.message); error.name = message.name; pending.reject(error); }
			else if (message.type === 'asset-result') pending.resolve(message.bytes);
			else { try { validateMotionSurface(message.surface); pending.resolve(message.surface); } catch (error) { pending.reject(asError(error)); } }
			return;
		}
		if (!Number.isSafeInteger(message.requestId) || message.requestId < 1) throw new TypeError('Motion worker request identity is invalid.');
		if (message.type === 'cancel') { if (active?.id === message.requestId) { active.controller.abort(); rejectResources(); } return; }
		if (active) throw new Error('Motion preview worker already has a frame in flight.');
		if (message.type === 'project') {
			session?.dispose();
			session = sessionFactory({ backend: 'worker-cpu', maximumAssetBytes: message.maximumAssetBytes, maximumWorkingBytes: message.maximumWorkingBytes,
				...(typeof OffscreenCanvas === 'function' ? { createCanvas: () => new OffscreenCanvas(1, 1) } : {}) });
			const backend = await session.setProject(message.project, async (asset) => {
				const value = await demand('asset', asset.id); if (!(value instanceof Uint8Array)) throw new TypeError('Motion worker received invalid asset bytes.'); return value;
			}, new AbortController().signal, message.hasFootageDecoder ? async (asset, time) => {
				const value = await demand('footage', asset.id, time); if (value instanceof Uint8Array) throw new TypeError('Motion worker received invalid footage pixels.'); return value;
			} : undefined);
			scope.postMessage({ type: 'ready', requestId: message.requestId, backend }); return;
		}
		if (message.type !== 'render' || !session) throw new Error('Motion worker requires a project before rendering.');
		const controller = new AbortController(); active = { id: message.requestId, controller };
		try {
			const frame = await session.render(message, controller.signal); controller.signal.throwIfAborted();
			if (!(frame.rgba.buffer instanceof ArrayBuffer)) throw new TypeError('Motion worker frame requires transferable storage.');
			scope.postMessage({ type: 'frame', requestId: message.requestId, frame }, [frame.rgba.buffer]);
		} finally { active = null; rejectResources(); }
	}
	function demand(type: 'asset' | 'footage', assetId: string, time?: Rational): Promise<Uint8Array | MotionSurface> {
		if (!active || disposed) return Promise.reject(new Error('Motion worker resource request has no active frame.'));
		active.controller.signal.throwIfAborted();
		if (resources.size > 0) return Promise.reject(new Error('Motion worker resource queue exceeds its one-request budget.'));
		const id = ++resourceId; const requestId = active.id;
		return new Promise((resolve, reject) => { resources.set(id, { resolve, reject });
			if (type === 'footage' && time) scope.postMessage({ type, requestId, resourceId: id, assetId, time });
			else scope.postMessage({ type: 'asset', requestId, resourceId: id, assetId });
		});
	}
	function rejectResources(): void { for (const resource of resources.values()) resource.reject(new DOMException('Motion preview was cancelled.', 'AbortError')); resources.clear(); }
	function fail(requestId: number, value: unknown): void { if (!disposed) { const error = asError(value); scope.postMessage({ type: 'error', requestId, message: error.message, name: error.name }); } }
	function dispose(): void { if (!disposed) { disposed = true; active?.controller.abort(); rejectResources(); session?.dispose(); session = null; scope.removeEventListener('message', listener); } }
}
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
