/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RecordingCaptureControllerLike } from './recording-session-service.ts';
import {
	recordingCapturePeak,
	recordingCapturePeakDb,
	selectRoutedRecordingChannels,
} from './recording-capture-channels.ts';
import {
	createSoundActivatedRecordingCaptureSession,
	type SoundActivatedRecordingCaptureSession,
} from './sound-activated-recording-capture-session.ts';
import { compactSoundActivationSegments } from './sound-activated-recording-chunk.ts';
import { calculateAudioEditorCountInFrames } from './transport-model.ts';
import { countInSampleFrames } from '../timeline-time.ts';
import type {
	RecordingMediaStream,
	RecordingRoute,
	RecordingStartOptions,
	RecordingStartScope,
	RecordingTrack,
	RoutedRecordingCaptureRuntime,
	RoutedRecordingEntry,
	RoutedRecordingSourceSession,
	RoutedTrackRoute,
} from './recording-transaction-types.ts';

export interface RoutedRecordingSourcePlan {
	readonly assigned: readonly RoutedTrackRoute[];
	readonly skippedTrackIds: readonly string[];
	readonly groups: readonly Readonly<{
		readonly sourceKey: string;
		readonly routes: readonly RoutedTrackRoute[];
	}>[];
}

function errorName(error: unknown): string | undefined {
	return (error as Readonly<{ name?: string }> | null)?.name;
}

function hasController(
	session: RoutedRecordingSourceSession,
): session is RoutedRecordingSourceSession & { readonly controller: RecordingCaptureControllerLike } {
	return session.controller !== null;
}

/** Create a deterministic, display-first permission plan without touching UI state. */
export function planRoutedRecordingSources(
	tracks: readonly RecordingTrack[],
	routes: Readonly<Record<string, RecordingRoute>>,
	sourceKey: (route: RecordingRoute) => string,
): RoutedRecordingSourcePlan {
	const assigned: RoutedTrackRoute[] = [];
	const skippedTrackIds: string[] = [];
	const groups = new Map<string, RoutedTrackRoute[]>();
	for (const track of tracks) {
		const route = routes[track.id];
		if (!route) {
			skippedTrackIds.push(track.id);
			continue;
		}
		const item = Object.freeze({ track, route, sourceKey: sourceKey(route) });
		assigned.push(item);
		const group = groups.get(item.sourceKey) || [];
		group.push(item);
		groups.set(item.sourceKey, group);
	}
	const ordered = [...groups.entries()]
		.sort(([left], [right]) => (left === 'display' ? -1 : right === 'display' ? 1 : 0))
		.map(([key, groupRoutes]) => Object.freeze({ sourceKey: key, routes: Object.freeze(groupRoutes) }));
	return Object.freeze({
		assigned: Object.freeze(assigned),
		skippedTrackIds: Object.freeze(skippedTrackIds),
		groups: Object.freeze(ordered),
	});
}

