/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

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
}>): Readonly<{
	readonly sessionRef: RefObject<ProductVideoVisualPreviewSession | null>;
	readonly state: ProductVideoVisualPreviewState;
	readonly updateFrame: (frame: ProductVideoVisualPreviewFrame | null, error?: string | null) => void;
	readonly resolveTransitionWeight: (clipId: string, timelineSample: number) => number | null;
}> {
	const runtime = useMemo(() => productVideoVisualPreviewRuntimeFor(options.owner), [options.owner]);
	const sessionRef = useRef<ProductVideoVisualPreviewSession | null>(null);
	const requestFrameRef = useRef(options.requestFrame);
	requestFrameRef.current = options.requestFrame;
	const signatureRef = useRef('');
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
	useEffect(() => {
		let live = true;
		let ownedSession: ProductVideoVisualPreviewSession | null = null;
		const previous = sessionRef.current;
		sessionRef.current = null;
		previous?.dispose();
		if (!runtime || !options.project) {
			updateFrame(null);
			requestFrameRef.current();
			return () => { live = false; };
		}
		const pending = { ...emptyState(), pending: true };
		signatureRef.current = JSON.stringify(pending);
		setState(pending);
		void runtime.create({
			project: options.project, width: options.width, height: options.height,
			...(options.fit === undefined ? {} : { fit: options.fit }),
		}).then((session) => {
			if (!live) {
				session?.dispose();
				return;
			}
			ownedSession = session;
			sessionRef.current = session;
			if (session === null) updateFrame(null);
			requestFrameRef.current();
		}).catch((cause: unknown) => {
			if (!live) return;
			updateFrame(null, cause instanceof Error ? cause.message : String(cause));
			requestFrameRef.current();
		});
		return () => {
			live = false;
			if (sessionRef.current === ownedSession) sessionRef.current = null;
			ownedSession?.dispose();
		};
	}, [options.fit, options.height, options.project, options.width, runtime, updateFrame]);
	return Object.freeze({ sessionRef, state, updateFrame, resolveTransitionWeight });
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
