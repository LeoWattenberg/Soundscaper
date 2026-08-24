/* SPDX-License-Identifier: AGPL-3.0-only */

import { soundscaperNativeAudioCaptureSource } from '../soundscaper-native-audio-capture.ts';

export interface RecordingDeviceRoute {
	readonly kind: 'device';
	readonly deviceId: string;
	readonly channelStart: number;
	readonly channelCount: number;
}

interface RecordingRouteLike {
	readonly kind?: string;
	readonly deviceId?: string;
	readonly channelStart?: number;
	readonly channelCount?: number;
}

export interface MicrophoneMeterState {
	disposed: boolean;
	microphoneMetering: boolean;
	recorder: Readonly<{ setInputGain?(value: number): void }> | null;
	recordingStarting: boolean;
	timedRecordingPreparing: boolean;
	timedRecording: unknown;
	readonly preferences: Readonly<{ recording: Readonly<{ retainInputs: boolean }> }>;
	recordingInputGain: number;
	transportState: string;
	inputLoudnessMeasurementManuallyPaused: boolean;
	inputLoudnessMeasurementExplicitlyRunning: boolean;
	inputMeterDb: number;
	inputMeter: unknown;
	selectedTrackId: string | null;
	recordingRouting: Readonly<{ routes: Readonly<Record<string, RecordingRouteLike | null | undefined>> }>;
}

interface AudioTrackPort {
	addEventListener?(type: 'ended', listener: () => void): void;
	removeEventListener?(type: 'ended', listener: () => void): void;
}

export interface MeterMediaStream {
	getAudioTracks?(): readonly AudioTrackPort[];
}

interface AudioNodePort {
	connect?(destination: AudioNodePort, output?: number, input?: number): unknown;
	disconnect?(): void;
}

interface AnalyserNodePort extends AudioNodePort {
	fftSize: number;
	smoothingTimeConstant: number;
	getFloatTimeDomainData(target: Float32Array): void;
}

interface MeterAudioContext {
	readonly destination: AudioNodePort;
	createMediaStreamSource(stream: MeterMediaStream): AudioNodePort;
	createAnalyser(): AnalyserNodePort;
	createChannelSplitter?(channelCount: number): AudioNodePort;
	createChannelMerger?(channelCount: number): AudioNodePort;
}

export interface InputLoudnessMeter {
	setRunning(running: boolean): void;
	setInputGain(value: number): void;
	reset(): void;
	requestSnapshot?(): void;
	snapshot?(): unknown;
	dispose?(): void;
}

interface NodeLoudnessMeter extends InputLoudnessMeter {
	readonly node: AudioNodePort;
}

export interface MicrophoneMeterSession {
	readonly analysers: readonly AnalyserNodePort[];
	readonly deviceId: string;
	readonly disconnectSource: () => void;
	readonly endedListeners: readonly (() => void)[];
	interval: unknown;
	readonly loudnessMeter: NodeLoudnessMeter | null;
	readonly merger: AudioNodePort | null;
	readonly routeKey: string;
	readonly source: AudioNodePort;
	readonly splitter: AudioNodePort | null;
	readonly stream: MeterMediaStream;
}

interface RecordingCapturePoolPort {
	getHardware?(deviceId: string): MeterMediaStream | null | undefined;
	acquireHardware(
		deviceId: string,
		options: Readonly<{ channelCount: number; sampleRate: number }>,
	): Promise<MeterMediaStream>;
	releaseHardware(deviceId: string): void;
}

interface LoudnessMeterOptions {
	readonly channelCount: number;
	readonly inputGain: number;
	readonly passthrough: false;
	readonly running: boolean;
	readonly onMeter: (reading: unknown) => void;
}

export interface MicrophoneMeterDependencies {
	readonly state: MicrophoneMeterState;
	readonly defaultDeviceId: string;
	readonly recordingCapturePool: RecordingCapturePoolPort;
	getAudioContext(): Promise<MeterAudioContext>;
	createLoudnessMeterNode(
		context: MeterAudioContext,
		options: LoudnessMeterOptions,
	): Promise<NodeLoudnessMeter>;
	streamAudioChannelCount(stream: MeterMediaStream): number;
	projectSampleRate(): number;
	persistSetting(key: string, value: unknown): Promise<unknown> | unknown;
	publishDocumentSnapshot(): void;
	publishTelemetrySnapshot(): void;
	syncRecordingPoolSnapshot(): void;
	handleError(error: unknown): void;
	scheduleInterval(callback: () => void, milliseconds: number): unknown;
	clearInterval(identifier: unknown): void;
	readonly playbackLoudness?: Readonly<{
		pause?(): void;
		continue?(): void;
		reset?(): void;
	}>;
}

