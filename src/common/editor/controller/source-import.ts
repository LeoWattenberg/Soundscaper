/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	VideoPreviewEncodedPayloadTooLargeError,
	VideoPreviewSourceGeometryTooLargeError,
} from '../video-preview-capture-admission.ts';
import { linkedVideoLocatorReferenceFromImportOptions } from './project-import-options.ts';
import { sampleFrameToVideoFrame } from '../timeline-time.ts';
import { digestMediaContent } from '../storage/media-content-digest.ts';
import type {
	OwnedMediaAssetPublication,
	OwnedMediaAssetWriter,
} from '../storage/media-asset-write-contract.ts';
import { createFfmpegVideoTimingProbe, probeVideoTiming } from '../video-timing-probe.ts';
import { createContainerVideoTimingProbe } from '../video-timing-demux.ts';
import {
	createUnreportedVideoSourceCharacteristics,
	normalizeVideoSourceCharacteristics,
} from '../video-source-characteristics.ts';
import { publishVideoTimingAsset } from '../video-timing-storage.ts';
import { planVideoImportTiming } from './video-import-timing.ts';
import { createImportedAudioContentIdentityWriter, rollbackImportedAudioContentIdentityWriter,
	type ImportedAudioContentIdentity } from './imported-audio-content-identity.ts';
import { decodeImportedVideoAudio } from './video-import-audio-decode.ts';
export interface ImportVideoRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = ImportVideoRuntime[string];
export type ImportVideoFile = (file: RuntimeValue, options?: RuntimeValue) => Promise<RuntimeValue>;

