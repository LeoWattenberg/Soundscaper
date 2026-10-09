/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../closed-domain-value.ts';

export interface ExactPreviewRenderRequest<Frame> {
	readonly render: (signal: AbortSignal) => PromiseLike<Frame> | Frame;
	readonly isCurrent: () => boolean;
	readonly publish: (frame: Frame) => void;
	readonly onError: (error: unknown) => void;
}

export interface ExactPreviewRenderOptions {
	readonly mode: 'settled' | 'continuous';
}
interface ActiveFrame {
	readonly epoch: object;
	readonly stop: AbortController;
	readonly signal: AbortSignal;
	readonly done: Promise<void>;
	readonly complete: () => void;
	superseded: boolean;
}
const NativeController = AbortController;
const ABORT = NativeController.prototype.abort;
const SIGNAL = Object.getOwnPropertyDescriptor(NativeController.prototype, 'signal')!.get!;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** Settled seeks discard superseded frames. Continuous clock demand coalesces
 * a redraw without starving the current frame. Hard project/resource/viewport
 * or seek replacement must supersede and join; retirement permanently closes
 * admission. Neither clock demand nor this owner promises a playback cadence. */
export function createExactPreviewRenderCoordinator(requestLatestFrame: () => void, options?: ExactPreviewRenderOptions) {
	const mode = options === undefined ? 'settled' : readClosedDomainField(
		readClosedDomainRecord(options, 'Exact preview render options', ['mode']), 'mode', 'Exact preview render options');
	if (mode !== 'settled' && mode !== 'continuous') throw new RangeError('Unsupported exact preview render mode.');
	let active: ActiveFrame | null = null;
	let epoch: object = {};
	let pending = false;
	let retired = false;
	let failure: Readonly<{ value: unknown }> | null = null;
	let retirement: Promise<void> | null = null;
	return Object.freeze({ run, deferWhileActive, supersede, retire });

	function deferWhileActive(): boolean {
		if (retired || failure) return true;
		if (!active) return false;
		pending = true;
		return true;
	}

	async function run<Frame>(request: ExactPreviewRenderRequest<Frame>): Promise<void> {
		if (failure) throw failure.value;
		if (retired) throw new Error('The exact preview renderer is retired.');
		if (deferWhileActive()) return;
		let complete = (): void => undefined;
		const stop = new NativeController();
		const current: ActiveFrame = { epoch, stop, signal: Reflect.apply(SIGNAL, stop, []) as AbortSignal,
			done: new Promise<void>(resolve => { complete = resolve; }), complete: () => { complete(); }, superseded: false };
		active = current;
		let isCurrent = (): boolean => false;
		try {
			// Capture method identities and receivers before the first borrowed await.
			const render = request.render.bind(request), publish = request.publish.bind(request), onError = request.onError.bind(request);
			isCurrent = request.isCurrent.bind(request);
			const mayPublish = () => !retired && !failure && epoch === current.epoch && (mode === 'continuous' || !pending)
				&& isCurrent() && !retired && !failure && epoch === current.epoch && (mode === 'continuous' || !pending);
			try {
				const frame = await render(current.signal);
				if (mayPublish()) publish(frame);
			} catch (error) {
				if (Reflect.apply(ABORTED, current.signal, []) === true && Reflect.apply(REASON, current.signal, []) !== error) failure ??= { value: error };
				if (mayPublish()) onError(error);
			}
		} catch (error) {
			failure ??= { value: error };
			throw error;
		} finally { finish(current, isCurrent); }
	}

	function finish(current: ActiveFrame, isCurrent: () => boolean): void {
		try {
			// Currentness is borrowed code: it can demand another clock frame or
			// supersede/retire this epoch. Decide from state after that callback.
			const stillCurrent = pending || epoch !== current.epoch || current.superseded || retired || failure ? true : isCurrent();
			const redraw = !current.superseded && (pending || epoch !== current.epoch || !stillCurrent);
			pending = false; active = null;
			if (redraw && !retired && !failure) requestLatestFrame();
		} catch (error) { failure ??= { value: error }; throw error; }
		finally { active = active === current ? null : active; current.complete(); }
	}

	/** Invalidate a hard epoch synchronously; replacement work starts only after
	 * this join succeeds. The host then swaps resources and requests its own
	 * replacement; no automatic redraw crosses this barrier. Ordinary playing
	 * clock advancement uses demand instead. */
	function supersede(): Promise<void> {
		if (retirement) return retirement;
		epoch = {};
		const held = active;
		if (held) { held.superseded = true; Reflect.apply(ABORT, held.stop, []); }
		return join(held);
	}

	function retire(): Promise<void> {
		if (retirement) return retirement;
		retired = true; epoch = {}; pending = false;
		const held = active;
		retirement = join(held);
		if (held) Reflect.apply(ABORT, held.stop, []);
		return retirement;
	}

	async function join(held: ActiveFrame | null): Promise<void> {
		if (held) await held.done;
		if (failure) throw failure.value;
	}
}