export interface MicrophoneMeterService {
	getSession(): MicrophoneMeterSession | null;
	getRoutedLoudnessMeter(): InputLoudnessMeter | null;
	getRoutedLoudnessMeterKey(): string | null;
	setRoutedLoudnessMeter(meter: InputLoudnessMeter | null, key?: string | null): void;
	clearRoutedLoudnessMeter(): void;
	getRoute(): RecordingDeviceRoute;
	getRouteKey(route?: RecordingDeviceRoute): string;
	getDeviceId(): string;
	getGeneration(): number;
	invalidate(): number;
	isGeneration(generation: number): boolean;
	setMicrophoneMetering(enabled: unknown): Promise<boolean>;
	startMicrophoneMetering(options?: Readonly<{ force?: boolean }>): Promise<boolean>;
	stopMicrophoneMetering(options?: Readonly<{ releaseInput?: boolean; preserveReading?: boolean }>): void;
	reconcileInput(options?: Readonly<{ endedSession?: MicrophoneMeterSession | null }>): boolean;
	synchronizeTarget(): boolean;
	pauseLoudnessMeasurement(kind?: string): boolean;
	continueLoudnessMeasurement(kind?: string): boolean;
	resetLoudnessMeasurement(kind?: string): boolean;
	setRecordingInputGain(value: unknown, normalize: (value: unknown) => number): number;
	dispose(): void;
}