export function createImportVideoFile(runtime: ImportVideoRuntime): ImportVideoFile {
	const {
		SOURCE_CHUNK_FRAMES, activateVideoSource, audioBufferChannels, audioEditorVideoThumbnailTimes,
		assertProject, bufferFromChannels, cacheSourceBuffer, canonicalizeBuffer, commit,
		copy, createAddClipCommand, createAddSourceCommand, createAddTrackCommand,
		captureProject, createAudioEditorVideoFrameExtractor, createStableId, engine, ffmpeg,
		findTrack, fitAudioBufferToFrames, generateWaveformPeaks, helperTimingProbe,
		inspectEncodedAudioSampleRate,
		normalizeImportOptions, peakCacheKey, preflightStorage, getProject,
		projectSampleRate, revokeVideoVisual, sourceBuffers, sourcePeaks,
		store, stripExtension, warnEnvelope, writeBuffer,
	} = runtime;
	async function importVideoFile(file: RuntimeValue, importOptions: RuntimeValue = normalizeImportOptions()) {
		const linkedVideoLocator = linkedVideoLocatorReferenceFromImportOptions(importOptions);
		const { locatorId: linkedVideoLocatorId = null, locatorRevision: linkedVideoLocatorRevision = null } = linkedVideoLocator ?? {};
		const releaseUnusedLinkedVideoLocator = async () => {
			if (linkedVideoLocator) {
				const released = await store.releaseLinkedVideoOriginalLocator(linkedVideoLocator);
				if (released === false) throw new Error('The unused linked-video locator was not released.');
			}
		};
		let extractor: RuntimeValue = null;
		let prepared: RuntimeValue;
		try {
			const startingProject = getProject();
			const startingProjectToken = captureProject();
			const startingProjectId = startingProject.id;
			const startingVideoTrackCount = startingProject.tracks
				.filter((track: RuntimeValue) => track.type === 'video').length;
			await preflightStorage(Math.max(file.size * 2, 16 * 1024 * 1024), 'import');
			let canonicalVideoFile = file;
			extractor = await createAudioEditorVideoFrameExtractor(canonicalVideoFile);
			const sampleRate = projectSampleRate();
			const ffmpegTimingProbe = createFfmpegVideoTimingProbe(ffmpeg);
			// The native helper probes by opaque capability id and its failure
			// is recorded before the wasm probe takes over. The container demuxer
			// answers last, from the file's own integers, so a build that carries no
			// decoder at all still reaches exact timing instead of conforming.
			const preferredProbes = [helperTimingProbe, ffmpegTimingProbe, createContainerVideoTimingProbe()]
				.filter((probe: RuntimeValue) => Boolean(probe));
			let timingProbe = canonicalVideoFile instanceof Blob
				? await probeVideoTiming(canonicalVideoFile, {
					probes: preferredProbes,
					signal: importOptions.signal,
				})
				: Object.freeze({
					decision: 'conform-cfr-at-ingest' as const,
					rate: Object.freeze({ num: 30, den: 1 }),
					reason: 'timing-probe-unavailable' as const,
					failures: Object.freeze([]),
					characteristics: createUnreportedVideoSourceCharacteristics(),
				});
			let conformedAtIngest = false;
			if (timingProbe.decision === 'conform-cfr-at-ingest'
				&& canonicalVideoFile instanceof Blob) {
				if (typeof ffmpeg?.conformVideoToCfr !== 'function') {
					throw new Error('Exact video timing could not be established and CFR conformance is unavailable.');
				}
				if (linkedVideoLocatorId) {
					throw new Error('A linked original cannot be replaced by a conformed ingest derivative.');
				}
				canonicalVideoFile = await ffmpeg.conformVideoToCfr(canonicalVideoFile, {
					rate: timingProbe.rate,
					signal: importOptions.signal,
				});
				extractor.dispose();
				extractor = await createAudioEditorVideoFrameExtractor(canonicalVideoFile);
				const conformedProbe = createFfmpegVideoTimingProbe(ffmpeg);
				timingProbe = await probeVideoTiming(canonicalVideoFile, {
					probes: [conformedProbe, createContainerVideoTimingProbe()]
						.filter((probe): probe is NonNullable<typeof probe> => Boolean(probe)),
					fallbackRate: timingProbe.rate,
					signal: importOptions.signal,
				});
				if (timingProbe.decision !== 'timing-asset') {
					throw new Error('The conformed video output did not expose exact frame timing.');
				}
				conformedAtIngest = true;
			}
			const trackName = stripExtension(file.name) || `Video ${startingVideoTrackCount + 1}`;
			prepared = {
				startingProjectId, startingProjectToken,
				sampleRate, timingProbe, canonicalVideoFile, conformedAtIngest,
				metadataDurationFrames: Math.max(1, Math.round(extractor.metadata.durationSeconds * sampleRate)),
				videoSourceId: createStableId('video-source'),
				videoClipId: createStableId('video-clip'),
				binItemId: createStableId('bin-item'),
				trackName,
				sourceName: file.name || `${trackName}.mp4`,
			};
		} catch (error) {
			const cleanupErrors: unknown[] = [];
			try { await releaseUnusedLinkedVideoLocator(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
			try { extractor?.dispose(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
			if (cleanupErrors.length) {
				throw new AggregateError([error, ...cleanupErrors], 'Video import preparation and cleanup failed.', {
					cause: error,
				});
			}
			throw error;
		}
		const {
			startingProjectId, startingProjectToken, sampleRate, metadataDurationFrames, videoSourceId, videoClipId,
			binItemId, trackName, sourceName, timingProbe, canonicalVideoFile, conformedAtIngest,
		} = prepared;
		const assertImportProjectCurrent = () => {
			try { assertProject(startingProjectToken); } catch (error) {
				throw new Error('The project changed during video import.', { cause: error });
			}
			if (getProject()?.id !== startingProjectId) {
				throw new Error('The project changed during video import.');
			}
		};
		let audioSourceId: string | null = null;
		let audioClipId = null;
		let canonicalAudio = null;
		let audioDecodeNotice: string | null = null;
		let audioContentIdentity: ImportedAudioContentIdentity | null = null;
		let originalAudioSampleRate = sampleRate;
		let mediaPublication: OwnedMediaAssetPublication | null = null;
		let timingAssetPublication: OwnedMediaAssetPublication | null = null;
		let audioPersisted = false;
		let linkedBinding: RuntimeValue = null;
		let linkedProjectId: RuntimeValue = null;
		const pendingLinkedDerivatives: RuntimeValue[] = [];
		const savePreviewDerivative = async (derivative: RuntimeValue) => {
			if (linkedVideoLocatorId) pendingLinkedDerivatives.push(derivative);
			else {
				await store.saveVideoDerivative(videoSourceId, derivative);
			}
		};
		try {
			assertImportProjectCurrent();
			const activeProject = getProject();
			const sequenceId = activeProject.primarySequenceId || 'main-sequence';
			const sequence = activeProject.sequences?.find((candidate: RuntimeValue) => candidate.id === sequenceId)
				|| { id: sequenceId, rate: { num: 30, den: 1 } };
			const {
				sourceDurationFrames: durationFrames,
				sequenceStartFrame, sequenceEndFrame, timelineStartFrame, timelineDurationFrames,
			} = planVideoImportTiming({
				metadataDurationFrames, sampleRate,
				timingIndex: timingProbe.decision === 'timing-asset' ? timingProbe.timing : null,
				timelineStartFrame: importOptions.timelineStartFrame,
				sequenceRate: sequence.rate,
			});
			let sourceContentSha256: string;
			if (!linkedVideoLocatorId) {
				const published = await publishImportedVideo(
					store,
					videoSourceId,
					canonicalVideoFile,
					{
					name: sourceName,
					mimeType: canonicalVideoFile.type || 'video/mp4',
					width: extractor.metadata.width,
					height: extractor.metadata.height,
					durationSeconds: extractor.metadata.durationSeconds,
					},
					importOptions.signal,
				);
				sourceContentSha256 = published.sha256;
				mediaPublication = published.publication;
			} else sourceContentSha256 = await digestImportFile(canonicalVideoFile);
			let timingAsset = null;
			if (timingProbe.decision === 'timing-asset') {
				const published = await publishVideoTimingAsset(store, sourceContentSha256, timingProbe.timing);
				timingAsset = published.reference;
				timingAssetPublication = published.publication;
			}
			const thumbnailTimes = audioEditorVideoThumbnailTimes(extractor.metadata.durationSeconds);
			let sourcePreviewUnavailable = false;
			const reportsAlpha = timingProbe.characteristics.hasAlpha === true;
			try {
				const poster = await extractor.capture(0, {
					maximumWidth: 640,
					maximumHeight: 360,
					alpha: reportsAlpha,
				});
				await savePreviewDerivative({
					timestamp: 0,
					type: 'poster',
					blob: poster.blob,
					metadata: {
						width: poster.width,
						height: poster.height,
						mimeType: poster.mimeType,
					},
				});
			} catch (error) {
				// A preview derivative is disposable; the original media remains importable.
				sourcePreviewUnavailable = error instanceof VideoPreviewSourceGeometryTooLargeError;
			}
			for (const timestamp of sourcePreviewUnavailable ? [] : thumbnailTimes) {
				try {
					const thumbnail = await extractor.capture(timestamp, { alpha: reportsAlpha });
					await savePreviewDerivative({
						timestamp: thumbnail.timestampSeconds,
						type: 'thumbnail',
						blob: thumbnail.blob,
						metadata: {
							width: thumbnail.width,
							height: thumbnail.height,
							mimeType: thumbnail.mimeType,
						},
					});
				} catch (error) {
					// Keep the rest of the filmstrip when one seek/capture fails.
					if (error instanceof VideoPreviewEncodedPayloadTooLargeError) break;
				}
			}

			const context = await engine.getAudioContext({ resume: false });
			try {
				const { decodedAudio, declaredAudioSampleRate } = await decodeImportedVideoAudio({
					file: canonicalVideoFile,
					projectSampleRate: sampleRate,
					durationSeconds: timelineDurationFrames / sampleRate,
					signal: importOptions.signal,
					inspectEncodedSampleRate: inspectEncodedAudioSampleRate,
					decodeNative: (encoded) => engine.decodeAudioData(encoded),
					decodeContainerAudio: runtime.decodeContainerAudio,
					decodeFfmpeg: (video, options) => ffmpeg.decode(video, options),
				});
				const decodedChannels = decodedAudio?.channels?.length
					? decodedAudio.channels
					: decodedAudio?.numberOfChannels
						? audioBufferChannels(decodedAudio)
						: null;
				if (decodedChannels?.length) {
					originalAudioSampleRate = declaredAudioSampleRate || decodedAudio.sampleRate || sampleRate;
					const decodedBuffer = await bufferFromChannels(
						decodedChannels,
						decodedAudio.sampleRate,
						context,
						copy,
					);
					const resampled = await canonicalizeBuffer(decodedBuffer, context, sampleRate, copy);
					canonicalAudio = fitAudioBufferToFrames(resampled, timelineDurationFrames, context);
				}
			} catch {
				throwIfImportAborted(importOptions.signal);
				canonicalAudio = null;
				const template = typeof copy?.videoAudioDecodeFailed === 'string'
					? copy.videoAudioDecodeFailed
					: 'The audio from {file} could not be decoded. The video was imported without audio.';
				audioDecodeNotice = template.replace('{file}', () => sourceName);
			}

			if (canonicalAudio) {
				await preflightStorage(
					canonicalAudio.length * canonicalAudio.numberOfChannels * Float32Array.BYTES_PER_ELEMENT,
					'import',
				);
				audioSourceId = createStableId('source');
				audioClipId = createStableId('clip');
				const writer = createImportedAudioContentIdentityWriter(await store.beginSourceWrite(audioSourceId, {
					name: `${trackName} Audio`,
					mimeType: 'audio/x-soundscaper-extracted',
					sampleRate: canonicalAudio.sampleRate,
					channelCount: canonicalAudio.numberOfChannels,
					chunkFrames: SOURCE_CHUNK_FRAMES,
				}), SOURCE_CHUNK_FRAMES);
				try {
					await writeBuffer(writer, canonicalAudio);
					await writer.commit({
						sampleRate: canonicalAudio.sampleRate,
						channelCount: canonicalAudio.numberOfChannels,
					});
					audioContentIdentity = writer.contentIdentity(canonicalAudio.length);
					audioPersisted = true;
				} catch (error) {
					await rollbackImportedAudioContentIdentityWriter(
						writer, () => store.deleteSource(String(audioSourceId)), error,
					);
				}
				cacheSourceBuffer(audioSourceId, canonicalAudio);
				const peaks = await generateWaveformPeaks(audioBufferChannels(canonicalAudio), copy);
				sourcePeaks.set(audioSourceId, peaks);
				await store.saveAnalysis(peakCacheKey(audioSourceId), peaks);
			}

			const sourceRate = timingProbe.decision === 'timing-asset' ? timingProbe.nominalRate : timingProbe.rate;
			const sourceFrameCount = timingProbe.decision === 'timing-asset'
				? timingProbe.timing.frameCount
				: Math.max(1, sampleFrameToVideoFrame(durationFrames, sourceRate, sampleRate, 'enclosingEnd'));
			// Ingest decodes one audio program. Naming it is only honest when the
			// inventory reports exactly one, so a multi-stream master records the
			// streams it did not import instead of guessing which one it did.
			const reportedStreams = timingProbe.characteristics.audioStreams;
			const extractedStream = canonicalAudio && reportedStreams?.length === 1 ? reportedStreams[0] : null;
			const characteristics = normalizeVideoSourceCharacteristics({
				...timingProbe.characteristics,
				extractedAudioStreamIndex: extractedStream ? extractedStream.index : null,
			}, { rate: sourceRate });
			const videoSource = {
				kind: 'video',
				id: videoSourceId,
				storageKey: videoSourceId,
				name: sourceName,
				mimeType: canonicalVideoFile.type || 'video/mp4',
				sampleFrameCount: durationFrames,
				sampleRate,
				width: extractor.metadata.width,
				height: extractor.metadata.height,
				frameRate: sourceRate,
				sourceFrameCount,
				contentSha256: sourceContentSha256,
				timingAsset,
				timingDecision: timingProbe.decision === 'timing-asset'
					? {
						mode: conformedAtIngest ? 'conform-cfr-at-ingest' : 'exact',
						rate: sourceRate,
						backend: timingProbe.backend,
					}
					: { mode: 'conform-cfr-at-ingest', rate: sourceRate, reason: timingProbe.reason, failures: timingProbe.failures },
				characteristics,
				videoCodec: characteristics.videoCodec ?? (conformedAtIngest ? 'h264' : 'unknown'),
				audioCodec: canonicalAudio
					? extractedStream?.codec ?? (conformedAtIngest ? 'aac' : 'unknown')
					: null,
				hasAudio: Boolean(canonicalAudio),
				posterStorageKey: null,
				thumbnailStorageKey: null,
				opaqueExtensions: {},
			};
			if (canonicalAudio && !audioContentIdentity) throw new Error(
				'Extracted audio content identity is unavailable after persistence.');
			const audioSource = canonicalAudio && audioContentIdentity ? {
				kind: 'audio',
				sampleFormat: 'float32',
				chunkFrames: SOURCE_CHUNK_FRAMES,
				id: audioSourceId,
				storageKey: audioSourceId,
				name: `${trackName} Audio`,
				mimeType: 'audio/x-soundscaper-extracted',
				frameCount: canonicalAudio.length,
				channelCount: canonicalAudio.numberOfChannels,
				sampleRate: canonicalAudio.sampleRate,
				originalSampleRate: originalAudioSampleRate,
				contentSha256: audioContentIdentity.contentSha256,
				byteLength: audioContentIdentity.byteLength,
				opaqueExtensions: { originVideoSourceId: videoSourceId },
			} : null;
			const videoClip = {
				kind: 'video',
				id: videoClipId,
				sourceId: videoSourceId,
				title: trackName,
				sequenceId,
				sequenceStartFrame,
				sequenceFrameCount: sequenceEndFrame - sequenceStartFrame,
				sourceInFrame: 0,
				sourceFrameCount,
				trimStartFrames: 0,
				trimEndFrames: 0,
				groupId: null,
				color: 'auto',
				speedRatio: 1,
				avLinkId: null,
				binItemId: importOptions.destination === 'project-bin' ? binItemId : null,
				opaqueExtensions: {},
			};
			const audioClip = audioSource ? {
				kind: 'audio',
				id: audioClipId,
				sourceId: audioSourceId,
				title: `${trackName} Audio`,
				timelineStartFrame,
				sourceStartFrame: 0,
				sourceDurationFrames: timelineDurationFrames,
				durationFrames: timelineDurationFrames,
				trimStartFrames: 0,
				trimEndFrames: 0,
				groupId: null,
				avLinkId: null,
				binItemId: importOptions.destination === 'project-bin' ? binItemId : null,
			} : null;
			const commands = [createAddSourceCommand(videoSource)];
			if (audioSource) commands.push(createAddSourceCommand(audioSource));
			let selectedTrackId = null;
			if (importOptions.destination === 'project-bin') {
				commands.push({ type: 'project-bin/add', clip: videoClip });
				if (audioClip) commands.push({ type: 'project-bin/add', clip: audioClip });
			} else {
				const target = importOptions.trackId ? findTrack(getProject(), importOptions.trackId) : null;
				const laneGroupId = target?.laneGroupId || createStableId('media-lane');
				let videoTrack = target?.type === 'video' ? target : null;
				let audioTrack = target?.type === 'audio' ? target : null;
				if (target?.laneGroupId) {
					videoTrack ||= getProject().tracks.find((track: RuntimeValue) => (
						track.type === 'video' && track.laneGroupId === target.laneGroupId
					)) || null;
					audioTrack ||= getProject().tracks.find((track: RuntimeValue) => (
						track.type === 'audio' && track.laneGroupId === target.laneGroupId
					)) || null;
				}
				if (!videoTrack || !audioTrack) {
					const videoTrackId = createStableId('video-track');
					const audioTrackId = createStableId('track');
					const index = Number.isSafeInteger(importOptions.trackIndex)
						? importOptions.trackIndex
						: getProject().tracks.length;
					commands.push({
						...createAddTrackCommand({
							type: 'video',
							id: videoTrackId,
							name: trackName,
							laneGroupId,
						}),
						index,
					}, {
						...createAddTrackCommand({
							type: 'audio',
							id: audioTrackId,
							name: `${trackName} Audio`,
							laneGroupId,
							armed: false,
						}),
						index: index + 1,
					});
					videoTrack = { id: videoTrackId };
					audioTrack = { id: audioTrackId };
				}
				selectedTrackId = videoTrack.id;
				const avLinkId = audioClip ? createStableId('av-link') : null;
				commands.push(createAddClipCommand(videoTrack.id, { ...videoClip, avLinkId }));
				if (audioClip) commands.push(createAddClipCommand(audioTrack.id, { ...audioClip, avLinkId }));
			}
			assertImportProjectCurrent();
			if (linkedVideoLocatorId) {
				linkedProjectId = startingProjectId;
				linkedBinding = await store.bindLinkedVideoOriginal(
					linkedProjectId,
					videoSource,
					linkedVideoLocatorId,
					{ expectedLocatorRevision: linkedVideoLocatorRevision, expectedSnapshot: file },
				);
				for (const derivative of pendingLinkedDerivatives) {
					try {
						await store.saveLinkedVideoDerivative(
							linkedProjectId, videoSource, linkedBinding, derivative,
						);
					} catch { /* A reproducible preview derivative is disposable. */ }
				}
			}
			await activateVideoSource(videoSource);
			assertImportProjectCurrent();
			commit({ type: 'batch', commands }, {
				selectTrackId: selectedTrackId,
				selectClipId: videoClipId,
			});
			try { warnEnvelope(); } catch { /* The canonical import is already committed. */ }
			return Object.freeze({
				destination: importOptions.destination,
				sourceId: videoSourceId,
				audioSourceId,
				clipId: videoClipId,
				audioClipId,
				trackId: selectedTrackId,
				...(audioDecodeNotice ? { notice: audioDecodeNotice } : {}),
			});
		} catch (error) {
			const currentProject = getProject();
			const canonicalSourceLanded = currentProject?.id === startingProjectId
				&& currentProject.sources?.some((source: RuntimeValue) => source.id === videoSourceId);
			if (canonicalSourceLanded) throw error;
			const cleanupErrors: unknown[] = [];
			try { await revokeVideoVisual(videoSourceId); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
			let releaseLinkedLocator = !linkedBinding;
			if (linkedBinding) {
				try {
					releaseLinkedLocator = await store.unlinkLinkedVideoOriginal(
						linkedProjectId, videoSourceId, linkedBinding.bindingToken,
					);
				} catch (cleanupError) {
					releaseLinkedLocator = false;
					cleanupErrors.push(cleanupError);
				}
			}
			if (audioSourceId) {
				sourceBuffers.delete(audioSourceId);
				sourcePeaks.delete(audioSourceId);
				if (audioPersisted) {
					try { await store.deleteSource(audioSourceId); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
				}
			}
			if (timingAssetPublication) {
				try { await timingAssetPublication.discardIfCurrent(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
			}
			if (mediaPublication) {
				try { await mediaPublication.discardIfCurrent(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
			}
			if (releaseLinkedLocator) {
				try { await releaseUnusedLinkedVideoLocator(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
			}
			if (cleanupErrors.length) {
				throw new AggregateError([error, ...cleanupErrors], 'Video import and rollback both failed.', {
					cause: error,
				});
			}
			throw error;
		} finally {
			try { extractor.dispose(); } catch { /* Disposable import helper. */ }
		}
	}
	return importVideoFile;
}

async function digestImportFile(file: RuntimeValue): Promise<string> {
	if (file instanceof Blob) return digestMediaContent(file);
	if (typeof file?.arrayBuffer !== 'function') throw new TypeError('Video media must provide bytes for digest binding.');
	return digestMediaContent(new Blob([await file.arrayBuffer()]));
}

async function publishImportedVideo(
	store: RuntimeValue,
	storageKey: string,
	file: RuntimeValue,
	metadata: Readonly<Record<string, unknown>>,
	signal?: AbortSignal,
): Promise<Readonly<{ sha256: string; publication: OwnedMediaAssetPublication }>> {
	const body = file instanceof Blob
		? file
		: new Blob([await file.arrayBuffer()], { type: typeof file?.type === 'string' ? file.type : '' });
	if (!body.size) throw new RangeError('Video media must contain at least one byte.');
	const sha256 = await digestMediaContent(body);
	const writer = await store.beginMediaAssetWrite(storageKey, metadata, {
		expectedBytes: body.size,
		expectedSha256: sha256,
		signal,
	}) as OwnedMediaAssetWriter;
	let publication: OwnedMediaAssetPublication | null = null;
	try {
		const maximumChunkBytes = positiveWriterChunkBytes(writer.maximumChunkBytes);
		for (let offset = 0; offset < body.size; offset += maximumChunkBytes) {
			throwIfImportAborted(signal);
			const end = Math.min(offset + maximumChunkBytes, body.size);
			const bytes = new Uint8Array(await body.slice(offset, end).arrayBuffer());
			if (bytes.byteLength !== end - offset) throw new Error('Video media returned an incomplete byte range.');
			await writer.write(bytes, { signal });
		}
		if (writer.bytesWritten !== body.size) throw new Error('Video media emitted an unexpected byte length.');
		publication = await writer.commitOwned({ signal });
		throwIfImportAborted(signal);
		if (!publication || typeof publication.discardIfCurrent !== 'function'
			|| publication.metadata.sha256 !== sha256 || publication.metadata.size !== body.size) {
			throw new Error('Published video metadata disagrees with its admitted content.');
		}
		return Object.freeze({ sha256, publication });
	} catch (error) {
		try {
			if (publication) await publication.discardIfCurrent();
			else await writer.abort();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Video publication and cleanup both failed.', { cause: error });
		}
		throw error;
	}
}

function positiveWriterChunkBytes(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError('The video media writer has an invalid chunk bound.');
	}
	return Number(value);
}

function throwIfImportAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Video import was cancelled.', 'AbortError');
}
