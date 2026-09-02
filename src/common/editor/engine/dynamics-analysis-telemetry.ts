/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Latest live reading from one dynamics processor.
 *
 * Levels are peak magnitudes in the linear domain, exactly as the processor
 * measured them, so the display owns the conversion to decibels and its floor.
 * `reductionDb` is at most zero and excludes makeup gain.
 */
export interface DynamicsAnalysisWindow {
	readonly effectType: string;
	readonly frames: number;
	readonly seconds: number;
	readonly inputPeak: number;
	readonly outputPeak: number;
	readonly reductionDb: number;
}

interface TelemetryRegistration {
	readonly handler: (event: MessageEvent<unknown>) => void;
	latest: DynamicsAnalysisWindow | null;
}

const registrations = new WeakMap<object, TelemetryRegistration>();

/**
 * Keep the newest reading from a live effect worklet on the node itself.
 *
 * The reading is display state that a paused or closed dialog simply stops
 * reading, so it is held beside the node rather than pushed through the project
 * graph: nothing outside the panel that draws it has to know it exists.
 */
export function attachDynamicsAnalysisTelemetry(node: AudioNode): void {
	const worklet = node as AudioWorkletNode;
	if (!worklet.port || registrations.has(worklet)) return;
	const registration: TelemetryRegistration = {
		latest: null,
		handler: ({ data }: MessageEvent<unknown>): void => {
			const window = dynamicsAnalysisWindow(data);
			if (window) registration.latest = window;
		},
	};
	registrations.set(worklet, registration);
	worklet.port.onmessage = registration.handler;
	worklet.port.start?.();
}

export function readDynamicsAnalysisTelemetry(
	node: AudioNode | null | undefined,
): DynamicsAnalysisWindow | null {
	if (!node) return null;
	return registrations.get(node as AudioWorkletNode)?.latest ?? null;
}

export function releaseDynamicsAnalysisTelemetry(node: AudioNode): void {
	const worklet = node as AudioWorkletNode;
	const registration = registrations.get(worklet);
	if (!registration) return;
	if (worklet.port?.onmessage === registration.handler) worklet.port.onmessage = null;
	registrations.delete(worklet);
}

function dynamicsAnalysisWindow(value: unknown): DynamicsAnalysisWindow | null {
	if (!value || typeof value !== 'object') return null;
	const message = value as Readonly<Record<string, unknown>>;
	if (message.type !== 'analysis') return null;
	const frames = Number(message.frames);
	const seconds = Number(message.seconds);
	const inputPeak = Number(message.inputPeak);
	const outputPeak = Number(message.outputPeak);
	const reductionDb = Number(message.reductionDb);
	if (!Number.isSafeInteger(frames) || frames <= 0) return null;
	if (!Number.isFinite(seconds) || seconds <= 0) return null;
	if (!Number.isFinite(inputPeak) || inputPeak < 0) return null;
	if (!Number.isFinite(outputPeak) || outputPeak < 0) return null;
	if (!Number.isFinite(reductionDb) || reductionDb > 0) return null;
	return Object.freeze({
		effectType: typeof message.effectType === 'string' ? message.effectType : '',
		frames,
		seconds,
		inputPeak,
		outputPeak,
		reductionDb,
	});
}
