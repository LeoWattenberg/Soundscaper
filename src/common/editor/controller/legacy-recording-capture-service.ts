/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	RecordingCaptureCommonRuntime,
	RecordingStartOptions,
	RecordingStartScope,
	RecordingSourceWriter,
} from './recording-transaction-types.ts';
import type { RecordingCaptureControllerLike } from './recording-session-service.ts';
import {
	createSoundActivatedRecordingCaptureSession,
	type SoundActivatedRecordingCaptureSession,
} from './sound-activated-recording-capture-session.ts';
import { compactSoundActivationSegments } from './sound-activated-recording-chunk.ts';
import { recordingCapturePeakDb } from './recording-capture-channels.ts';
import { calculateAudioEditorCountInFrames } from './transport-model.ts';
import { countInSampleFrames } from '../timeline-time.ts';

function errorName(error: unknown): string | undefined {
	return (error as Readonly<{ name?: string }> | null)?.name;
}

/**
 * Perform the browser-facing default-input capture transaction. Promise
 * ownership and start replacement remain the responsibility of
 * recording-session-service.
 */
export function createLegacyRecordingCaptureService(runtime: RecordingCaptureCommonRuntime) {
	const { state } = runtime;

	async function capture(
		options: RecordingStartOptions = {},
		scope: RecordingStartScope,
	): Promise<void> {
		if (state.readOnly || state.recordingStarting || state.recorder) return;
		const project = runtime.getProject();
		const timedStartTimeMs = Number(options.timedStartTimeMs);
		const timedStart = Number.isFinite(timedStartTimeMs);
		const track = options.trackId
			? runtime.findTrack(project, options.trackId)
			: project.tracks.find((item) => item.armed) || null;
		if (!track) throw new Error(runtime.messages.armTrack);
		state.recordingStarting = true;
		state.recordingFatalError = null;
		state.recordingDiscardRequested = false;
		runtime.publishDocumentSnapshot();
		let writer: RecordingSourceWriter | null = null;
		let recorder: RecordingCaptureControllerLike | null = null;
		let soundActivation: SoundActivatedRecordingCaptureSession | null = null;
		const ownsGeneration = () => scope.generation === state.recordingStartGeneration;
		const ownsStart = () => {
			if (!ownsGeneration()) return false;
			try {
				scope.assertCurrent();
				return true;
			} catch {
				return false;
			}
		};
		try {
			scope.assertCurrent();
			const sampleRate = runtime.projectSampleRate(project);
			let stream = runtime.capturePool.getHardware?.(runtime.defaultDeviceId) || null;
			if (options.reusePreparedInputsOnly
				&& (!stream || runtime.streamAudioChannelCount(stream) < 2)) {
				throw new Error(runtime.messages.preparedInputClosed);
			}
			stream = await runtime.capturePool.acquireHardware(runtime.defaultDeviceId, {
				channelCount: 2,
				sampleRate,
			});
			scope.assertCurrent();
			runtime.syncRecordingPoolSnapshot();
			if (!timedStart) {
				await runtime.beginPlaybackCachePreparation(project);
				scope.assertCurrent();
			}
			const context = await runtime.engine.getAudioContext();
			scope.assertCurrent();
			await context.resume();
			scope.assertCurrent();
			await runtime.startMicrophoneMetering();
			scope.assertCurrent();
			const inputTrack = stream.getAudioTracks()[0];
			const trackSettings = inputTrack?.getSettings?.() || {};
			const channelCount = Math.min(2, Number(trackSettings.channelCount) || 1);
			const captureSampleRate = context.sampleRate || sampleRate;
			const selection = runtime.activeSelection(project);
			await runtime.preflightStorage(
				captureSampleRate * channelCount * Float32Array.BYTES_PER_ELEMENT * 60,
				'recording',
			);
			scope.assertCurrent();
			const sourceId = runtime.createStableId('recording');
			writer = await runtime.openSourceWriter(sourceId, {
				name: runtime.createRecordingName(),
				mimeType: 'audio/wav',
				sampleRate: captureSampleRate,
				channelCount,
				chunkFrames: runtime.sourceChunkFrames,
			});
			scope.assertCurrent();
			const openedWriter = writer;
			const previewResampler = runtime.createPreviewResampler(captureSampleRate, sampleRate, channelCount);
			const requestedStartFrame = selection?.startFrame ?? runtime.engine.getPositionFrames();
			const automaticLatency = (context.baseLatency || 0)
				+ (context.outputLatency || 0)
				+ (Number(trackSettings.latency) || 0);
			const latencyFrames = Math.max(0, Math.round(
				(automaticLatency + state.latencyOffsetMs / 1_000) * sampleRate,
			));
			const recordingStartFrame = selection ? requestedStartFrame : Math.max(0, requestedStartFrame - latencyFrames);
			const sourceOffsetProjectFrames = selection ? latencyFrames : Math.max(0, latencyFrames - requestedStartFrame);
			const sourceOffsetFrames = runtime.scaleFrames(sourceOffsetProjectFrames, sampleRate, captureSampleRate);
			// A gated selection would compact PCM and make punch/replace stretch it
			// over the exact deletion range. Keep the exact punch path ungated until
			// capture storage can represent discontinuous absolute source offsets.
			soundActivation = createSoundActivatedRecordingCaptureSession(
				selection ? undefined : runtime.soundActivation,
				{
					sourceKey: `device:${runtime.defaultDeviceId}`,
					kind: 'device',
					sampleRate: captureSampleRate,
					channelCount,
				},
				ownsStart,
				runtime.handleError,
				{ sourceOffsetFrames },
			);
			const persistedSourceOffsetProjectFrames = soundActivation.enabled
				? 0
				: sourceOffsetProjectFrames;
			const persistedSourceOffsetFrames = soundActivation.enabled ? 0 : sourceOffsetFrames;
			const preview = runtime.createPreview({
				trackId: track.id,
				startFrame: recordingStartFrame,
				channelCount,
				framesToSkip: persistedSourceOffsetProjectFrames,
			});
			const createdRecorder = await runtime.createRecorder({
				context,
				stream,
				channelCount,
				discreteChannels: false,
				monitor: state.monitoring,
				inputGain: state.recordingInputGain,
				onChunk: async (chunk) => {
					if (!ownsStart() || state.recorder !== recorder || state.recordingFinishing) return;
					const { channels } = chunk;
					const segments = soundActivation?.process(chunk) || [];
					const admittedChannels = compactSoundActivationSegments(segments);
					state.inputMeterDb = recordingCapturePeakDb(channels);
					if (admittedChannels[0]?.length) {
						await openedWriter.write(admittedChannels);
						scope.assertCurrent();
						if (state.recorder !== recorder || state.recordingFinishing) return;
						runtime.appendPreview(preview, previewResampler.push(admittedChannels));
					}
					runtime.updatePlayhead();
					runtime.publishRecordingPreview();
				},
				onError: (error) => {
					if (!ownsStart()) return;
					state.recordingFatalError = error;
					runtime.handleError(error);
					if (state.recorder && !state.recordingFinishing) {
						void runtime.stopRecording().catch(runtime.handleError);
					}
				},
				onState: (recordingState) => {
					if (recordingState === 'stopped' && ownsStart()
						&& state.recorder && !state.recordingFinishing) {
						soundActivation?.cancel();
						void runtime.finalizeRecording();
					}
				},
			});
			recorder = soundActivation.wrapController(createdRecorder);
			scope.assertCurrent();
			state.recordingStartFrame = recordingStartFrame;
			state.recordingSourceOffsetFrames = persistedSourceOffsetFrames;
			state.recordingPreview = preview;
			state.recordingPreviews = [preview];
			state.recordingWriter = openedWriter;
			state.recordingStream = stream;
			state.recordingSourceId = sourceId;
			state.recordingTrackId = track.id;
			state.recordingSelection = selection ? { ...selection } : null;
			state.recordingResampler = previewResampler;
			state.recordingSampleRate = captureSampleRate;
			state.recorder = recorder;
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
			const selectionProjectFrames = selection
				? selection.endFrame - selection.startFrame + sourceOffsetProjectFrames
				: 0;
			const stopFrame = selection
				? currentContextFrame + Math.ceil(selectionProjectFrames * context.sampleRate / sampleRate)
				: undefined;
			const interrupt = () => {
				if (ownsStart() && state.recorder && !state.recordingFinishing) {
					void runtime.stopRecording().catch(runtime.handleError);
				}
			};
			inputTrack?.addEventListener?.('ended', interrupt, { once: true });
			const contextStateChange = () => {
				if (context.state === 'suspended' && state.recorder) interrupt();
			};
			context.addEventListener?.('statechange', contextStateChange);
			state.recordingCleanup = () => {
				inputTrack?.removeEventListener?.('ended', interrupt);
				context.removeEventListener?.('statechange', contextStateChange);
			};
			runtime.engine.setLoop(false);
			runtime.engine.seek(requestedStartFrame - availableLeadInFrames);
			if (timedStart) {
				recorder.start({ startFrame: currentContextFrame, stopFrame });
				scope.assertCurrent();
			} else {
				await runtime.engine.playAt(scheduledTime, requestedStartFrame - availableLeadInFrames);
				scope.assertCurrent();
				recorder.start({ startFrame: currentContextFrame, stopFrame });
				state.recordingPaused = false;
				runtime.setStatus(runtime.messages.recording);
				runtime.updateTransportState('recording');
			}
		} catch (error) {
			const handedOff = Boolean(!ownsGeneration() && recorder && state.recorder === recorder);
			if (ownsStart()) {
				state.recordingCleanup?.();
				state.recordingCleanup = null;
			}
			if (!handedOff) {
				await Promise.resolve(recorder?.dispose?.({ stopTracks: false })).catch(() => undefined);
				await writer?.abort().catch(() => undefined);
			}
			runtime.releaseUnretainedRecordingInputs();
			if (ownsStart()) {
				runtime.syncRecordingPoolSnapshot();
				state.recorder = null;
				state.recordingWriter = null;
				state.recordingStream = null;
				state.recordingResampler = null;
				state.recordingSampleRate = null;
				state.recordingPreview = null;
				state.recordingPreviews = [];
				state.recordingPreviewLastPublishedAt = 0;
				state.recordingPaused = false;
			}
			if (errorName(error) === 'AbortError') return;
			throw error;
		} finally {
			if (ownsStart()) {
				state.recordingStarting = false;
				runtime.publishDocumentSnapshot();
			}
		}
	}

	return Object.freeze({ capture });
}
