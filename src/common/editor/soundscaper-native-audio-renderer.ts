/* SPDX-License-Identifier: AGPL-3.0-only */

import { createNativeDeviceIoWorkletNode } from './native-device-io-worklet-node.js';
import {
	createNativeRealtimeClient,
	type NativeRealtimeTransferredPort,
} from './native-realtime-client.ts';
import type { NativeAudioSessionOpenRequestV1 } from './ui/soundscaper-native-services-bridge.ts';
import { claimSoundscaperNativeAudioCapture } from './soundscaper-native-audio-capture.ts';
import { nativeAudioDeviceId } from './controller/native-audio-inventory.ts';

export const SOUNDSCAPER_NATIVE_AUDIO_PORT_EVENT = 'soundscaper-native-realtime-port-v1';

type EnginePort = Readonly<{
	getAudioContext(options?: Readonly<{ resume?: boolean }>): Promise<AudioContext>;
	getState(): Readonly<{ state: string }>;
	pause(): void;
	play(): Promise<void>;
}>;

type WindowPort = Pick<Window, 'addEventListener' | 'removeEventListener'>;

interface PreparedSession {
	readonly sessionId: string;
	readonly context: AudioContext;
	readonly node: AudioNode;
	readonly client: ReturnType<typeof createNativeRealtimeClient>;
	readonly direction: NativeAudioSessionOpenRequestV1['direction'];
	readonly sink: GainNode;
	readonly capture: Readonly<{ activate(): void; revoke(reason?: string): void }> | null;
	readonly calibrate: (config: Readonly<{ maxFrames: number; timeoutMs: number }>) => Promise<number>;
}

const ROUTES = new WeakMap<BaseAudioContext, AudioNode>();

/** Live project graphs consult this only for output/duplex sessions. */
export function soundscaperNativeAudioDestination(context: BaseAudioContext, fallback: AudioNode): AudioNode {
	return ROUTES.get(context) ?? fallback;
}

export function createSoundscaperNativeAudioRenderer(options: Readonly<{
	engine: EnginePort;
	windowValue?: WindowPort | null;
	createNode?: typeof createNativeDeviceIoWorkletNode;
	onTransfer?: (sessionId: string, value: Readonly<{
		framesTransferred: number; lostFrames: number;
	}>) => void;
	onDeviceLoss?: (sessionId: string, reason: string) => Promise<void> | void;
}>) {
	const windowValue = options.windowValue ?? (typeof window === 'undefined' ? null : window);
	const createNode = options.createNode ?? createNativeDeviceIoWorkletNode;
	let prepared: PreparedSession | null = null;
	let listening = false;

	const receive = (event: Event): void => {
		const message = event as MessageEvent<unknown>;
		const ports = Array.from(message.ports ?? []) as NativeRealtimeTransferredPort[];
		const data = message.data as Readonly<{ type?: unknown; offer?: unknown }> | null;
		if (data?.type !== SOUNDSCAPER_NATIVE_AUDIO_PORT_EVENT) return;
		if (!prepared) {
			for (const port of ports) close(port);
			return;
		}
		const outcome = prepared.client.receive(data.offer, ports);
		if (outcome.status === 'attached') {
			prepared.capture?.activate();
			if (prepared.direction !== 'input') {
				ROUTES.set(prepared.context, prepared.node);
				void restartIfPlaying(options.engine);
			}
		}
	};

	const listen = (): void => {
		if (listening || !windowValue) return;
		listening = true;
		windowValue.addEventListener('message', receive);
	};

	const release = async (sessionId?: string): Promise<void> => {
		if (!prepared || (sessionId !== undefined && prepared.sessionId !== sessionId)) return;
		const current = prepared;
		prepared = null;
		if (ROUTES.get(current.context) === current.node) ROUTES.delete(current.context);
		current.capture?.revoke('session-closed');
		current.client.dispose();
		try { current.sink.disconnect(); } catch { /* already disconnected */ }
		await restartIfPlaying(options.engine);
	};

	return Object.freeze({
		async prepare(sessionId: string, request: NativeAudioSessionOpenRequestV1, route?: Readonly<{
			backend: string; deviceHandle: string;
		}>): Promise<void> {
			await release();
			listen();
			const context = await options.engine.getAudioContext({ resume: true });
			let capture: PreparedSession['capture'] = null;
			const lost = (value: Readonly<{ reason?: unknown }>, fallback: string): void => {
				if (prepared?.sessionId !== sessionId) return;
				const reason = nativeAudioLossReason(value.reason, fallback);
				capture?.revoke(String(value.reason || fallback));
				void (async () => {
					await release(sessionId);
					await options.onDeviceLoss?.(sessionId, reason);
				})().catch(() => undefined);
			};
			const transport = await createNode(context, {
				direction: request.direction,
				channelCount: request.channelCount,
				periodFrames: request.periodFrames,
				queueCapacity: 8,
				onTransfer: (value: Readonly<{ framesTransferred: number; lostFrames: number }>) => {
					if (prepared?.sessionId === sessionId) options.onTransfer?.(sessionId, value);
				},
				onClose: (value: Readonly<{ reason?: unknown }>) => lost(value, 'device-loss'),
				onFault: (value: Readonly<{ reason?: unknown }>) => lost(value, 'device-fault'),
			});
			const sink = context.createGain();
			sink.gain.value = 0;
			transport.node.connect(sink);
			sink.connect(context.destination);
			if (request.direction !== 'output') capture = claimSoundscaperNativeAudioCapture({
				sessionId, context, node: transport.node,
				channelCount: request.channelCount, sampleRate: request.sampleRate,
				deviceId: route ? nativeAudioDeviceId(route.backend, 'audio-input', route.deviceHandle) : undefined,
			});
			prepared = Object.freeze({
				sessionId, context, node: transport.node, direction: request.direction,
				sink, capture, calibrate: transport.calibrate,
				client: createNativeRealtimeClient({
					transport,
					request: {
						sampleRate: request.sampleRate, channelCount: request.channelCount,
						frameCount: request.periodFrames, queueCapacity: 8,
					},
				}),
			});
		},
		async calibrate(sessionId: string): Promise<number> {
			if (!prepared || prepared.sessionId !== sessionId) {
				throw new Error('That native audio session is not prepared in this renderer.');
			}
			if (prepared.direction !== 'duplex') throw new Error('Latency calibration requires a duplex route.');
			if (prepared.client.generation === 0) throw new Error('Latency calibration requires a bound route.');
			return prepared.calibrate({
				maxFrames: Math.min(1_048_576, Math.round(prepared.context.sampleRate * 2)),
				timeoutMs: 2_500,
			});
		},
		release,
		async dispose(): Promise<void> {
			if (listening) windowValue?.removeEventListener('message', receive);
			listening = false;
			await release();
		},
	});
}

async function restartIfPlaying(engine: EnginePort): Promise<void> {
	if (engine.getState().state !== 'playing') return;
	engine.pause();
	await engine.play();
}

function close(port: NativeRealtimeTransferredPort): void {
	try { port.close(); } catch { /* already transferred */ }
}

const NATIVE_AUDIO_LOSS_REASONS = new Set([
	'device-loss', 'device-fault', 'short-transfer', 'output-overrun',
	'pool-violation', 'peer-loss', 'malformed-message',
]);

function nativeAudioLossReason(value: unknown, fallback: string): string {
	const reason = String(value || fallback);
	return NATIVE_AUDIO_LOSS_REASONS.has(reason) ? reason : 'device-fault';
}
