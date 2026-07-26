/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	MicrophoneMeterSession,
	RecordingDeviceRoute,
} from './microphone-meter-service.ts';

export interface RecordingDeviceInputRoute {
	readonly kind: 'device';
	readonly deviceId: string;
	readonly deviceLabel?: string;
	readonly channelStart: number;
	readonly channelCount: number;
}

export interface RecordingDisplayInputRoute {
	readonly kind: 'display';
	readonly label?: string;
	readonly channelStart: number;
	readonly channelCount: number;
}

export type RecordingInputRoute = RecordingDeviceInputRoute | RecordingDisplayInputRoute;

export interface RecordingInputRouting {
	readonly routes: Readonly<Record<string, RecordingInputRoute>>;
	readonly offsets: Readonly<Record<string, number>>;
}

export interface RecordingInputTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type?: string;
}

export interface RecordingPoolSource extends Readonly<Record<string, unknown>> {
	readonly key: string;
	readonly kind: 'device' | 'display';
	readonly deviceId?: string;
	readonly channelCount: number;
}

export interface PreparedRecordingInputs {
	readonly inputKeys?: readonly string[];
}

export interface RecordingInputCoordinationState {
	disposed: boolean;
	microphoneMetering: boolean;
	recorder: unknown | null;
	recordingPoolSources: readonly RecordingPoolSource[];
	recordingRouteHealth: Record<string, string>;
	recordingRouting: RecordingInputRouting;
	selectedTrackId: string | null;
	timedRecording: PreparedRecordingInputs | null;
	timedRecordingPreparing: boolean;
}

interface RecordingInputCapturePool {
	acquireDisplay(): Promise<unknown>;
	acquireHardware(
		deviceId: string,
		options: Readonly<{ channelCount: number; sampleRate: number }>,
	): Promise<unknown>;
}

interface RecordingInputOperationScope {
	assertCurrent(): void;
}

interface RecordingInputMeterPort {
	clearRoutedLoudnessMeter(): void;
	getRoute(): RecordingDeviceRoute;
	getRouteKey(route?: RecordingDeviceRoute): string;
	invalidate(): number;
	isGeneration(generation: number): boolean;
	reconcileInput(options?: Readonly<{ endedSession?: MicrophoneMeterSession | null }>): boolean;
	setMicrophoneMetering(enabled: unknown): Promise<boolean>;
	stopMicrophoneMetering(options?: Readonly<{
		releaseInput?: boolean;
		preserveReading?: boolean;
	}>): void;
}

interface RecordingRoutingCoordinationPort {
	persistRecordingRouting(): Promise<unknown>;
	releaseUnretainedRecordingInputs(options?: Readonly<{ force?: boolean }>): unknown;
	syncRecordingPoolSnapshot(): void;
	updateRecordingDeviceRows(): void;
}

export interface RecordingInputCoordinationRuntime {
	readonly state: RecordingInputCoordinationState;
	readonly capturePool: RecordingInputCapturePool;
	readonly captureOperation: () => RecordingInputOperationScope;
	readonly meter: RecordingInputMeterPort;
	readonly routing: RecordingRoutingCoordinationPort;
	readonly cancelTimedRecording: () => unknown;
	readonly getTrack: (trackId: string) => RecordingInputTrack | null;
	readonly projectSampleRate: () => number;
	readonly publishDocumentSnapshot: () => void;
	readonly recordingRouteSourceKey: (route: RecordingInputRoute) => string;
	readonly setRecordingTrackRoute: (
		routing: RecordingInputRouting,
		track: RecordingInputTrack | null,
		route: RecordingInputRoute | null,
	) => RecordingInputRouting;
	readonly streamAudioChannelCount: (stream: unknown) => number;
}

export interface RecordingInputCoordinationService {
	setRecordingTrackInput(
		trackId: string,
		route: RecordingInputRoute | null,
	): Promise<RecordingInputRoute | null>;
	handleRecordingPoolChange(sources?: readonly RecordingPoolSource[] | null): void;
	reconcileMicrophoneMeterInput(options?: Readonly<{
		endedSession?: MicrophoneMeterSession | null;
	}>): boolean;
}

/**
 * Coordinate route mutations with capture-pool and microphone-meter lifecycles.
 * Persistence, pool retention, and meter-session ownership remain in their
 * focused services and are consumed only through the narrow ports above.
 */
