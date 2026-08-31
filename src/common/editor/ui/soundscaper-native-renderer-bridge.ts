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
import { createSoundscaperNativeRendererOperationBarrier } from './soundscaper-native-renderer-operation-barrier.ts';
import {
	assertRestoredNativePluginIdentity as assertRestoredIdentity,
	captureSoundscaperNativeProjectOperation, nativePluginProjectStateKey as stateKey,
	nextNativePluginGeneration, projectPluginStates, withProjectLatency,
} from './soundscaper-native-renderer-project-operation.ts';
import { closeSoundscaperNativePluginVendorUi } from './soundscaper-native-vendor-ui-close.ts';

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
	const suppressedRuntimeEvents = new Set<string>();
	const restoringIds = new Set<string>();
	const generations = new Map<string, number>();
	const activeStateKeys = new Map<string, string>();
	const releaseRendererPluginRuntime = (instanceId: string): void => {
		suppressedRuntimeEvents.add(instanceId);
		try { releaseNativePluginRuntime(instanceId); } finally { suppressedRuntimeEvents.delete(instanceId); }
	};
	const offlineInstanceIds = new Set<string>();
	const ownershipOperations = createSoundscaperNativeRendererOperationBarrier();
	let offlineSequence = 0;
	let reconciliation: Promise<readonly unknown[]> = Promise.resolve([]);
	let disposal: Promise<void> | null = null;
	let closing = false;
	let listening = false;
	const receive = (event: Event): void => {
		const message = event as MessageEvent<unknown>;
		// The preload relay posts to its own window; a message from any other
		// source — an embedded frame above all — must not attach a plug-in port.
		const sourceWindow = (windowValue as { window?: Window } | null)?.window
			?? (typeof window === 'undefined' ? null : window);
		if (message.source !== sourceWindow) return;
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
		if (suppressedRuntimeEvents.has(event.instanceId)) return;
		const transition = project?.runtime(event.instanceId, event.latencyFrames, event.state);
		if (transition?.bypassed) {
			setNativePluginBypassed(event.instanceId, true, transition.contextTime);
		}
	});
	const unregisterOffline = registerNativePluginOfflineRuntimeProvider(ownershipOperations.wrap(async (request: Readonly<{
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
					if (!offlineInstanceIds.has(runtimeInstanceId)) return;
					await closeOwnedPluginInstance(runtimeInstanceId);
				},
			});
		} catch (error) {
			if (acquired) await closeOwnedPluginInstance(runtimeInstanceId).catch(() => false);
			releaseRendererPluginRuntime(runtimeInstanceId);
			throw error;
		}
	}));
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
		openNativeAudioSession: ownershipOperations.wrap(async (request: NativeAudioSessionOpenRequestV1) => {
			assertRuntimeOpen();
			const outcome = await options.bridge.openNativeAudioSession(request);
			if (outcome.status !== 'opened') return outcome;
			audioSessionIds.add(outcome.sessionId);
			try {
				assertRuntimeOpen();
				const deviceHandle = outcome.deviceHandle
					?? request.candidates.find((candidate) => candidate.backend === outcome.backend)?.deviceHandle;
				if (!deviceHandle) throw new Error('The opened native audio route did not identify its device.');
				await audio.prepare(outcome.sessionId, request, { backend: outcome.backend, deviceHandle });
				assertRuntimeOpen();
			}
			catch (error) {
				const closed = await options.bridge.closeNativeAudioSession({
					sessionId: outcome.sessionId,
				}).catch(() => false);
				if (closed) audioSessionIds.delete(outcome.sessionId);
				await audio.release(outcome.sessionId);
				throw error;
			}
			return outcome;
		}),
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
			await audio.release(request.sessionId);
			await audioReportTails.get(request.sessionId);
			try {
				const closed = await options.bridge.closeNativeAudioSession(request);
				if (closed) audioSessionIds.delete(request.sessionId);
				return closed;
			}
			finally { audioReportTails.delete(request.sessionId); }
		},
		instantiateNativePlugin: ownershipOperations.wrap(async (request: Readonly<{
			installationId: string; instanceId: string | null;
		}>) => {
			const projectOperation = captureSoundscaperNativeProjectOperation(options.controller);
			assertRuntimeOpen();
			listen();
			const context = await options.engine.getAudioContext({ resume: true });
			await ensureNativePluginRealtimeWorklet(context);
			projectOperation.assertCurrent();
			const instance = await options.bridge.instantiateNativePlugin({
				...request, sampleRate: context.sampleRate,
			});
			instanceIds.add(instance.instanceId);
			try {
				assertRuntimeOpen();
				projectOperation.assertCurrent();
				registerNativePluginRuntimeIdentity(instance.instanceId, instance.format, instance);
				prepareStateNode(context, instance);
				await waitForNativePluginRuntime(instance.instanceId);
				projectOperation.assertCurrent();
				const projected = withTransportLatency(instance);
				const state = await saveNativePluginRuntimeState(instance.instanceId);
				projectOperation.assertCurrent();
				const persisted = await persistThroughMain(instance.instanceId, 1, state);
				projectOperation.assertCurrent();
				if (!persisted.projectState) throw new Error('The initial native plug-in state was not persisted.');
				const projectState = withProjectLatency(persisted.projectState, projected.latencySamples);
				project?.insert(projected, projectState, projectOperation);
				activeStateKeys.set(instance.instanceId, stateKey(projectState, projectOperation.projectId));
				generations.set(instance.instanceId, 1);
			}
			catch (error) {
				await closeOwnedPluginInstance(instance.instanceId).catch(() => false);
				releaseRendererPluginRuntime(instance.instanceId);
				processorIds.delete(instance.instanceId);
				throw error;
			}
			return withTransportLatency(instance);
		}),
		async setNativePluginBypassed(request: Readonly<{ instanceId: string; bypassed: boolean }>) {
			const bypassed = project?.admitBypassed(request.instanceId, request.bypassed) ?? request.bypassed;
			const instance = await options.bridge.setNativePluginBypassed({ ...request, bypassed });
			const update = project?.setBypassed(request.instanceId, bypassed);
			setNativePluginBypassed(request.instanceId, update?.bypassed ?? bypassed, update?.transition?.contextTime);
			return instance;
		},
		async persistNativePluginState(request: Readonly<{ instanceId: string; generation: number }>) {
			const projectOperation = captureSoundscaperNativeProjectOperation(options.controller);
			const state = await saveNativePluginRuntimeState(request.instanceId);
			projectOperation.assertCurrent();
			const generation = nextNativePluginGeneration(generations, request.instanceId, request.generation);
			const persisted = await persistThroughMain(request.instanceId, generation, state);
			projectOperation.assertCurrent();
			generations.set(request.instanceId, generation);
			if (persisted.projectState) {
				const projectState = withProjectLatency(
					persisted.projectState, nativePluginReportedLatencyFrames(request.instanceId),
				);
				project?.persist(projectState, projectOperation);
				activeStateKeys.set(request.instanceId, stateKey(projectState, projectOperation.projectId));
			}
			return persisted;
		},
		async restoreNativePluginState(request: Readonly<{
			instanceId: string; generation: number;
			stateBody: Readonly<{ kind: 'native-plugin-state'; bodyId: string; byteLength: number; sha256: string }>;
		}>) {
			const projectOperation = captureSoundscaperNativeProjectOperation(options.controller);
			const generation = nextNativePluginGeneration(generations, request.instanceId, request.generation);
			const restored = await (options.bridge.restoreNativePluginState({
				...request, generation,
			}) as unknown as Promise<{
				projectState: NativePluginProjectStateV1; bytes: Uint8Array;
			}>);
			projectOperation.assertCurrent();
			await loadNativePluginRuntimeState(request.instanceId, restored.bytes);
			projectOperation.assertCurrent();
			generations.set(request.instanceId, generation);
			const projectState = withProjectLatency(
				restored.projectState, nativePluginReportedLatencyFrames(request.instanceId),
			);
			project?.persist(projectState, projectOperation);
			activeStateKeys.set(request.instanceId, stateKey(projectState, projectOperation.projectId));
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
			return closeSoundscaperNativePluginVendorUi(
				request, closeNativePluginRuntimeVendorUi,
				(value) => options.bridge.closeNativePluginVendorUi(value),
			);
		},
		async closeNativePluginInstance(request: Readonly<{ instanceId: string }>) {
			const update = project?.setBypassed(request.instanceId, true);
			setNativePluginBypassed(request.instanceId, true, update?.transition?.contextTime);
			return closeOwnedPluginInstance(request.instanceId);
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
			if (disposal) return disposal;
			closing = true;
			const pending = disposeRenderer();
			disposal = pending;
			void pending.catch(() => { if (disposal === pending) disposal = null; });
			return pending;
		},
	});

	async function closeOwnedAudioSessions(): Promise<void> {
		const closing = [...audioSessionIds];
		const localSettlements = await Promise.allSettled([
			audio.release(),
			Promise.all(closing.map((sessionId) => audioReportTails.get(sessionId))),
		]);
		const remoteSettlements = await Promise.allSettled(closing.map(async (sessionId) => {
			const closed = await options.bridge.closeNativeAudioSession({ sessionId });
			if (closed) audioSessionIds.delete(sessionId);
			return closed;
		}));
		for (const sessionId of closing) audioReportTails.delete(sessionId);
		const failures = localSettlements.flatMap(
			(settlement) => settlement.status === 'rejected' ? [settlement.reason] : [],
		);
		for (let index = 0; index < remoteSettlements.length; index += 1) {
			const settlement = remoteSettlements[index]!;
			if (settlement.status === 'rejected') failures.push(settlement.reason);
			else if (!settlement.value) failures.push(new Error(
				`Native audio session ${closing[index] ?? 'unknown'} did not close.`,
			));
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Native audio session cleanup failed.');
	}

	async function closeOwnedPluginInstance(instanceId: string): Promise<boolean> {
		const closed = await options.bridge.closeNativePluginInstance({ instanceId });
		if (!closed) return false;
		releaseRendererPluginRuntime(instanceId);
		instanceIds.delete(instanceId);
		offlineInstanceIds.delete(instanceId);
		processorIds.delete(instanceId);
		generations.delete(instanceId);
		activeStateKeys.delete(instanceId);
		return true;
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
		await ownershipOperations.settle();
		unregisterStateQuiescence();
		unsubscribe();
		unregisterOffline();
		if (listening) windowValue?.removeEventListener('message', receive);
		listening = false;
		const closingPlugins = new Set([...instanceIds, ...offlineInstanceIds]);
		const failures: unknown[] = [];
		try { await closeOwnedAudioSessions(); }
		catch (error) { failures.push(error); }
		const pluginIds = [...closingPlugins];
		const pluginSettlements = await Promise.allSettled(pluginIds.map(closeOwnedPluginInstance));
		for (let index = 0; index < pluginSettlements.length; index += 1) {
			const settlement = pluginSettlements[index]!;
			if (settlement.status === 'rejected') failures.push(settlement.reason);
			else if (!settlement.value) failures.push(new Error(
				`Native plug-in instance ${pluginIds[index] ?? 'unknown'} did not close.`,
			));
		}
		try { await audio.dispose(); }
		catch (error) { failures.push(error); }
		for (const instanceId of new Set([...processorIds, ...closingPlugins])) {
			releaseRendererPluginRuntime(instanceId);
		}
		processorIds.clear();
		generations.clear();
		activeStateKeys.clear();
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Soundscaper native renderer disposal failed.');
	}

	function assertRuntimeOpen(): void {
		if (closing) throw new Error('The Soundscaper native workspace runtime is closing.');
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
		return ownershipOperations.track(reconciliation);
	}

	async function reconcileProjectNativePlugins(): Promise<readonly unknown[]> {
		const projectOperation = captureSoundscaperNativeProjectOperation(options.controller);
		assertRuntimeOpen();
		listen();
		const states = projectPluginStates(projectOperation.project);
		const desired = new Map(states
			.filter((state) => state.enabled && !state.bypassed && state.continuity === 'live')
			.map((state) => [state.instanceId, stateKey(state, projectOperation.projectId)]));
		for (const [instanceId, activeKey] of activeStateKeys) {
			if (desired.get(instanceId) === activeKey) continue;
			projectOperation.assertCurrent();
			await closeOwnedPluginInstance(instanceId).catch(() => false);
			projectOperation.assertCurrent();
		}
		if (!states.some((state) => state.enabled && !state.bypassed && state.continuity === 'live')) {
			return Object.freeze([]);
		}
		const context = await options.engine.getAudioContext({ resume: false });
		await ensureNativePluginRealtimeWorklet(context);
		projectOperation.assertCurrent();
		const outcomes = [];
		for (const state of states) {
			if (!state.enabled || state.bypassed || state.continuity !== 'live') continue;
			if (instanceIds.has(state.instanceId)
				|| restoringIds.has(state.instanceId)) continue;
			restoringIds.add(state.instanceId);
			let acquiredInstanceId: string | null = null;
			try {
				projectOperation.assertCurrent();
				const instance = await options.bridge.instantiateNativePlugin({
					installationId: installationIdFor(state.binarySha256, state.stablePluginId),
					instanceId: state.instanceId,
					sampleRate: context.sampleRate,
				});
				acquiredInstanceId = instance.instanceId;
				instanceIds.add(instance.instanceId);
				assertRuntimeOpen();
				projectOperation.assertCurrent();
				assertRestoredIdentity(instance, state);
				registerNativePluginRuntimeIdentity(instance.instanceId, instance.format, instance);
				prepareStateNode(context, instance);
				await waitForNativePluginRuntime(instance.instanceId);
				projectOperation.assertCurrent();
				const projected = withTransportLatency(instance);
				const restored = await (options.bridge.restoreNativePluginState({
					instanceId: instance.instanceId, generation: 1, stateBody: state.stateBody,
				}) as unknown as Promise<{ projectState: NativePluginProjectStateV1; bytes: Uint8Array }>);
				projectOperation.assertCurrent();
				await loadNativePluginRuntimeState(instance.instanceId, restored.bytes);
				projectOperation.assertCurrent();
				const persistedState = withProjectLatency(restored.projectState, projected.latencySamples);
				project?.restore(projected, persistedState, projectOperation);
				activeStateKeys.set(instance.instanceId, stateKey(persistedState, projectOperation.projectId));
				generations.set(instance.instanceId, 1);
				outcomes.push(Object.freeze({ instanceId: state.instanceId, status: 'restored' as const }));
			} catch (error) {
				if (acquiredInstanceId !== null) {
					await closeOwnedPluginInstance(acquiredInstanceId).catch(() => false);
					if (!projectOperation.isCurrent()) throw error;
					const transition = projectOperation.commit(
						() => project?.runtime(state.instanceId, 0, 'host-lost'),
					);
					setNativePluginBypassed(state.instanceId, true, transition?.contextTime);
					releaseRendererPluginRuntime(state.instanceId);
					processorIds.delete(state.instanceId);
				}
				if (!projectOperation.isCurrent()) throw error;
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