export function createMicrophoneMeterService(
	dependencies: MicrophoneMeterDependencies,
): Readonly<MicrophoneMeterService> {
	const { state } = dependencies;
	let session: MicrophoneMeterSession | null = null;
	let startPromise: Promise<boolean> | null = null;
	let generation = 0;
	let targetKey: string | null = null;
	let routedLoudnessMeter: InputLoudnessMeter | null = null;
	let routedLoudnessMeterKey: string | null = null;

	return Object.freeze({
		getSession: () => session,
		getRoutedLoudnessMeter: () => routedLoudnessMeter,
		getRoutedLoudnessMeterKey: () => routedLoudnessMeterKey,
		setRoutedLoudnessMeter,
		clearRoutedLoudnessMeter,
		getRoute,
		getRouteKey,
		getDeviceId: () => getRoute().deviceId,
		getGeneration: () => generation,
		invalidate,
		isGeneration: (candidate: number) => generation === candidate,
		setMicrophoneMetering,
		startMicrophoneMetering,
		stopMicrophoneMetering,
		reconcileInput,
		synchronizeTarget,
		pauseLoudnessMeasurement,
		continueLoudnessMeasurement,
		resetLoudnessMeasurement,
		setRecordingInputGain,
		dispose,
	});

	function setRoutedLoudnessMeter(meter: InputLoudnessMeter | null, key: string | null = null): void {
		routedLoudnessMeter = meter;
		routedLoudnessMeterKey = meter ? key : null;
	}

	function clearRoutedLoudnessMeter(): void {
		routedLoudnessMeter = null;
		routedLoudnessMeterKey = null;
		state.inputMeter = null;
	}

	function getRoute(): RecordingDeviceRoute {
		const selectedRoute = state.selectedTrackId
			? state.recordingRouting.routes[state.selectedTrackId]
			: null;
		const route = selectedRoute?.kind === 'device'
			? selectedRoute
			: Object.values(state.recordingRouting.routes)
				.find((candidate) => candidate?.kind === 'device');
		return normalizeRoute(route, dependencies.defaultDeviceId);
	}

	function getRouteKey(route: RecordingDeviceRoute = getRoute()): string {
		return `${route.deviceId}:${route.channelStart}:${route.channelCount}`;
	}

	function invalidate(): number {
		generation += 1;
		return generation;
	}

	async function setMicrophoneMetering(enabled: unknown): Promise<boolean> {
		const next = Boolean(enabled);
		if (!next) {
			state.microphoneMetering = false;
			invalidate();
			if (!state.recorder && !state.recordingStarting) {
				stopMicrophoneMetering({ releaseInput: true });
			}
			void Promise.resolve(dependencies.persistSetting('microphone-metering', false));
			dependencies.publishDocumentSnapshot();
			return false;
		}
		state.microphoneMetering = true;
		void Promise.resolve(dependencies.persistSetting('microphone-metering', true));
		dependencies.publishDocumentSnapshot();
		if (session) return true;
		try {
			while (state.microphoneMetering && !session && !state.disposed) {
				if (!startPromise) {
					const operation = startMicrophoneMetering();
					const tracked = operation.finally(() => {
						if (startPromise === tracked) startPromise = null;
					});
					startPromise = tracked;
				}
				await startPromise;
			}
			return Boolean(state.microphoneMetering && session);
		} catch (error) {
			if (state.microphoneMetering && !state.disposed) {
				state.microphoneMetering = false;
				invalidate();
				stopMicrophoneMetering({ releaseInput: true });
				void Promise.resolve(dependencies.persistSetting('microphone-metering', false));
				dependencies.publishDocumentSnapshot();
			}
			throw error;
		}
	}

	async function startMicrophoneMetering(
		{ force = false }: Readonly<{ force?: boolean }> = {},
	): Promise<boolean> {
		if (session || (!state.microphoneMetering && !force) || state.disposed) return false;
		const operationGeneration = invalidate();
		const route = getRoute();
		const { deviceId } = route;
		const requestedChannels = Math.max(1, route.channelStart + route.channelCount);
		targetKey = getRouteKey(route);
		const retainedStream = dependencies.recordingCapturePool.getHardware?.(deviceId);
		let stream = retainedStream && dependencies.streamAudioChannelCount(retainedStream) >= requestedChannels
			? retainedStream
			: null;
		let source: AudioNodePort | null = null;
		let disconnectSource = (): void => undefined;
		let splitter: AudioNodePort | null = null;
		let merger: AudioNodePort | null = null;
		let loudnessMeter: NodeLoudnessMeter | null = null;
		const analysers: AnalyserNodePort[] = [];
		try {
			stream ||= await dependencies.recordingCapturePool.acquireHardware(deviceId, {
				channelCount: requestedChannels,
				sampleRate: dependencies.projectSampleRate(),
			});
			if (operationIsStale(operationGeneration)) {
				releaseIfUnused(deviceId);
				return false;
			}
			const context = await dependencies.getAudioContext();
			if (operationIsStale(operationGeneration)) {
				releaseIfUnused(deviceId);
				return false;
			}
			const nativeSource = soundscaperNativeAudioCaptureSource(
				stream as MediaStream, context as unknown as BaseAudioContext,
			) as unknown as AudioNodePort | null;
			if ((!nativeSource && !context?.createMediaStreamSource) || !context?.createAnalyser) {
				throw new Error('Microphone metering is not supported by this AudioContext.');
			}
			source = nativeSource || context.createMediaStreamSource(stream);
			const sourceConnections: AudioNodePort[] = [];
			const connectSource = (destination: AudioNodePort): void => {
				source?.connect?.(destination);
				sourceConnections.push(destination);
			};
			disconnectSource = () => {
				for (const destination of sourceConnections) {
					try { (source?.disconnect as ((value: AudioNodePort) => void) | undefined)?.(destination); }
					catch { /* already disconnected */ }
				}
			};
			if (context.createChannelSplitter) {
				splitter = context.createChannelSplitter(requestedChannels);
				connectSource(splitter);
				for (let index = 0; index < route.channelCount; index += 1) {
					const analyser = createAnalyser(context);
					splitter.connect?.(analyser, route.channelStart + index);
					analysers.push(analyser);
				}
			} else {
				const analyser = createAnalyser(context);
				connectSource(analyser);
				analysers.push(analyser);
			}
			try {
				loudnessMeter = await dependencies.createLoudnessMeterNode(context, {
					channelCount: route.channelCount,
					inputGain: state.recordingInputGain,
					passthrough: false,
					running: !state.inputLoudnessMeasurementManuallyPaused
						&& (state.transportState === 'recording'
							|| state.inputLoudnessMeasurementExplicitlyRunning),
					onMeter: publishLoudnessReading,
				});
				if (splitter && context.createChannelMerger) {
					merger = context.createChannelMerger(route.channelCount);
					for (let index = 0; index < route.channelCount; index += 1) {
						splitter.connect?.(merger, route.channelStart + index, index);
					}
					merger.connect?.(loudnessMeter.node);
				} else connectSource(loudnessMeter.node);
				loudnessMeter.node.connect?.(context.destination);
			} catch {
				loudnessMeter = null;
				merger = null;
			}
			const samples = analysers.map((analyser) => new Float32Array(analyser.fftSize));
			const endedListeners: (() => void)[] = [];
			const nextSession: MicrophoneMeterSession = {
				analysers,
				deviceId,
				disconnectSource,
				endedListeners,
				interval: null,
				loudnessMeter,
				merger,
				routeKey: getRouteKey(route),
				source,
				splitter,
				stream,
			};
			const handleEnded = (): void => {
				if (session === nextSession) reconcileInput({ endedSession: nextSession });
			};
			for (const track of stream.getAudioTracks?.() || []) {
				track.addEventListener?.('ended', handleEnded);
				endedListeners.push(() => track.removeEventListener?.('ended', handleEnded));
			}
			session = nextSession;
			const update = (): void => {
				if (session !== nextSession
					|| (!state.microphoneMetering && !state.recorder && !state.recordingStarting)
					|| state.disposed) return;
				let peak = 0;
				for (let index = 0; index < analysers.length; index += 1) {
					const analyser = analysers[index];
					const sampleBuffer = samples[index];
					if (!analyser || !sampleBuffer) continue;
					analyser.getFloatTimeDomainData(sampleBuffer);
					for (const sample of sampleBuffer) peak = Math.max(peak, Math.abs(sample));
				}
				peak *= state.recordingInputGain;
				state.inputMeterDb = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
				dependencies.publishTelemetrySnapshot();
			};
			nextSession.interval = dependencies.scheduleInterval(update, 50);
			update();
			dependencies.syncRecordingPoolSnapshot();
			dependencies.publishDocumentSnapshot();
			return true;
		} catch (error) {
			disconnectSource();
			disconnect(splitter);
			disconnect(merger);
			loudnessMeter?.dispose?.();
			for (const analyser of analysers) disconnect(analyser);
			releaseIfUnused(deviceId);
			throw error;
		}
	}

	function stopMicrophoneMetering(
		{ releaseInput = false, preserveReading = false }: Readonly<{
			releaseInput?: boolean;
			preserveReading?: boolean;
		}> = {},
	): void {
		const stoppedSession = session;
		session = null;
		targetKey = null;
		if (stoppedSession?.interval != null) dependencies.clearInterval(stoppedSession.interval);
		for (const remove of stoppedSession?.endedListeners || []) remove();
		stoppedSession?.disconnectSource();
		disconnect(stoppedSession?.splitter);
		disconnect(stoppedSession?.merger);
		stoppedSession?.loudnessMeter?.dispose?.();
		for (const analyser of stoppedSession?.analysers || []) disconnect(analyser);
		if (releaseInput && stoppedSession && canReleaseInput()) {
			dependencies.recordingCapturePool.releaseHardware(stoppedSession.deviceId);
			dependencies.syncRecordingPoolSnapshot();
		}
		if (!state.recorder && !preserveReading) {
			state.inputMeterDb = -60;
			state.inputMeter = null;
			dependencies.publishTelemetrySnapshot();
		}
	}

	function reconcileInput(
		{ endedSession = null }: Readonly<{ endedSession?: MicrophoneMeterSession | null }> = {},
	): boolean {
		const expectedSession = endedSession || session;
		if (!expectedSession || session !== expectedSession) return false;
		const replacement = dependencies.recordingCapturePool.getHardware?.(expectedSession.deviceId) || null;
		if (session !== expectedSession) return true;
		if (!endedSession && replacement === expectedSession.stream) return false;
		if (!state.disposed && state.microphoneMetering && replacement && replacement !== expectedSession.stream) {
			invalidate();
			stopMicrophoneMetering({ releaseInput: false });
			void setMicrophoneMetering(true).catch((error: unknown) => {
				if (!state.disposed) dependencies.handleError(error);
			});
			return true;
		}
		state.microphoneMetering = false;
		invalidate();
		stopMicrophoneMetering({ releaseInput: false });
		void Promise.resolve(dependencies.persistSetting('microphone-metering', false));
		if (!state.disposed) dependencies.publishDocumentSnapshot();
		return true;
	}

	function synchronizeTarget(): boolean {
		if (!state.microphoneMetering || state.recorder || state.disposed) return false;
		const route = getRoute();
		const nextTargetKey = getRouteKey(route);
		if (targetKey === nextTargetKey) return false;
		const releaseInput = Boolean(session && session.deviceId !== route.deviceId);
		invalidate();
		stopMicrophoneMetering({ releaseInput });
		void setMicrophoneMetering(true).catch((error: unknown) => {
			if (!state.disposed) dependencies.handleError(error);
		});
		return true;
	}

	function pauseLoudnessMeasurement(kind = 'input'): boolean {
		if (kind === 'input') {
			state.inputLoudnessMeasurementManuallyPaused = true;
			state.inputLoudnessMeasurementExplicitlyRunning = false;
			session?.loudnessMeter?.setRunning(false);
			session?.loudnessMeter?.requestSnapshot?.();
			routedLoudnessMeter?.setRunning(false);
		} else dependencies.playbackLoudness?.pause?.();
		dependencies.publishTelemetrySnapshot();
		return true;
	}

	function continueLoudnessMeasurement(kind = 'input'): boolean {
		if (kind === 'input') {
			state.inputLoudnessMeasurementManuallyPaused = false;
			state.inputLoudnessMeasurementExplicitlyRunning = state.transportState !== 'recording';
			const running = state.transportState === 'recording'
				|| state.inputLoudnessMeasurementExplicitlyRunning;
			session?.loudnessMeter?.setRunning(running);
			session?.loudnessMeter?.requestSnapshot?.();
			routedLoudnessMeter?.setRunning(running);
		} else dependencies.playbackLoudness?.continue?.();
		dependencies.publishTelemetrySnapshot();
		return true;
	}

	function resetLoudnessMeasurement(kind = 'input'): boolean {
		if (kind === 'input') {
			session?.loudnessMeter?.reset();
			session?.loudnessMeter?.requestSnapshot?.();
			routedLoudnessMeter?.reset();
			if (routedLoudnessMeter?.snapshot) state.inputMeter = routedLoudnessMeter.snapshot();
		} else dependencies.playbackLoudness?.reset?.();
		dependencies.publishTelemetrySnapshot();
		return true;
	}

	function setRecordingInputGain(value: unknown, normalize: (value: unknown) => number): number {
		state.recordingInputGain = normalize(value);
		state.recorder?.setInputGain?.(state.recordingInputGain);
		session?.loudnessMeter?.setInputGain(state.recordingInputGain);
		void Promise.resolve(dependencies.persistSetting('recording-input-gain', state.recordingInputGain));
		dependencies.publishDocumentSnapshot();
		return state.recordingInputGain;
	}

	function dispose(): void {
		state.microphoneMetering = false;
		invalidate();
		stopMicrophoneMetering({ releaseInput: false });
		clearRoutedLoudnessMeter();
	}

	function createAnalyser(context: MeterAudioContext): AnalyserNodePort {
		const analyser = context.createAnalyser();
		if (typeof analyser?.getFloatTimeDomainData !== 'function') {
			throw new Error('Microphone metering is not supported by this AudioContext.');
		}
		analyser.fftSize = 256;
		analyser.smoothingTimeConstant = 0.35;
		return analyser;
	}

	function publishLoudnessReading(reading: unknown): void {
		if (!session?.loudnessMeter) return;
		state.inputMeter = reading;
		const dbfs = reading && typeof reading === 'object'
			? Number((reading as Readonly<{ dbfs?: unknown }>).dbfs)
			: Number.NaN;
		state.inputMeterDb = Number.isFinite(dbfs) ? Math.max(-60, Math.min(0, dbfs)) : -60;
		dependencies.publishTelemetrySnapshot();
	}

	function operationIsStale(operationGeneration: number): boolean {
		return generation !== operationGeneration || !state.microphoneMetering || state.disposed;
	}

	function releaseIfUnused(deviceId: string): void {
		if (!canReleaseInput()) return;
		dependencies.recordingCapturePool.releaseHardware(deviceId);
		dependencies.syncRecordingPoolSnapshot();
	}

	function canReleaseInput(): boolean {
		return !state.preferences.recording.retainInputs
			&& !state.recorder
			&& !state.recordingStarting
			&& !state.timedRecordingPreparing
			&& !state.timedRecording;
	}
}

function normalizeRoute(
	route: RecordingRouteLike | null | undefined,
	defaultDeviceId: string,
): RecordingDeviceRoute {
	return Object.freeze({
		kind: 'device',
		deviceId: typeof route?.deviceId === 'string' && route.deviceId ? route.deviceId : defaultDeviceId,
		channelStart: Math.max(0, Math.floor(Number(route?.channelStart) || 0)),
		channelCount: Math.max(1, Math.floor(Number(route?.channelCount) || 2)),
	});
}

function disconnect(node: AudioNodePort | null | undefined): void {
	try {
		node?.disconnect?.();
	} catch {
		// Web Audio nodes may already be disconnected during terminal cleanup.
	}
}
