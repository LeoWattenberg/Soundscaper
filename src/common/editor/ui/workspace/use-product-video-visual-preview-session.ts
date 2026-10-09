/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { createVideoPreviewSessionOwner } from '../../controller/clip-video/video-preview-session-owner.ts';
import type { VideoCanvasFit } from '../../video-canvas-fit.ts';

import {
	productVideoVisualPreviewRuntimeFor,
	type ProductVideoVisualPreviewFrame,
	type ProductVideoVisualPreviewSession,
} from './product-video-visual-preview-runtime.ts';

export interface ProductVideoVisualPreviewState {
	readonly pending: boolean;
	readonly error: string | null;
	readonly activeClipIds: readonly string[];
	readonly activeTrackCount: number;
	readonly renderableEntryCount: number;
	readonly requestedNodeIds: readonly string[];
	readonly consumedNodeIds: readonly string[];
	readonly omittedNodeIds: readonly string[];
	readonly activeFreezeNodeIds: readonly string[];
	readonly availablePresetIds: readonly string[];
}

export function useProductVideoVisualPreviewSession(options: Readonly<{
	readonly owner: object;
	readonly project: unknown;
	readonly width: number;
	readonly height: number;
	readonly fit?: VideoCanvasFit;
	readonly requestFrame: () => void;
	readonly beforeReplace?: () => Promise<void>;
	readonly afterReplace?: () => void;
	readonly failureMessage?: string;
}>): Readonly<{
	readonly sessionRef: RefObject<ProductVideoVisualPreviewSession | null>;
	readonly state: ProductVideoVisualPreviewState;
	readonly updateFrame: (frame: ProductVideoVisualPreviewFrame | null, error?: string | null) => void;
	readonly resolveTransitionWeight: (clipId: string, timelineSample: number) => number | null;
	readonly retireAndJoin: () => Promise<void>;
}> {
	const runtime = useMemo(() => productVideoVisualPreviewRuntimeFor(options.owner), [options.owner]);
	const sessionRef = useRef<ProductVideoVisualPreviewSession | null>(null);
	const requestFrameRef = useRef(options.requestFrame);
	requestFrameRef.current = options.requestFrame;
	const signatureRef = useRef('');
	const lifetimeRef = useRef<ReturnType<typeof createVideoPreviewSessionOwner<ProductVideoVisualPreviewSession>> | null>(null);
	const ownerRetirement = useMemo(() => ({ current: null as typeof lifetimeRef.current }), [options.owner]);
	const [state, setState] = useState<ProductVideoVisualPreviewState>(() => emptyState());
	const updateFrame = useCallback((
		frame: ProductVideoVisualPreviewFrame | null,
		error: string | null = null,
	) => {
		const next = frame === null ? { ...emptyState(), error } : frameState(frame, error);
		const signature = JSON.stringify(next);
		if (signatureRef.current === signature) return;
		signatureRef.current = signature;
		setState(next);
	}, []);
	const resolveTransitionWeight = useCallback((clipId: string, timelineSample: number) => (
		sessionRef.current?.resolveTransitionWeight(clipId, timelineSample) ?? null
	), []);
	const retireAndJoin = useCallback(() => ownerRetirement.current?.close() ?? Promise.resolve(), [ownerRetirement]);
	useEffect(() => {
		let live = true;
		const predecessor = lifetimeRef.current;
		const clearError = options.failureMessage ?? 'Video preview is unavailable.';
		const beforeReplace = options.beforeReplace;
		const lifetime = createVideoPreviewSessionOwner<ProductVideoVisualPreviewSession>((session) => {
			if (!live) return;
			sessionRef.current = session;
			requestFrameRef.current();
		}, async () => {
			if (predecessor) await predecessor.close();
			if (beforeReplace) await beforeReplace();
		});
		lifetimeRef.current = lifetime;
		ownerRetirement.current = lifetime;
		sessionRef.current = null;
		const pending = { ...emptyState(), pending: runtime !== null && Boolean(options.project) };
		signatureRef.current = JSON.stringify(pending); setState(pending);
		const create = runtime?.create;
		const request = Object.freeze({ project: options.project, width: options.width, height: options.height,
			...(options.fit === undefined ? {} : { fit: options.fit }) });
		void lifetime.replace(!runtime || !options.project || !create ? null : (signal) => (
			Reflect.apply(create, runtime, [{ ...request, signal }]) as Promise<ProductVideoVisualPreviewSession | null>
		)).then((session) => {
			if (!live) return;
			if (session === null) updateFrame(null);
			options.afterReplace?.();
		}).catch(() => {
			if (!live) return;
			updateFrame(null, clearError); requestFrameRef.current();
		});
		return () => {
			live = false; sessionRef.current = null;
			void lifetime.close().catch(() => undefined);
		};
	}, [options.afterReplace, options.beforeReplace, options.failureMessage, options.fit, options.height, options.project, options.width, ownerRetirement, runtime, updateFrame]);
	return Object.freeze({ sessionRef, state, updateFrame, resolveTransitionWeight, retireAndJoin });
}

function frameState(
	frame: ProductVideoVisualPreviewFrame,
	error: string | null,
): ProductVideoVisualPreviewState {
	return {
		pending: false, error,
		activeClipIds: frame.layers.flatMap((layer) => layer.entries.map((entry) => String(entry.clipId))),
		activeTrackCount: frame.layers.length,
		renderableEntryCount: frame.layers.reduce((count, layer) => count + layer.entries.length, 0),
		requestedNodeIds: frame.ledger.requestedNodeIds,
		consumedNodeIds: frame.ledger.consumedNodeIds,
		omittedNodeIds: frame.ledger.omittedNodeIds,
		activeFreezeNodeIds: frame.activeFreezeNodeIds,
		availablePresetIds: frame.availablePresetIds,
	};
}

function emptyState(): ProductVideoVisualPreviewState {
	return {
		pending: false, error: null, activeClipIds: [], activeTrackCount: 0,
		renderableEntryCount: 0, requestedNodeIds: [], consumedNodeIds: [], omittedNodeIds: [],
		activeFreezeNodeIds: [], availablePresetIds: [],
	};
}
