/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	VideoPreviewEncodedPayloadTooLargeError,
	VideoPreviewSourceGeometryTooLargeError,
} from '../video-preview-capture-admission.ts';

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
		bufferFromChannels, cacheSourceBuffer, canonicalizeBuffer, commit,
		copy, createAddClipCommand, createAddSourceCommand, createAddTrackCommand,
		createAudioEditorVideoFrameExtractor, createStableId, engine, ffmpeg,
		findTrack, fitAudioBufferToFrames, generateWaveformPeaks, inspectEncodedAudioSampleRate,
		normalizeImportOptions, peakCacheKey, preflightStorage, getProject,
		projectSampleRate, revokeVideoVisual, sourceBuffers, sourcePeaks,
		store, stripExtension, warnEnvelope, writeBuffer,
	} = runtime;
	async function importVideoFile(file: RuntimeValue, importOptions: RuntimeValue = normalizeImportOptions()) {
		await preflightStorage(Math.max(file.size * 2, 16 * 1024 * 1024), 'import');
		const extractor = await createAudioEditorVideoFrameExtractor(file);
		const sampleRate = projectSampleRate();
		const durationFrames = Math.max(1, Math.round(extractor.metadata.durationSeconds * sampleRate));
		const videoSourceId = createStableId('video-source');
		const videoClipId = createStableId('video-clip');
		const binItemId = createStableId('bin-item');
		const trackName = stripExtension(file.name) || `Video ${getProject().tracks.filter((track: RuntimeValue) => track.type === 'video').length + 1}`;
		const sourceName = file.name || `${trackName}.mp4`;
		let audioSourceId = null;
		let audioClipId = null;
		let canonicalAudio = null;
		let originalAudioSampleRate = sampleRate;
		let mediaPersisted = false;
		let audioPersisted = false;
		try {
			await store.writeMediaAsset(videoSourceId, file, {
				name: sourceName,
				mimeType: file.type || 'video/mp4',
				width: extractor.metadata.width,
				height: extractor.metadata.height,
				durationSeconds: extractor.metadata.durationSeconds,
			});
			mediaPersisted = true;
			const thumbnailTimes = audioEditorVideoThumbnailTimes(extractor.metadata.durationSeconds);
			let sourcePreviewUnavailable = false;
			try {
				const poster = await extractor.capture(0, { maximumWidth: 640, maximumHeight: 360 });
				await store.saveVideoDerivative(videoSourceId, {
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
					const thumbnail = await extractor.capture(timestamp);
					await store.saveVideoDerivative(videoSourceId, {
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
				let decodedAudio;
				let declaredAudioSampleRate = null;
				try {
					// The browser has already decoded this container for thumbnails,
					// and native Web Audio handles AAC tracks that may be unavailable
					// to a particular FFmpeg core build.
					const encoded = await file.arrayBuffer();
					declaredAudioSampleRate = inspectEncodedAudioSampleRate(encoded);
					decodedAudio = await engine.decodeAudioData(encoded);
				} catch {
					decodedAudio = await ffmpeg.decode(file, { sampleRate });
				}
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
					canonicalAudio = fitAudioBufferToFrames(resampled, durationFrames, context);
				}
			} catch {
				canonicalAudio = null;
			}

			if (canonicalAudio) {
				await preflightStorage(
					canonicalAudio.length * canonicalAudio.numberOfChannels * Float32Array.BYTES_PER_ELEMENT,
					'import',
				);
				audioSourceId = createStableId('source');
				audioClipId = createStableId('clip');
				const writer = await store.beginSourceWrite(audioSourceId, {
					name: `${trackName} Audio`,
					mimeType: 'audio/x-soundscaper-extracted',
					sampleRate: canonicalAudio.sampleRate,
					channelCount: canonicalAudio.numberOfChannels,
					chunkFrames: SOURCE_CHUNK_FRAMES,
				});
				try {
					await writeBuffer(writer, canonicalAudio);
					await writer.commit({
						sampleRate: canonicalAudio.sampleRate,
						channelCount: canonicalAudio.numberOfChannels,
					});
					audioPersisted = true;
				} catch (error) {
					await writer.abort().catch(() => undefined);
					throw error;
				}
				cacheSourceBuffer(audioSourceId, canonicalAudio);
				const peaks = await generateWaveformPeaks(audioBufferChannels(canonicalAudio), copy);
				sourcePeaks.set(audioSourceId, peaks);
				await store.saveAnalysis(peakCacheKey(audioSourceId), peaks);
			}

			const videoSource = {
				kind: 'video',
				id: videoSourceId,
				storageKey: videoSourceId,
				name: sourceName,
				mimeType: file.type || 'video/mp4',
				frameCount: durationFrames,
				sampleRate,
				width: extractor.metadata.width,
				height: extractor.metadata.height,
				frameRate: 30,
				videoCodec: 'unknown',
				audioCodec: canonicalAudio ? 'unknown' : null,
				hasAudio: Boolean(canonicalAudio),
				posterStorageKey: null,
				thumbnailStorageKey: null,
				opaqueExtensions: {},
			};
			const audioSource = canonicalAudio ? {
				kind: 'audio',
				schemaVersion: 4,
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
				opaqueExtensions: { originVideoSourceId: videoSourceId },
			} : null;
			const videoClip = {
				kind: 'video',
				id: videoClipId,
				sourceId: videoSourceId,
				title: trackName,
				timelineStartFrame: importOptions.timelineStartFrame,
				sourceStartFrame: 0,
				sourceDurationFrames: durationFrames,
				durationFrames,
				trimStartFrames: 0,
				trimEndFrames: 0,
				groupId: null,
				color: 'auto',
				speedRatio: 1,
				avLinkId: null,
				binItemId: importOptions.destination === 'project-bin' ? binItemId : null,
				opaqueExtensions: {},
			};
			const audioClip = canonicalAudio ? {
				kind: 'audio',
				schemaVersion: 4,
				id: audioClipId,
				sourceId: audioSourceId,
				title: `${trackName} Audio`,
				timelineStartFrame: importOptions.timelineStartFrame,
				sourceStartFrame: 0,
				sourceDurationFrames: durationFrames,
				durationFrames,
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
							schemaVersion: 4,
							type: 'video',
							id: videoTrackId,
							name: trackName,
							laneGroupId,
						}),
						index,
					}, {
						...createAddTrackCommand({
							schemaVersion: 4,
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
			await activateVideoSource(videoSource);
			commit({ type: 'batch', commands }, {
				selectTrackId: selectedTrackId,
				selectClipId: videoClipId,
			});
			warnEnvelope();
			return Object.freeze({
				destination: importOptions.destination,
				sourceId: videoSourceId,
				audioSourceId,
				clipId: videoClipId,
				audioClipId,
				trackId: selectedTrackId,
			});
		} catch (error) {
			revokeVideoVisual(videoSourceId);
			if (audioSourceId) {
				sourceBuffers.delete(audioSourceId);
				sourcePeaks.delete(audioSourceId);
				if (audioPersisted) await store.deleteSource(audioSourceId).catch(() => undefined);
			}
			if (mediaPersisted) await store.deleteMediaAsset(videoSourceId).catch(() => undefined);
			throw error;
		} finally {
			extractor.dispose();
		}
	}
	return importVideoFile;
}