export function createRecordingInputCoordinationService(
	runtime: RecordingInputCoordinationRuntime,
): Readonly<RecordingInputCoordinationService> {
	const { state } = runtime;
	const trackOperationGenerations = new Map<string, number>();
	let operationGeneration = 0;

	return Object.freeze({
		setRecordingTrackInput,
		handleRecordingPoolChange,
		reconcileMicrophoneMeterInput,
	});

	async function setRecordingTrackInput(
		trackId: string,
		route: RecordingInputRoute | null,
	): Promise<RecordingInputRoute | null> {
		if (state.timedRecordingPreparing || state.timedRecording) {
			return state.recordingRouting.routes[trackId] || null;
		}
		const capturedOperation = runtime.captureOperation();
		const generation = ++operationGeneration;
		trackOperationGenerations.set(trackId, generation);
		const operation = Object.freeze({
			assertCurrent() {
				capturedOperation.assertCurrent();
				if (trackOperationGenerations.get(trackId) !== generation) {
					throw new DOMException('The recording input assignment was superseded.', 'AbortError');
				}
			},
		});
		operation.assertCurrent();
		const meterRouteBefore = state.microphoneMetering ? runtime.meter.getRoute() : null;
		const track = runtime.getTrack(trackId);
		state.recordingRouting = runtime.setRecordingTrackRoute(state.recordingRouting, track, route);
		if (trackId === state.selectedTrackId) runtime.meter.clearRoutedLoudnessMeter();
		if (route == null) delete state.recordingRouteHealth[trackId];
		else state.recordingRouteHealth[trackId] = 'unavailable';
		runtime.routing.updateRecordingDeviceRows();
		runtime.publishDocumentSnapshot();
		const persist = runtime.routing.persistRecordingRouting();
		const normalized = state.recordingRouting.routes[trackId] || null;
		const meterRouteAfter = state.microphoneMetering ? runtime.meter.getRoute() : null;
		const restartMetering = Boolean(
			state.microphoneMetering
			&& !state.recorder
			&& runtime.meter.getRouteKey(meterRouteBefore ?? undefined)
				!== runtime.meter.getRouteKey(meterRouteAfter ?? undefined),
		);
		let meterRestartGeneration: number | null = null;
		if (restartMetering) {
			meterRestartGeneration = runtime.meter.invalidate();
			runtime.meter.stopMicrophoneMetering({
				releaseInput: meterRouteBefore?.deviceId !== meterRouteAfter?.deviceId,
			});
		}
		if (!normalized) {
			await persist;
			operation.assertCurrent();
			await restartMeterIfCurrent(restartMetering, meterRestartGeneration, operation);
			return null;
		}
		try {
			const stream = normalized.kind === 'display'
				? await runtime.capturePool.acquireDisplay()
				: await runtime.capturePool.acquireHardware(normalized.deviceId, {
					channelCount: normalized.channelStart + normalized.channelCount,
					sampleRate: runtime.projectSampleRate(),
				});
			operation.assertCurrent();
			const availableChannels = runtime.streamAudioChannelCount(stream);
			state.recordingRouteHealth[trackId] = normalized.kind === 'display'
				|| normalized.channelStart + normalized.channelCount <= availableChannels
				? 'open'
				: 'unavailable';
			runtime.routing.syncRecordingPoolSnapshot();
			if (!state.recorder) {
				runtime.routing.releaseUnretainedRecordingInputs();
				runtime.routing.syncRecordingPoolSnapshot();
			}
		} catch {
			operation.assertCurrent();
			// Keep the pin visible when a source is missing, denied, or ends while opening.
			state.recordingRouteHealth[trackId] = 'unavailable';
		}
		await persist;
		operation.assertCurrent();
		runtime.routing.updateRecordingDeviceRows();
		runtime.publishDocumentSnapshot();
		await restartMeterIfCurrent(restartMetering, meterRestartGeneration, operation);
		return normalized;
	}

	async function restartMeterIfCurrent(
		restartMetering: boolean,
		generation: number | null,
		operation: RecordingInputOperationScope,
	): Promise<void> {
		operation.assertCurrent();
		if (restartMetering
			&& state.microphoneMetering
			&& generation !== null
			&& runtime.meter.isGeneration(generation)) {
			await runtime.meter.setMicrophoneMetering(true);
			operation.assertCurrent();
		}
	}

	function handleRecordingPoolChange(
		sources: readonly RecordingPoolSource[] | null = null,
	): void {
		state.recordingPoolSources = Object.freeze(sources || []);
		const scheduled = state.timedRecording;
		if (scheduled?.inputKeys?.length) {
			const openKeys = new Set(state.recordingPoolSources.map((source) => source.key));
			if (scheduled.inputKeys.some((key) => !openKeys.has(key))) {
				runtime.cancelTimedRecording();
				return;
			}
		}
		if (!state.recorder) reconcileRouteHealth();
		runtime.routing.updateRecordingDeviceRows();
		reconcileMicrophoneMeterInput();
		if (!state.disposed) runtime.publishDocumentSnapshot();
	}

	function reconcileRouteHealth(): void {
		const open = new Map(state.recordingPoolSources.map((source) => [source.key, source]));
		for (const [trackId, route] of Object.entries(state.recordingRouting.routes)) {
			const previous = state.recordingRouteHealth[trackId];
			const source = open.get(runtime.recordingRouteSourceKey(route));
			state.recordingRouteHealth[trackId] = source
				? route.kind === 'display'
					|| route.channelStart + route.channelCount <= source.channelCount
					? 'open'
					: 'skipped'
				: previous === 'disconnected'
					? 'disconnected'
					: 'unavailable';
		}
	}

	function reconcileMicrophoneMeterInput(
		options: Readonly<{ endedSession?: MicrophoneMeterSession | null }> = {},
	): boolean {
		return runtime.meter.reconcileInput(options);
	}
}
