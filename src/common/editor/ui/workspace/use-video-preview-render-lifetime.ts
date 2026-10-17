/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { createExactPreviewRenderCoordinator } from '../../controller/clip-video/exact-preview-render-coordinator.ts';
import { createVideoPreviewHardEpochOwner } from '../../controller/clip-video/video-preview-hard-epoch-owner.ts';
import { subscribeEnginePlayheadDiscontinuity } from '../../engine/playhead-discontinuity.ts';

interface Compositor { dispose(): void }
type Coordinator = ReturnType<typeof createExactPreviewRenderCoordinator>;
type HardEpoch = ReturnType<typeof createVideoPreviewHardEpochOwner>;
interface Generation<Value extends Compositor> {
	readonly coordinator: Coordinator;
	readonly hard: HardEpoch;
	compositor: Value | null;
	ready: boolean;
	retired: boolean;
	close?: Promise<void>;
}
interface Options<Value extends Compositor> {
	readonly engine?: object;
	readonly canvasRef: RefObject<HTMLCanvasElement | null>;
	readonly compositorRef: RefObject<Value | null>;
	readonly create: (canvas: HTMLCanvasElement, events: { onContextLost(): void; onContextRestored(): void }) => Value;
	readonly joinSession: () => Promise<void>;
	readonly requestFrame: () => void;
	readonly onReady: (fallback: boolean) => void;
	readonly onFailure: () => void;
	readonly onContextLost: () => void;
	readonly onRetire: () => void;
}

/** GPU generations outlive ordinary project revisions. Hard replacement first
 * revokes frame publication, joins the real frame and Session, then disposes
 * the captured compositor. StrictMode replay joins its predecessor as well. */
export function useVideoPreviewRenderLifetime<Value extends Compositor>(options: Options<Value>) {
	const callbacks = useRef(options); callbacks.current = options;
	const generation = useRef<Generation<Value> | null>(null);
	const coordinatorRef = useRef<Coordinator | null>(null);
	const predecessor = useRef<Promise<void>>(Promise.resolve());
	const replacing = useRef(false);
	const current = useCallback((record: Generation<Value>) => generation.current === record && !record.retired, []);
	const resume = useCallback(() => {
		const record = generation.current;
		if (record && current(record) && record.ready && !replacing.current) record.hard.resume();
	}, [current]);
	const supersede = useCallback(async () => {
		const record = generation.current;
		if (!record || !current(record)) return;
		await record.hard.supersede();
		if (current(record)) resume();
	}, [current, resume]);
	const beforeReplace = useCallback(() => {
		replacing.current = true;
		return generation.current?.hard.supersede() ?? Promise.resolve();
	}, []);
	const afterReplace = useCallback(() => { replacing.current = false; resume(); }, [resume]);
	const mayRender = useCallback(() => {
		const record = generation.current;
		return Boolean(record && current(record) && record.ready && !replacing.current && record.hard.mayRender());
	}, [current]);

	useEffect(() => {
		const canvas = options.canvasRef.current;
		if (!canvas) return undefined;
		const captured = callbacks.current;
		const old = predecessor.current, create = captured.create, joinSession = captured.joinSession;
		const request = () => { if (current(record)) callbacks.current.requestFrame(); };
		const coordinator = createExactPreviewRenderCoordinator(request, { mode: 'continuous' });
		const hard = createVideoPreviewHardEpochOwner(coordinator, request);
		const record: Generation<Value> = { coordinator, hard, compositor: null, ready: false, retired: false };
		generation.current = record; coordinatorRef.current = coordinator;
		const failures: unknown[] = [];
		const add = (error: unknown) => { if (!failures.some(value => Object.is(value, error))) failures.push(error); };
		let unsubscribe: () => void = () => undefined, resize: ResizeObserver | null = null, windowBound = false;
		const close = (): Promise<void> => {
			if (record.close) return record.close;
			record.retired = true;
			if (generation.current === record) { coordinatorRef.current = null; options.compositorRef.current = null; }
			let resolve!: () => void, reject!: (error: unknown) => void;
			record.close = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
			void record.close.catch(() => undefined);
			for (const cleanup of [unsubscribe, () => resize?.disconnect(), () => { if (windowBound) window.removeEventListener('resize', invalidate); }]) {
				try { cleanup(); } catch (error) { add(error); }
			}
			const frame = hard.retire();
			let session: Promise<void>;
			try { session = Reflect.apply(joinSession, captured, []) as Promise<void>; } catch (error) { add(error); session = Promise.resolve(); }
			void session.catch(() => undefined);
			try { callbacks.current.onRetire(); } catch (error) { add(error); }
			void (async () => {
				const outcomes = await Promise.allSettled([old, started, frame, session]);
				for (const outcome of outcomes) if (outcome.status === 'rejected') add(outcome.reason);
				const compositor = record.compositor; record.compositor = null;
				if (compositor) try { Reflect.apply(compositor.dispose, compositor, []); } catch (error) { add(error); }
				if (failures.length) throw failures.length === 1 ? failures[0] : new AggregateError(failures, 'Video preview retirement failed.');
			})().then(resolve, reject);
			return record.close;
		};
		const invalidate = () => { void supersede().catch(() => { if (current(record)) callbacks.current.onFailure(); }); };
		const started = (async () => {
			await old;
			if (!current(record)) return;
			try {
				record.compositor = Reflect.apply(create, captured, [canvas, {
					onContextLost() { if (current(record)) { invalidate(); callbacks.current.onContextLost(); } },
					onContextRestored() { if (current(record)) { invalidate(); callbacks.current.onReady(false); } },
				}]) as Value;
				if (current(record)) options.compositorRef.current = record.compositor;
				if (current(record)) callbacks.current.onReady(false);
			} catch { if (current(record)) callbacks.current.onReady(true); }
			record.ready = true;
			if (current(record)) resume();
		})();
		void started.catch(() => { if (current(record)) callbacks.current.onFailure(); });
		try {
			unsubscribe = options.engine ? subscribeEnginePlayheadDiscontinuity(options.engine, invalidate) : () => undefined;
			resize = typeof ResizeObserver === 'function' ? new ResizeObserver(invalidate) : null;
			resize?.observe(canvas);
			if (!resize) { window.addEventListener('resize', invalidate); windowBound = true; }
		} catch (error) {
			add(error); predecessor.current = close();
			void predecessor.current.catch(() => { if (generation.current === record) callbacks.current.onFailure(); });
		}
		return () => { predecessor.current = close(); };
	}, [current, options.canvasRef, options.compositorRef, options.create, options.engine, resume, supersede]);
	return { coordinatorRef, beforeReplace, afterReplace, mayRender, supersede };
}
