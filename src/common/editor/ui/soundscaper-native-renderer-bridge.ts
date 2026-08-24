/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSoundscaperNativeAudioRenderer } from '../soundscaper-native-audio-renderer.ts';
import {
	acceptNativePluginPortOffer,
	createNativePluginEffectNode,
	ensureNativePluginRealtimeWorklet,
	loadNativePluginRuntimeState,
	openNativePluginRuntimeVendorUi,
	closeNativePluginRuntimeVendorUi,
	nativePluginReportedLatencyFrames,
	registerNativePluginRuntimeIdentity,
	registerNativePluginOfflineRuntimeProvider,
	releaseNativePluginRuntime,
	saveNativePluginRuntimeState,
	setNativePluginBypassed,
	subscribeNativePluginRuntime,
	waitForNativePluginRuntime,
} from '../native-plugin-realtime-node.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { EnginePublicApi } from '../engine/public-api.ts';
import type {
	NativeAudioSessionOpenRequestV1,
	NativePluginInstanceProjectionV1,
	NativePluginProjectStateV1,
	SoundscaperNativeServicesBridge,
} from './soundscaper-native-services-bridge.ts';
import { createSoundscaperNativePluginProjectBinding } from './soundscaper-native-plugin-project-binding.ts';
import {
	createNativePluginStateCaptureProvider,
	registerNativePluginStateQuiescence,
} from '../native-plugin-state-quiescence.ts';
import { adaptNativeAudioInventory, type NativeAudioInventory } from '../controller/native-audio-inventory.ts';
import { soundscaperNativeAudioCaptureHasActiveLease } from '../soundscaper-native-audio-capture.ts';

const PLUGIN_PORT_EVENT = 'soundscaper-native-plugin-rpc-port-v1';

type NativeControllerPort = Parameters<typeof createSoundscaperNativePluginProjectBinding>[0];
type NativeAudioControllerPort = NativeControllerPort & Readonly<{
	state?: Readonly<{
		monitoring?: boolean; microphoneMetering?: boolean; recorder?: unknown;
		recordingStarting?: boolean; recordingFinishing?: boolean;
		timedRecordingPreparing?: boolean; timedRecording?: unknown; timedRecordingCancelling?: boolean;
		recordingPoolSources?: readonly unknown[];
	}>;
	refreshAudioDevices?(options: Readonly<{
		probe: false; nativeInventory: NativeAudioInventory;
	}>): Promise<unknown>;
}>;

