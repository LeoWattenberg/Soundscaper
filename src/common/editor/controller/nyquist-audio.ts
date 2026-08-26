import { assertAudacityEffectOutput } from '../audacity-effects/contracts.js';

interface NyquistAudioResult extends Record<string, unknown> {
	readonly type?: string;
	readonly channels?: Float32Array[];
	readonly sampleRate?: number;
	readonly frameCount?: number;
	readonly output?: string;
	readonly message?: string;
	readonly value?: unknown;
}

interface NyquistEvaluation {
	readonly result?: NyquistAudioResult;
}

interface NyquistFrameLimit {
	readonly sampleRate: number;
	readonly inputFrames: number;
	readonly preview: boolean;
	readonly requested?: unknown;
}

interface AudacityWorkerContext extends Record<string, unknown> {
	controlChannels?: Float32Array[];
	beforeChannels?: Float32Array[];
	afterChannels?: Float32Array[];
}

interface AudacityWorkerPayload extends Record<string, unknown> {
	channels?: Float32Array[];
	params?: unknown;
	context?: AudacityWorkerContext;
}

export function normalizeNyquistRole(value: unknown): 'process' | 'generate' | 'analyze' | 'prompt' {
	const role = String(value || 'prompt').trim().toLowerCase();
	if (role === 'process' || role === 'effect') return 'process';
	if (role === 'generate' || role === 'generator') return 'generate';
	if (role === 'analyze' || role === 'analyzer' || role === 'tool analyze' || role === 'tool-analyze') return 'analyze';
	return 'prompt';
}

export function nyquistAudioResultBytes(result: NyquistAudioResult | null | undefined): number {
	if (result?.type !== 'audio' || !Array.isArray(result.channels)) return 0;
	return result.channels.reduce((sum, channel) => sum + (channel?.byteLength || 0), 0);
}

export function mixNyquistPreviewChannels(channelSets: Float32Array[][], maximumFrames: unknown): Float32Array[] {
	if (!Array.isArray(channelSets) || !channelSets.length) return [];
	const frameLimit = Math.max(0, Math.round(Number(maximumFrames) || 0));
	if (!frameLimit) return [];
	for (const channels of channelSets) assertAudacityEffectOutput(channels);
	const channelCount = Math.max(...channelSets.map((channels) => channels.length));
	const frameCount = Math.min(
		frameLimit,
		Math.max(...channelSets.map((channels) => channels[0]?.length || 0)),
	);
	if (!frameCount) return [];
	const mixed = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
	for (const channels of channelSets) {
		for (let outputChannel = 0; outputChannel < channelCount; outputChannel += 1) {
			const input = channels.length === 1 ? channels[0] : channels[outputChannel];
			if (!input) continue;
			const frames = Math.min(frameCount, input.length);
			for (let frame = 0; frame < frames; frame += 1) mixed[outputChannel]![frame] += input[frame]!;
		}
	}
	return mixed;
}

export function nyquistMaximumOutputFrames({
	sampleRate,
	inputFrames,
	preview,
	requested,
}: NyquistFrameLimit): number {
	const hardMaximum = Math.max(1, Math.round(sampleRate * (preview ? 6 : 300)));
	const inferred = preview
		? hardMaximum
		: Math.max(Math.round(sampleRate * 60), Math.max(0, inputFrames) * 4);
	const value = requested == null ? inferred : Number(requested);
	if (!Number.isSafeInteger(Math.round(value)) || value <= 0) throw new RangeError('Nyquist maxOutputFrames must be positive.');
	return Math.min(hardMaximum, Math.round(value));
}

export function nyquistChannelStats(channels: Float32Array[] | null | undefined): {
	readonly peak: number | number[];
	readonly rms: number | number[];
} {
	const channelStats = (channels || []).map((channel) => {
		let peak = 0;
		let squareSum = 0;
		for (let index = 0; index < channel.length; index += 1) {
			const value = Number(channel[index]) || 0;
			peak = Math.max(peak, Math.abs(value));
			squareSum += value * value;
		}
		return { peak, rms: channel.length ? Math.sqrt(squareSum / channel.length) : 0 };
	});
	if (!channelStats.length) return { peak: 0, rms: 0 };
	if (channelStats.length === 1) return channelStats[0]!;
	return {
		peak: channelStats.map(({ peak }) => peak),
		rms: channelStats.map(({ rms }) => rms),
	};
}

export function freezeNyquistResult(
	evaluations: NyquistEvaluation[],
	options: { readonly summarizeAudio?: boolean } = {},
): Readonly<NyquistAudioResult> | Readonly<{ type: 'multiple'; results: readonly (NyquistAudioResult | undefined)[] }> | undefined {
	const results = Object.freeze(evaluations.map(({ result }) => (
		options.summarizeAudio && result?.type === 'audio'
			? Object.freeze({
				type: 'audio',
				sampleRate: result.sampleRate,
				frameCount: result.frameCount ?? result.channels?.[0]?.length ?? 0,
				channelCount: result.channels?.length || 0,
				output: result.output || '',
			})
			: result
	)));
	return results.length === 1
		? results[0]
		: Object.freeze({ type: 'multiple', results });
}

export function nyquistResultStatus(
	evaluations: NyquistEvaluation[],
	copy: { readonly nyquistNoOutput?: string; readonly done: string },
): string {
	for (let index = evaluations.length - 1; index >= 0; index -= 1) {
		const result = evaluations[index]?.result;
		if (result?.type === 'message' && result.message) return result.message;
		if (result?.type === 'number') return String(result.value);
		if (result?.output) return result.output;
	}
	return copy.nyquistNoOutput || copy.done;
}

export function cloneAudacityWorkerPayload(
	payload: AudacityWorkerPayload,
	transfer: ArrayBuffer[],
): AudacityWorkerPayload & { channels: Float32Array[]; params: unknown } {
	const cloneChannels = (channels: Float32Array[] | undefined): Float32Array[] => (channels || []).map((channel) => {
		const copy = Float32Array.from(channel);
		transfer.push(copy.buffer);
		return copy;
	});
	const message: AudacityWorkerPayload & { channels: Float32Array[]; params: unknown } = {
		...payload,
		channels: cloneChannels(payload.channels),
		params: structuredClone(payload.params || {}),
	};
	if (payload.context) {
		message.context = { ...payload.context };
		for (const key of ['controlChannels', 'beforeChannels', 'afterChannels'] as const) {
			if (Array.isArray(payload.context[key])) message.context[key] = cloneChannels(payload.context[key]);
		}
	}
	return message;
}

export function audacityEffectMemoryError(copy: { readonly effectMemoryTooLarge: string }): Error {
	return new Error(copy.effectMemoryTooLarge);
}