/** Perform routed multi-input capture; the session service owns promise guards. */
export function createRoutedRecordingCaptureService(runtime: RoutedRecordingCaptureRuntime) {
	const { state } = runtime;

	async function capture(
		options: RecordingStartOptions = {},
		scope: RecordingStartScope,
	): Promise<void> {
		const project = runtime.getProject();
		const timedStartTimeMs = Number(options.timedStartTimeMs);
		const timedStart = Number.isFinite(timedStartTimeMs);
		const explicitTrack = options.trackId ? runtime.findTrack(project, options.trackId) : null;
		if (options.trackId && explicitTrack?.type !== 'audio') throw new Error(runtime.messages.armTrack);
		const armedTracks = explicitTrack
			? [explicitTrack]
			: project.tracks.filter((track) => track.type === 'audio' && track.armed);
		if (!armedTracks.length) throw new Error(runtime.messages.armTrack);
		const plan = planRoutedRecordingSources(
			armedTracks,
			state.recordingRouting.routes,
			runtime.recordingRouteSourceKey,
		);
		for (const trackId of plan.skippedTrackIds) state.recordingRouteHealth[trackId] = 'skipped';
		if (!plan.assigned.length) throw new Error(runtime.messages.assignInput);

		state.recordingStarting = true;
		state.recordingFatalError = null;
		state.recordingDiscardRequested = false;
		runtime.publishDocumentSnapshot();
		const entries: RoutedRecordingEntry[] = [];
		const sourceSessions: RoutedRecordingSourceSession[] = [];
		const soundActivationSessions = new Map<
			RoutedRecordingSourceSession,
			SoundActivatedRecordingCaptureSession
		>();
		let routedRecorder: ReturnType<RoutedRecordingCaptureRuntime['createRoutedController']> | null = null;
		const ownsGeneration = () => scope.generation === state.recordingStartGeneration;
		const isCurrent = () => {
			if (!ownsGeneration()) return false;
			try {
				scope.assertCurrent();
				return true;
			} catch {
				return false;
			}
		};
		const maybeFinalizeDisconnectedSession = () => {
			if (isCurrent() && state.recorder === routedRecorder
				&& routedRecorder?.state !== 'ready'
				&& sourceSessions.length
				&& sourceSessions.every((source) => source.stopped)
				&& !state.recordingFinishing) {
				void runtime.finalizeRecording();
			}
		};
		const disconnectSession = (session: RoutedRecordingSourceSession) => {
			if (!isCurrent() || session.disconnected) return;
			session.disconnected = true;
			for (const { track } of session.routes) state.recordingRouteHealth[track.id] = 'disconnected';
			runtime.publishDocumentSnapshot();
			if (!session.controller || session.controller.state === 'ready') {
				session.stopped = true;
				maybeFinalizeDisconnectedSession();
				return;
			}
			void Promise.resolve(session.controller.stop()).catch(() => undefined).finally(() => {
				session.stopped = true;
				maybeFinalizeDisconnectedSession();
			});
		};
		const dropFailedSourceSessions = async () => {
			for (const session of [...sourceSessions]) {
				if (!session.disconnected && !session.failed) continue;
				for (const remove of session.listeners) remove();
				await Promise.resolve(session.controller?.dispose?.({ stopTracks: false })).catch(() => undefined);
				for (const entry of session.entries) await entry.writer.abort().catch(() => undefined);
				soundActivationSessions.delete(session);
				for (let index = entries.length - 1; index >= 0; index -= 1) {
					if (session.entries.includes(entries[index])) entries.splice(index, 1);
				}
				sourceSessions.splice(sourceSessions.indexOf(session), 1);
			}
		};

		try {
			scope.assertCurrent();
			const sampleRate = runtime.projectSampleRate(project);
			for (const routed of plan.assigned) state.recordingRouteHealth[routed.track.id] = 'open';
			// Permission requests are launched directly and display capture stays first
			// so transient user activation is retained.
			const acquisitions = plan.groups.map(({ sourceKey, routes }) => {
				const firstRoute = routes[0]?.route;
				if (!firstRoute) throw new Error(runtime.messages.noInputsAvailable);
				const requiredChannels = Math.max(...routes.map(({ route }) => route.channelStart + route.channelCount));
				const retained = firstRoute.kind === 'display'
					? runtime.capturePool.getDisplay?.()
					: runtime.capturePool.getHardware?.(firstRoute.deviceId);
				const reusable = retained
					&& (firstRoute.kind === 'display' || runtime.streamAudioChannelCount(retained) >= requiredChannels);
				let promise: Promise<RecordingMediaStream>;
				if (reusable && retained) promise = Promise.resolve(retained);
				else if (options.reusePreparedInputsOnly) {
					promise = Promise.reject(new Error(runtime.messages.preparedInputClosed));
				} else if (firstRoute.kind === 'display') promise = runtime.capturePool.acquireDisplay();
				else {
					promise = runtime.capturePool.acquireHardware(firstRoute.deviceId, {
						channelCount: requiredChannels,
						sampleRate,
					});
				}
				return { sourceKey, routes, promise };
			});
			const settled = await Promise.allSettled(acquisitions.map(({ promise }) => promise));
			scope.assertCurrent();
			for (let index = 0; index < acquisitions.length; index += 1) {
				const acquisition = acquisitions[index];
				const result = settled[index];
				if (!acquisition || !result) continue;
				if (result.status === 'rejected') {
					for (const { track } of acquisition.routes) state.recordingRouteHealth[track.id] = 'unavailable';
					continue;
				}
				const stream = result.value;
				const inputTrack = stream.getAudioTracks()[0];
				const availableChannels = runtime.streamAudioChannelCount(stream);
				const survivingRoutes = acquisition.routes.filter(({ track, route }) => {
					const valid = route.kind === 'display'
						|| route.channelStart + route.channelCount <= availableChannels;
					if (!valid) state.recordingRouteHealth[track.id] = 'skipped';
					return valid;
				});
				if (!survivingRoutes.length) continue;
				const session: RoutedRecordingSourceSession = {
					sourceKey: acquisition.sourceKey,
					kind: survivingRoutes[0]?.route.kind || 'device',
					stream,
					inputTrack,
					channelCount: availableChannels,
					routes: survivingRoutes,
					entries: [],
					controller: null,
					stopped: false,
					disconnected: false,
					listeners: [],
				};
				sourceSessions.push(session);
				for (const mediaTrack of stream.getTracks?.() || []) {
					const disconnect = () => disconnectSession(session);
					mediaTrack.addEventListener?.('ended', disconnect, { once: true });
					session.listeners.push(() => mediaTrack.removeEventListener?.('ended', disconnect));
				}
				if (!runtime.recordingStreamIsLive(stream, session.kind)) disconnectSession(session);
			}
			await dropFailedSourceSessions();
			scope.assertCurrent();
			runtime.syncRecordingPoolSnapshot();
			if (!sourceSessions.length) {
				runtime.releaseUnretainedRecordingInputs();
				throw new Error(runtime.messages.noInputsAvailable);
			}

			const routedChannelCount = sourceSessions.reduce((total, session) => (
				total + session.routes.reduce((sum, item) => sum + item.route.channelCount, 0)
			), 0);
			if (!timedStart) {
				await runtime.beginPlaybackCachePreparation(project);
				scope.assertCurrent();
			}
			const context = await runtime.engine.getAudioContext();
			scope.assertCurrent();
			await context.resume();
			scope.assertCurrent();
			await dropFailedSourceSessions();
			scope.assertCurrent();
			if (!sourceSessions.length) throw new Error(runtime.messages.noInputsAvailable);
			const captureSampleRate = context.sampleRate || sampleRate;
			const selection = runtime.activeSelection(project);
			await runtime.preflightStorage(
				captureSampleRate * routedChannelCount * Float32Array.BYTES_PER_ELEMENT * 60,
				'recording',
			);
			scope.assertCurrent();
			const requestedStartFrame = selection?.startFrame ?? runtime.engine.getPositionFrames();
			for (const session of sourceSessions) {
				if (session.disconnected) continue;
				const trackSettings = session.inputTrack?.getSettings?.() || {};
				const automaticLatency = (context.baseLatency || 0)
					+ (context.outputLatency || 0)
					+ (Number(trackSettings.latency) || 0);
				const manualLatencyMs = state.recordingRouting.offsets[session.sourceKey] ?? state.latencyOffsetMs;
				const latencyFrames = Math.max(0, Math.round(
					(automaticLatency + manualLatencyMs / 1_000) * sampleRate,
				));
				session.latencyFrames = latencyFrames;
				session.recordingStartFrame = selection
					? requestedStartFrame
					: Math.max(0, requestedStartFrame - latencyFrames);
				session.sourceOffsetProjectFrames = selection
					? latencyFrames
					: Math.max(0, latencyFrames - requestedStartFrame);
				session.sourceOffsetFrames = runtime.scaleFrames(
					session.sourceOffsetProjectFrames,
					sampleRate,
					captureSampleRate,
				);
				// Exact punch owns the whole selected deletion range. Gated source PCM
				// stays disabled here until storage can retain discontinuous offsets.
				const soundActivation = createSoundActivatedRecordingCaptureSession(
					selection ? undefined : runtime.soundActivation,
					{
						sourceKey: session.sourceKey,
						kind: session.kind,
						sampleRate: captureSampleRate,
						channelCount: session.channelCount,
					},
					isCurrent,
					runtime.handleError,
					{ sourceOffsetFrames: session.sourceOffsetFrames },
				);
				soundActivationSessions.set(session, soundActivation);
				const persistedSourceOffsetProjectFrames = soundActivation.enabled
					? 0
					: session.sourceOffsetProjectFrames;
				const persistedSourceOffsetFrames = soundActivation.enabled
					? 0
					: session.sourceOffsetFrames;
				for (const { track, route } of session.routes) {
					const sourceId = runtime.createStableId('recording');
					const writer = await runtime.openSourceWriter(sourceId, {
						name: runtime.createRecordingName(),
						mimeType: 'audio/wav',
						sampleRate: captureSampleRate,
						channelCount: route.channelCount,
						chunkFrames: runtime.sourceChunkFrames,
					});
					scope.assertCurrent();
					const preview = runtime.createPreview({
						trackId: track.id,
						startFrame: session.recordingStartFrame,
						channelCount: route.channelCount,
						framesToSkip: persistedSourceOffsetProjectFrames,
					});
					const entry: RoutedRecordingEntry = Object.freeze({
						trackId: track.id,
						route,
						sourceKey: session.sourceKey,
						sourceId,
						writer,
						previewResampler: runtime.createPreviewResampler(
							captureSampleRate,
							sampleRate,
							route.channelCount,
						),
						preview,
						sampleRate: captureSampleRate,
						selection: selection ? Object.freeze({ ...selection }) : null,
						recordingStartFrame: session.recordingStartFrame,
						sourceOffsetFrames: persistedSourceOffsetFrames,
						sourceOffsetProjectFrames: persistedSourceOffsetProjectFrames,
					});
					entries.push(entry);
					session.entries.push(entry);
				}
			}
			await dropFailedSourceSessions();
			scope.assertCurrent();
			if (!sourceSessions.length) throw new Error(runtime.messages.noInputsAvailable);
			const selectedMeterEntry = entries.find((entry) => entry.trackId === state.selectedTrackId)
				|| entries[0]
				|| null;
			if (selectedMeterEntry) {
				const meterKey = [
					selectedMeterEntry.sourceKey,
					selectedMeterEntry.route.channelStart,
					selectedMeterEntry.route.channelCount,
					captureSampleRate,
				].join(':');
				const existing = runtime.getLoudnessMeter();
				if (!existing.meter || existing.key !== meterKey) {
					const meter = runtime.createLoudnessMeter({
						sampleRate: captureSampleRate,
						channelCount: selectedMeterEntry.route.channelCount,
					});
					runtime.setLoudnessMeter(meter, meterKey);
					state.inputMeter = meter.snapshot();
				}
			}

			const handleFatalRecordingError = (error: unknown) => {
				if (!isCurrent()) return;
				state.recordingFatalError = error;
				runtime.handleError(error);
				if (state.recorder && !state.recordingFinishing) {
					void runtime.stopRecording().catch(runtime.handleError);
				}
			};
			for (const session of sourceSessions) {
				try {
					const soundActivation = soundActivationSessions.get(session);
					if (!soundActivation) throw new Error('The routed sound activation session is unavailable.');
					const createdController = await runtime.createRecorder({
						context,
						stream: session.stream,
						channelCount: session.channelCount,
						monitor: session.kind === 'device' && state.monitoring,
						inputGain: session.kind === 'device' ? state.recordingInputGain : 1,
						onChunk: async (chunk) => {
							if (!isCurrent() || state.recorder !== routedRecorder || state.recordingFinishing) return;
							const { channels } = chunk;
							const segments = soundActivation.process(chunk);
							const admittedChannels = compactSoundActivationSegments(segments);
							let sourcePeak = 0;
							for (const entry of session.entries) {
								const routedChannels = selectRoutedRecordingChannels(
									channels,
									entry.route,
									session.kind,
								);
								const meter = runtime.getLoudnessMeter().meter;
								if (entry === selectedMeterEntry && routedChannels[0]?.length) {
									meter?.push(routedChannels, (reading) => {
										if (!isCurrent()) return;
										state.inputMeter = reading;
										state.inputMeterDb = Math.max(-60, Number(reading.dbfs) || -60);
									});
								}
								const peak = recordingCapturePeak(routedChannels);
								sourcePeak = Math.max(sourcePeak, peak);
								state.inputMeters[entry.trackId] = recordingCapturePeakDb(routedChannels);
							}
							const writes = await Promise.allSettled(session.entries.map(async (entry) => {
								if (admittedChannels[0]?.length) {
									const routedChannels = selectRoutedRecordingChannels(
										admittedChannels,
										entry.route,
										session.kind,
									);
									await entry.writer.write(routedChannels);
									scope.assertCurrent();
									runtime.appendPreview(entry.preview, entry.previewResampler.push(routedChannels));
								}
							}));
							const failedWrite = writes.find((result) => result.status === 'rejected');
							if (failedWrite?.status === 'rejected') throw failedWrite.reason;
							scope.assertCurrent();
							if (state.recorder !== routedRecorder || state.recordingFinishing) return;
							state.inputMeterDb = sourcePeak > 0 ? Math.max(-60, 20 * Math.log10(sourcePeak)) : -60;
							runtime.updatePlayhead();
							runtime.publishRecordingPreview();
						},
						onError: handleFatalRecordingError,
						onState: (recordingState) => {
							if (recordingState !== 'stopped' || !isCurrent()) return;
							soundActivation.cancel();
							session.stopped = true;
							if (state.recorder === routedRecorder
								&& sourceSessions.every((source) => source.stopped)
								&& !state.recordingFinishing) void runtime.finalizeRecording();
						},
					});
					session.controller = soundActivation.wrapController(createdController);
					scope.assertCurrent();
					if (!runtime.recordingStreamIsLive(session.stream, session.kind)) disconnectSession(session);
				} catch (error) {
					if (errorName(error) === 'AbortError') throw error;
					session.failed = true;
					const health = runtime.recordingStreamIsLive(session.stream, session.kind)
						? 'unavailable'
						: 'disconnected';
					for (const { track } of session.routes) state.recordingRouteHealth[track.id] = health;
				}
			}
			await dropFailedSourceSessions();
			scope.assertCurrent();
			const readySessions = sourceSessions.filter(hasController);
			if (!readySessions.length) throw new Error(runtime.messages.noInputsAvailable);

			routedRecorder = runtime.createRoutedController(readySessions);
			state.recordingEntries = Object.freeze([...entries]);
			state.recordingPreviews = entries.map((entry) => entry.preview);
			state.recordingPreview = state.recordingPreviews[0] || null;
			state.recordingSelection = selection ? { ...selection } : null;
			state.recorder = routedRecorder;
			const remainingSeconds = timedStart ? (timedStartTimeMs - runtime.currentTimeMs()) / 1_000 : null;
			if (timedStart && remainingSeconds !== null && remainingSeconds <= 0) {
				throw new RangeError(runtime.messages.timedRecordingPast);
			}
			const scheduledTime = timedStart
				? context.currentTime + (remainingSeconds || 0)
				: context.currentTime + 0.08;
			const leadInFrames = !timedStart && state.leadInRecording
				? project.tempoMap != null || project.signatureMap != null
					? calculateAudioEditorCountInFrames({
						tempoMap: project.tempoMap,
						signatureMap: project.signatureMap,
						sampleRate,
						positionFrame: requestedStartFrame,
					})
					: countInSampleFrames(1, {
						bpm: Math.max(1, Number(project.tempo?.bpm) || 120),
						timeSignature: {
							numerator: Math.max(1, Number(project.tempo?.timeSignature?.numerator) || 4),
							denominator: Math.max(1, Number(project.tempo?.timeSignature?.denominator) || 4),
						},
					}, sampleRate)
				: 0;
			const availableLeadInFrames = Math.min(leadInFrames, requestedStartFrame);
			const currentContextFrame = Math.ceil(
				(scheduledTime + availableLeadInFrames / sampleRate) * context.sampleRate,
			);
			for (const session of sourceSessions) {
				const selectionProjectFrames = selection
					? selection.endFrame - selection.startFrame + (session.sourceOffsetProjectFrames || 0)
					: 0;
				session.startFrame = currentContextFrame;
				session.stopFrame = selection
					? currentContextFrame + Math.ceil(selectionProjectFrames * context.sampleRate / sampleRate)
					: undefined;
				for (const entry of session.entries) {
					state.recordingRouteHealth[entry.trackId] = timedStart ? 'open' : 'recording';
				}
			}
			const contextStateChange = () => {
				if (context.state === 'suspended' && isCurrent() && state.recorder) {
					void runtime.stopRecording().catch(runtime.handleError);
				}
			};
			context.addEventListener?.('statechange', contextStateChange);
			state.recordingCleanup = () => {
				for (const session of sourceSessions) for (const remove of session.listeners) remove();
				context.removeEventListener?.('statechange', contextStateChange);
			};
			runtime.engine.setLoop(false);
			runtime.engine.seek(requestedStartFrame - availableLeadInFrames);
			if (timedStart) {
				routedRecorder.start();
				scope.assertCurrent();
			} else {
				await runtime.engine.playAt(scheduledTime, requestedStartFrame - availableLeadInFrames);
				scope.assertCurrent();
				await dropFailedSourceSessions();
				scope.assertCurrent();
				if (!sourceSessions.length) throw new Error(runtime.messages.noInputsAvailable);
				state.recordingEntries = Object.freeze([...entries]);
				state.recordingPreviews = entries.map((entry) => entry.preview);
				state.recordingPreview = state.recordingPreviews[0] || null;
				routedRecorder.start();
				state.recordingPaused = false;
				runtime.setStatus(runtime.messages.recording);
				runtime.updateTransportState('recording');
			}
		} catch (error) {
			const handedOff = Boolean(!ownsGeneration() && routedRecorder && state.recorder === routedRecorder);
			if (isCurrent()) {
				runtime.engine.pause();
				state.recordingCleanup?.();
				state.recordingCleanup = null;
			}
			if (!handedOff) {
				for (const session of sourceSessions) for (const remove of session.listeners) remove();
				await Promise.resolve(routedRecorder?.dispose()).catch(() => undefined);
				for (const session of sourceSessions) {
					await Promise.resolve(session.controller?.dispose?.({ stopTracks: false })).catch(() => undefined);
				}
				for (const entry of entries) await entry.writer.abort().catch(() => undefined);
			}
			if (isCurrent()) {
				state.recorder = null;
				state.recordingEntries = null;
				state.recordingPreviews = [];
				state.recordingPreview = null;
				state.recordingSelection = null;
				state.recordingPaused = false;
				state.inputMeters = {};
				state.inputMeterDb = -60;
				state.recordingFatalError = null;
				runtime.releaseUnretainedRecordingInputs();
				runtime.syncRecordingPoolSnapshot();
			} else runtime.releaseUnretainedRecordingInputs();
			if (errorName(error) === 'AbortError') return;
			throw error;
		} finally {
			if (isCurrent()) {
				state.recordingStarting = false;
				runtime.publishDocumentSnapshot();
			}
		}
	}

	return Object.freeze({ capture });
}