/** Adds renderer-owned direct-port lifecycle without widening the preload API. */
export function createSoundscaperNativeRendererBridge(options: Readonly<{
	bridge: SoundscaperNativeServicesBridge;
	engine: EnginePublicApi;
	controller?: NativeAudioControllerPort | null;
	windowValue?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}>) {
	const audioReportTails = new Map<string, Promise<void>>();
	const nativeInventories = new Map<string, NativeAudioInventory>();
	const enqueueAudioReport = (sessionId: string, operation: () => Promise<unknown>): Promise<void> => {
		const pending = (audioReportTails.get(sessionId) ?? Promise.resolve())
			.then(operation, operation).then(() => undefined, () => undefined);
		audioReportTails.set(sessionId, pending);
		void pending.finally(() => {
			if (audioReportTails.get(sessionId) === pending) audioReportTails.delete(sessionId);
		});
		return pending;
	};
	const audio = createSoundscaperNativeAudioRenderer({
		engine: options.engine,
		windowValue: options.windowValue,
		onTransfer: (sessionId, value) => {
			void enqueueAudioReport(sessionId, () => options.bridge.reportNativeAudioSessionTransfer({
				sessionId, ...value,
			}));
		},
		onDeviceLoss: (sessionId, reason) => enqueueAudioReport(sessionId,
			() => options.bridge.reportNativeAudioSessionLoss({ sessionId, reason })),
	});
	const project = options.controller
		? createSoundscaperNativePluginProjectBinding(options.controller, options.engine)
		: null;
	const windowValue = options.windowValue ?? (typeof window === 'undefined' ? null : window);
	const audioSessionIds = new Set<string>();
	const instanceIds = new Set<string>();
	const processorIds = new Set<string>();
	const restoringIds = new Set<string>();
	const generations = new Map<string, number>();
	const activeStateKeys = new Map<string, string>();
	const offlineInstanceIds = new Set<string>();
	let offlineSequence = 0;
	let reconciliation: Promise<readonly unknown[]> = Promise.resolve([]);
	let disposal: Promise<void> | null = null;
	let listening = false;
	const receive = (event: Event): void => {
		const message = event as MessageEvent<unknown>;
		const data = message.data as Readonly<{ type?: unknown; offer?: unknown }> | null;
		if (data?.type !== PLUGIN_PORT_EVENT) return;
		acceptNativePluginPortOffer(data.offer, Array.from(message.ports ?? []));
	};
	const listen = (): void => {
		if (listening || !windowValue) return;
		listening = true;
		windowValue.addEventListener('message', receive);
	};
	const unsubscribe = subscribeNativePluginRuntime((event: Readonly<{
		instanceId: string; latencyFrames: number | null; state: string;
	}>) => {
		const transition = project?.runtime(event.instanceId, event.latencyFrames, event.state);
		if (transition?.bypassed) {
			setNativePluginBypassed(event.instanceId, true, transition.contextTime);
		}
	});
	const unregisterOffline = registerNativePluginOfflineRuntimeProvider(async (request: Readonly<{
		instanceId: string; state: NativePluginProjectStateV1; sampleRate: number;
	}>) => {
		assertRuntimeOpen();
		listen();
		const runtimeInstanceId = offlineInstanceId(request.instanceId, ++offlineSequence);
		let acquired = false;
		try {
			const instance = await options.bridge.instantiateNativePlugin({
				installationId: installationIdFor(request.state.binarySha256, request.state.stablePluginId),
				instanceId: runtimeInstanceId,
				sampleRate: request.sampleRate,
			});
			acquired = true;
			offlineInstanceIds.add(runtimeInstanceId);
			assertRuntimeOpen();
			assertOfflineIdentity(instance, request.state, runtimeInstanceId);
			registerNativePluginRuntimeIdentity(runtimeInstanceId, instance.format, instance);
			const restored = await (options.bridge.restoreNativePluginState({
				instanceId: runtimeInstanceId, generation: 1, stateBody: request.state.stateBody,
			}) as unknown as Promise<{ projectState: NativePluginProjectStateV1; bytes: Uint8Array }>);
			return Object.freeze({
				runtimeInstanceId,
				stateBytes: restored.bytes,
				async dispose(): Promise<void> {
					if (!offlineInstanceIds.delete(runtimeInstanceId)) return;
					await options.bridge.closeNativePluginInstance({ instanceId: runtimeInstanceId });
				},
			});
		} catch (error) {
			if (acquired) await options.bridge.closeNativePluginInstance({ instanceId: runtimeInstanceId }).catch(() => false);
			offlineInstanceIds.delete(runtimeInstanceId);
			releaseNativePluginRuntime(runtimeInstanceId);
			throw error;
		}
	});
	const bridge = Object.freeze({
		...options.bridge,
		async describeNativeAudioBackend(request: Readonly<{ backend: string }>) {
			const outcome = await options.bridge.describeNativeAudioBackend(request);
			if (outcome.status === 'described') {
				const nativeInventory = adaptNativeAudioInventory(outcome.inventory);
				nativeInventories.set(nativeInventory.backend, nativeInventory);
			} else nativeInventories.delete(request.backend);
			await publishNativeInventories();
			return outcome;
		},
		async setNativeAudioHelperEnabled(enabled: boolean) {
			try { return await options.bridge.setNativeAudioHelperEnabled(enabled); }
			finally { if (!enabled) {
				nativeInventories.clear();
				await Promise.all([closeOwnedAudioSessions(), publishNativeInventories()]);
			} }
		},
		async openNativeAudioSession(request: NativeAudioSessionOpenRequestV1) {
			assertRuntimeOpen();
			const outcome = await options.bridge.openNativeAudioSession(request);
			if (outcome.status !== 'opened') return outcome;
			try {
				assertRuntimeOpen();
				const deviceHandle = outcome.deviceHandle
					?? request.candidates.find((candidate) => candidate.backend === outcome.backend)?.deviceHandle;
				if (!deviceHandle) throw new Error('The opened native audio route did not identify its device.');
				await audio.prepare(outcome.sessionId, request, { backend: outcome.backend, deviceHandle });
				assertRuntimeOpen();
			}
			catch (error) {
				await options.bridge.closeNativeAudioSession({ sessionId: outcome.sessionId }).catch(() => false);
				await audio.release(outcome.sessionId);
				throw error;
			}
			audioSessionIds.add(outcome.sessionId);
			return outcome;
		},
		async nativeAudioSessionStatus(request: Readonly<{ sessionId: string }>) {
			return withRendererCalibrationAvailability(await options.bridge.nativeAudioSessionStatus(request));
		},
		async calibrateNativeAudioSession(request: Readonly<{ sessionId: string }>) {
			assertCalibrationIdle();
			const calibrationFrames = await audio.calibrate(request.sessionId);
			return withRendererCalibrationAvailability(await options.bridge.calibrateNativeAudioSession({
				sessionId: request.sessionId, calibrationFrames,
			}));
		},
		async closeNativeAudioSession(request: Readonly<{ sessionId: string }>) {
			audioSessionIds.delete(request.sessionId);
			await audio.release(request.sessionId);
			await audioReportTails.get(request.sessionId);
			try { return await options.bridge.closeNativeAudioSession(request); }
			finally { audioReportTails.delete(request.sessionId); }
		},
		async instantiateNativePlugin(request: Readonly<{ installationId: string; instanceId: string | null }>) {
			assertRuntimeOpen();
			listen();
			const context = await options.engine.getAudioContext({ resume: true });
			await ensureNativePluginRealtimeWorklet(context);
			const instance = await options.bridge.instantiateNativePlugin({
				...request, sampleRate: context.sampleRate,
			});
			instanceIds.add(instance.instanceId);
			try {
				assertRuntimeOpen();
				registerNativePluginRuntimeIdentity(instance.instanceId, instance.format, instance);
				prepareStateNode(context, instance);
				await waitForNativePluginRuntime(instance.instanceId);
				const projected = withTransportLatency(instance);
				const state = await saveNativePluginRuntimeState(instance.instanceId);
				const persisted = await persistThroughMain(instance.instanceId, 1, state);
				if (!persisted.projectState) throw new Error('The initial native plug-in state was not persisted.');
				const projectState = withProjectLatency(persisted.projectState, projected.latencySamples);
				project?.insert(projected, projectState);
				activeStateKeys.set(instance.instanceId, stateKey(projectState));
				generations.set(instance.instanceId, 1);
			}
			catch (error) {
				await options.bridge.closeNativePluginInstance({ instanceId: instance.instanceId }).catch(() => false);
				releaseNativePluginRuntime(instance.instanceId);
				instanceIds.delete(instance.instanceId);
				processorIds.delete(instance.instanceId);
				throw error;
			}
			return withTransportLatency(instance);
		},
		async setNativePluginBypassed(request: Readonly<{ instanceId: string; bypassed: boolean }>) {
			const instance = await options.bridge.setNativePluginBypassed(request);
			const transition = project?.setBypassed(request.instanceId, request.bypassed);
			setNativePluginBypassed(request.instanceId, request.bypassed, transition?.contextTime);
			return instance;
		},
		async persistNativePluginState(request: Readonly<{ instanceId: string; generation: number }>) {
			const state = await saveNativePluginRuntimeState(request.instanceId);
			const generation = nextGeneration(request.instanceId, request.generation);
			const persisted = await persistThroughMain(request.instanceId, generation, state);
			generations.set(request.instanceId, generation);
			if (persisted.projectState) {
				const projectState = withProjectLatency(
					persisted.projectState, nativePluginReportedLatencyFrames(request.instanceId),
				);
				project?.persist(projectState);
				activeStateKeys.set(request.instanceId, stateKey(projectState));
			}
			return persisted;
		},
		async restoreNativePluginState(request: Readonly<{
			instanceId: string; generation: number;
			stateBody: Readonly<{ kind: 'native-plugin-state'; bodyId: string; byteLength: number; sha256: string }>;
		}>) {
			const generation = nextGeneration(request.instanceId, request.generation);
			const restored = await (options.bridge.restoreNativePluginState({
				...request, generation,
			}) as unknown as Promise<{
				projectState: NativePluginProjectStateV1; bytes: Uint8Array;
			}>);
			await loadNativePluginRuntimeState(request.instanceId, restored.bytes);
			generations.set(request.instanceId, generation);
			const projectState = withProjectLatency(
				restored.projectState, nativePluginReportedLatencyFrames(request.instanceId),
			);
			project?.persist(projectState);
			activeStateKeys.set(request.instanceId, stateKey(projectState));
			return Object.freeze({ projectState: restored.projectState });
		},
		async openNativePluginVendorUi(request: Readonly<{ instanceId: string }>) {
			const outcome = await options.bridge.openNativePluginVendorUi(request);
			if (outcome.status !== 'opened') return outcome;
			try {
				await openNativePluginRuntimeVendorUi(request.instanceId, outcome.window.windowHandleId);
				return outcome;
			} catch (error) {
				await options.bridge.closeNativePluginVendorUi({
					instanceId: request.instanceId, windowHandleId: outcome.window.windowHandleId,
				}).catch(() => false);
				throw error;
			}
		},
		async closeNativePluginVendorUi(request: Readonly<{ instanceId: string; windowHandleId: string }>) {
			try { await closeNativePluginRuntimeVendorUi(request.instanceId, request.windowHandleId); }
			finally { return options.bridge.closeNativePluginVendorUi(request); }
		},
		async closeNativePluginInstance(request: Readonly<{ instanceId: string }>) {
			const transition = project?.setBypassed(request.instanceId, true);
			setNativePluginBypassed(request.instanceId, true, transition?.contextTime);
			try { return await options.bridge.closeNativePluginInstance(request); }
			finally {
				releaseNativePluginRuntime(request.instanceId);
				instanceIds.delete(request.instanceId);
				processorIds.delete(request.instanceId);
				generations.delete(request.instanceId);
				activeStateKeys.delete(request.instanceId);
			}
		},
	}) satisfies SoundscaperNativeServicesBridge;
	const unregisterStateQuiescence = options.controller
		? registerNativePluginStateQuiescence(options.controller, createNativePluginStateCaptureProvider({
			getProject: () => options.controller?.project,
			isActive: (instanceId) => instanceIds.has(instanceId) && activeStateKeys.has(instanceId),
			persist: (instanceId) => bridge.persistNativePluginState({
				instanceId, generation: (generations.get(instanceId) ?? 0) + 1,
			}),
		}))
		: () => undefined;
	return Object.freeze({
		bridge,
		restoreProjectNativePlugins,
		dispose: () => {
			disposal ??= disposeRenderer();
			return disposal;
		},
	});

	async function closeOwnedAudioSessions(): Promise<void> {
		const closing = [...audioSessionIds];
		audioSessionIds.clear();
		await audio.release();
		await Promise.all(closing.map((sessionId) => audioReportTails.get(sessionId)));
		await Promise.allSettled(closing.map(
			(sessionId) => options.bridge.closeNativeAudioSession({ sessionId }),
		));
		for (const sessionId of closing) audioReportTails.delete(sessionId);
	}

	async function publishNativeInventories(): Promise<void> {
		if (!options.controller?.refreshAudioDevices) return;
		const inventories = [...nativeInventories.values()]
			.sort((left, right) => left.backend < right.backend ? -1 : left.backend > right.backend ? 1 : 0);
		await options.controller.refreshAudioDevices({
			probe: false,
			nativeInventory: Object.freeze({
				backend: 'native', status: 'ready', detail: '',
				inputs: Object.freeze(inventories.flatMap((inventory) => inventory.inputs)),
				outputs: Object.freeze(inventories.flatMap((inventory) => inventory.outputs)),
				rejected: Object.freeze(inventories.flatMap((inventory) => inventory.rejected)),
			}),
		});
	}

	async function disposeRenderer(): Promise<void> {
		unregisterStateQuiescence();
		unsubscribe();
		unregisterOffline();
		if (listening) windowValue?.removeEventListener('message', receive);
		listening = false;
		const closingPlugins = new Set([...instanceIds, ...offlineInstanceIds]);
		instanceIds.clear();
		offlineInstanceIds.clear();
		await closeOwnedAudioSessions();
		await Promise.allSettled([...closingPlugins].map(
			(instanceId) => options.bridge.closeNativePluginInstance({ instanceId }),
		));
		await audio.dispose();
		for (const instanceId of new Set([...processorIds, ...closingPlugins])) {
			releaseNativePluginRuntime(instanceId);
		}
		processorIds.clear();
		generations.clear();
		activeStateKeys.clear();
	}

	function assertRuntimeOpen(): void {
		if (disposal !== null) throw new Error('The Soundscaper native workspace runtime is closing.');
	}

	function calibrationBusy(): boolean {
		const state = options.controller?.state;
		return options.engine.getState().state !== 'stopped' || !state
			|| state.monitoring === true || state.microphoneMetering === true || Boolean(state.recorder)
			|| state.recordingStarting === true || state.recordingFinishing === true
			|| state.timedRecordingPreparing === true || Boolean(state.timedRecording)
			|| state.timedRecordingCancelling === true || (state.recordingPoolSources?.length ?? 0) > 0
			|| soundscaperNativeAudioCaptureHasActiveLease();
	}

	function assertCalibrationIdle(): void {
		if (calibrationBusy()) {
			throw new Error('Latency calibration requires stopped playback and idle recording, monitoring, metering, and capture.');
		}
	}

	function withRendererCalibrationAvailability<Projection extends Readonly<{
		calibrationAvailable: boolean; calibrationUnavailableReason: unknown;
	}>>(projection: Projection): Projection {
		return projection.calibrationAvailable && calibrationBusy()
			? Object.freeze({ ...projection, calibrationAvailable: false,
				calibrationUnavailableReason: 'renderer-busy' }) : projection;
	}

	function restoreProjectNativePlugins(): Promise<readonly unknown[]> {
		reconciliation = reconciliation.then(reconcileProjectNativePlugins, reconcileProjectNativePlugins);
		return reconciliation;
	}

	async function reconcileProjectNativePlugins(): Promise<readonly unknown[]> {
		assertRuntimeOpen();
		listen();
		const states = projectPluginStates(options.controller?.project);
		const desired = new Map(states
			.filter((state) => state.enabled && !state.bypassed && state.continuity === 'live')
			.map((state) => [state.instanceId, stateKey(state)]));
		for (const [instanceId, activeKey] of activeStateKeys) {
			if (desired.get(instanceId) === activeKey) continue;
			await options.bridge.closeNativePluginInstance({ instanceId }).catch(() => false);
			releaseNativePluginRuntime(instanceId);
			activeStateKeys.delete(instanceId);
			instanceIds.delete(instanceId);
			processorIds.delete(instanceId);
			generations.delete(instanceId);
		}
		if (!states.some((state) => state.enabled && !state.bypassed && state.continuity === 'live')) {
			return Object.freeze([]);
		}
		const context = await options.engine.getAudioContext({ resume: false });
		await ensureNativePluginRealtimeWorklet(context);
		const outcomes = [];
		for (const state of states) {
			if (!state.enabled || state.bypassed || state.continuity !== 'live') continue;
			if (activeStateKeys.get(state.instanceId) === stateKey(state)
				|| restoringIds.has(state.instanceId)) continue;
			restoringIds.add(state.instanceId);
			let acquired = false;
			try {
				const instance = await options.bridge.instantiateNativePlugin({
					installationId: installationIdFor(state.binarySha256, state.stablePluginId),
					instanceId: state.instanceId,
					sampleRate: context.sampleRate,
				});
				acquired = true;
				instanceIds.add(instance.instanceId);
				assertRuntimeOpen();
				assertRestoredIdentity(instance, state);
				registerNativePluginRuntimeIdentity(instance.instanceId, instance.format, instance);
				prepareStateNode(context, instance);
				await waitForNativePluginRuntime(instance.instanceId);
				const projected = withTransportLatency(instance);
				const restored = await (options.bridge.restoreNativePluginState({
					instanceId: instance.instanceId, generation: 1, stateBody: state.stateBody,
				}) as unknown as Promise<{ projectState: NativePluginProjectStateV1; bytes: Uint8Array }>);
				await loadNativePluginRuntimeState(instance.instanceId, restored.bytes);
				const persistedState = withProjectLatency(restored.projectState, projected.latencySamples);
				project?.restore(projected, persistedState);
				activeStateKeys.set(instance.instanceId, stateKey(persistedState));
				generations.set(instance.instanceId, 1);
				outcomes.push(Object.freeze({ instanceId: state.instanceId, status: 'restored' as const }));
			} catch (error) {
				if (acquired) {
					await options.bridge.closeNativePluginInstance({ instanceId: state.instanceId }).catch(() => false);
					const transition = project?.runtime(state.instanceId, 0, 'host-lost');
					setNativePluginBypassed(state.instanceId, true, transition?.contextTime);
					releaseNativePluginRuntime(state.instanceId);
					instanceIds.delete(state.instanceId);
					processorIds.delete(state.instanceId);
				}
				outcomes.push(Object.freeze({
					instanceId: state.instanceId, status: 'bypassed' as const,
					detail: error instanceof Error ? error.message : String(error),
				}));
			} finally { restoringIds.delete(state.instanceId); }
		}
		return Object.freeze(outcomes);
	}

	function prepareStateNode(context: BaseAudioContext, instance: NativePluginInstanceProjectionV1): void {
		createNativePluginEffectNode(context, {
			type: 'native-plugin', bypassed: instance.bypassed,
			params: { instanceId: instance.instanceId },
		}, instance.inputChannels, instance.outputChannels);
		processorIds.add(instance.instanceId);
	}

	function persistThroughMain(instanceId: string, generation: number, state: Readonly<Record<string, unknown>>) {
		return (options.bridge.persistNativePluginState as unknown as (
			value: Readonly<Record<string, unknown>>,
		) => ReturnType<SoundscaperNativeServicesBridge['persistNativePluginState']>)({
			instanceId, generation, ...state,
		});
	}

	function nextGeneration(instanceId: string, requested: number): number {
		return Math.max(requested, (generations.get(instanceId) ?? 0) + 1);
	}

	function withTransportLatency(
		instance: NativePluginInstanceProjectionV1,
	): NativePluginInstanceProjectionV1 {
		const latencySamples = nativePluginReportedLatencyFrames(instance.instanceId, instance.latencySamples);
		return Object.freeze({ ...instance, latencySamples });
	}
}

const TEXT_ENCODER = new TextEncoder();
function installationIdFor(binarySha256: string, stableId: string): string {
	return `i${bytesToHex(sha256(TEXT_ENCODER.encode(`${binarySha256}\0${stableId}`))).slice(0, 15)}`;
}

function projectPluginStates(project: unknown): readonly NativePluginProjectStateV1[] {
	const states = (project as { readonly nativePluginStates?: unknown } | null)?.nativePluginStates;
	return Array.isArray(states) ? states as readonly NativePluginProjectStateV1[] : Object.freeze([]);
}

function withProjectLatency(
	state: NativePluginProjectStateV1,
	latencySamples: number,
): NativePluginProjectStateV1 {
	return Object.freeze({ ...state, latencySamples });
}

function stateKey(state: NativePluginProjectStateV1): string {
	return [state.format, state.stablePluginId, state.binarySha256, state.stateBody.sha256,
		state.stateBody.byteLength, state.latencySamples, state.enabled, state.bypassed, state.continuity].join('\0');
}

function assertRestoredIdentity(
	instance: NativePluginInstanceProjectionV1,
	state: NativePluginProjectStateV1,
): void {
	if (instance.instanceId !== state.instanceId || instance.format !== state.format
		|| instance.stablePluginId !== state.stablePluginId
		|| instance.binarySha256 !== state.binarySha256) {
		throw new Error('The installed native plug-in no longer matches the persisted project identity.');
	}
}

function offlineInstanceId(instanceId: string, sequence: number): string {
	return `o${bytesToHex(sha256(TEXT_ENCODER.encode(`${instanceId}\0${String(sequence)}`))).slice(0, 31)}`;
}

function assertOfflineIdentity(
	instance: NativePluginInstanceProjectionV1,
	state: NativePluginProjectStateV1,
	runtimeInstanceId: string,
): void {
	if (instance.instanceId !== runtimeInstanceId || instance.format !== state.format
		|| instance.stablePluginId !== state.stablePluginId || instance.binarySha256 !== state.binarySha256) {
		throw new Error('The offline native plug-in no longer matches the persisted project identity.');
	}
}
