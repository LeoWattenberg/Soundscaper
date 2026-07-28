/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ProjectImportRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = ProjectImportRuntime[string];

export function createProjectImportService(runtime: ProjectImportRuntime) {
	const {
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES, SOURCE_CHUNK_FRAMES, activateStoredSource, audioBufferChannels,
		bufferFromChannels, cacheSourceBuffer, canonicalizeBuffer, commit,
		convertLegacyAupToProjectV2, copy, createAddClipCommand, createAddSourceCommand,
		createAddTrackCommand, createStableId, decodeLegacyAupProject,
		editingBlocked, engine, ffmpeg, findTrack,
		formatLegacyAupWarning, generateWaveformPeaks, handleError, importVideoFile,
		inspectEncodedAudioSampleRate, inspectWavBlobPcm, isAudioEditorVideoFile,
		isLegacyAupFile, isLegacyBlockFile, isWavFile, migrateAudioEditorProject,
		peakCacheKey, preflightStorage, getProject, projectSampleRate,
		publishDocumentSnapshot, setStatus, sourceBuffers, sourceChunkProviders,
		sourcePcmBytes, sourcePeaks, state, store,
		streamWavBlobPcm, stripExtension, switchProject, warnEnvelope,
		writeBuffer,
	} = runtime;
	async function importFiles(fileList: RuntimeValue, requestedOptions: RuntimeValue = {}) {
		const files = [...(fileList || [])];
		if (!files.length || editingBlocked()) return;
		const importOptions = normalizeImportOptions(requestedOptions);
		state.importing = true;
		publishDocumentSnapshot();
		setStatus(copy.importing);
		let failures = 0;
		let successes = 0;
		const notices = [];
		let importQueue = files;
		const legacyProject = files.find(isLegacyAupFile);
		if (legacyProject) {
			try {
				const result = await importLegacyAudacityProject(
					legacyProject,
					files.filter((file: RuntimeValue) => file !== legacyProject && !isLegacyAupFile(file)),
				);
				if (result?.notice) notices.push(result.notice);
				successes += 1;
			} catch (error) {
				failures += 1;
				handleError(error);
			}
			// `.au` files selected with a legacy project are its immutable block
			// store, not independent media imports.
			importQueue = files.filter((file: RuntimeValue) => file !== legacyProject && !isLegacyAupFile(file) && !isLegacyBlockFile(file));
		}
		let audioFileIndex = 0;
		for (const file of importQueue) {
			try {
				const result = await importFile(file, importFilePlacement(importOptions, audioFileIndex));
				if (result?.notice) notices.push(result.notice);
				successes += 1;
			} catch (error) {
				failures += 1;
				handleError(error);
			}
			audioFileIndex += 1;
		}
		try {
			if (!failures) setStatus(notices.length ? notices.join(' ') : copy.done, 'success');
			else setStatus(copy.importSummary
				.replace('{successes}', String(successes))
				.replace('{failures}', String(failures)), 'error');
		} finally {
			state.importing = false;
			publishDocumentSnapshot();
		}
	}

	function normalizeImportOptions(value: RuntimeValue = {}) {
		const requestedDestination = value?.destination ?? 'auto';
		if (!['auto', 'timeline', 'project-bin'].includes(requestedDestination)) {
			throw new RangeError(`Unsupported audio import destination: ${requestedDestination}.`);
		}
		const destination = requestedDestination === 'auto'
			? value?.projectBinVisible ? 'project-bin' : 'timeline'
			: requestedDestination;
		return Object.freeze({
			destination,
			trackId: value?.trackId == null ? null : String(value.trackId),
			timelineStartFrame: normalizeImportTimelineStartFrame(value?.timelineStartFrame ?? 0),
		});
	}

	function normalizeImportTimelineStartFrame(value: RuntimeValue) {
		const frame = Number(value);
		if (!Number.isFinite(frame)) throw new TypeError(copy.timelineFramesFinite);
		const rounded = Math.max(0, Math.round(frame));
		if (!Number.isSafeInteger(rounded)) throw new RangeError(copy.timelineFramesFinite);
		return rounded;
	}

	function importFilePlacement(importOptions: RuntimeValue, fileIndex: RuntimeValue) {
		if (importOptions.destination !== 'timeline' || !importOptions.trackId) return importOptions;
		if (fileIndex === 0) return importOptions;
		const targetTrackIndex = getProject().tracks.findIndex((track: RuntimeValue) => track.id === importOptions.trackId);
		return Object.freeze({
			...importOptions,
			trackId: null,
			trackIndex: targetTrackIndex < 0 ? undefined : targetTrackIndex + fileIndex,
		});
	}

	function prepareImportedMediaCommand(source: RuntimeValue, clip: RuntimeValue, trackName: RuntimeValue, importOptions: RuntimeValue) {
		const commands = [createAddSourceCommand(source)];
		if (importOptions.destination === 'project-bin') {
			commands.push({ type: 'project-bin/add', clip });
			return {
				command: { type: 'batch', commands },
				selection: {},
				result: Object.freeze({
					destination: 'project-bin',
					sourceId: source.id,
					clipId: clip.id,
					trackId: null,
				}),
			};
		}

		let track = null;
		if (importOptions.trackId) {
			track = findTrack(getProject(), importOptions.trackId);
			if (!track || track.type !== 'audio') throw new Error(copy.audioTrackNotFound);
		}
		const trackId = track?.id || createStableId('track');
		if (!track) {
			commands.push({
				...createAddTrackCommand({
					schemaVersion: 2,
					type: 'audio',
					id: trackId,
					name: trackName,
				}),
				...(Number.isSafeInteger(importOptions.trackIndex) ? { index: importOptions.trackIndex } : {}),
			});
		}
		commands.push(createAddClipCommand(trackId, {
			...clip,
			timelineStartFrame: importOptions.timelineStartFrame,
		}));
		return {
			command: { type: 'batch', commands },
			selection: { selectTrackId: trackId, selectClipId: clip.id },
			result: Object.freeze({
				destination: 'timeline',
				sourceId: source.id,
				clipId: clip.id,
				trackId,
			}),
		};
	}

	function validateImportTimelineTrack(importOptions: RuntimeValue) {
		if (importOptions.destination !== 'timeline' || !importOptions.trackId) return null;
		const track = findTrack(getProject(), importOptions.trackId);
		if (!track || track.type !== 'audio') throw new Error(copy.audioTrackNotFound);
		return track;
	}

	async function importFile(file: RuntimeValue, importOptions: RuntimeValue = normalizeImportOptions()) {
		if (isLegacyAupFile(file)) {
			await preflightStorage(Math.max(file.size * 8, 8 * 1024 * 1024), 'import');
			return importLegacyAudacityProject(file);
		}
		if (isAudioEditorVideoFile(file)) return importVideoFile(file, importOptions);
		validateImportTimelineTrack(importOptions);
		const incrementalWav = await inspectIncrementalWav(file);
		if (incrementalWav) return importIncrementalWav(file, incrementalWav, importOptions);
		await preflightStorage(Math.max(file.size * 8, 8 * 1024 * 1024), 'import');
		const context = await engine.getAudioContext({ resume: false });
		let decoded;
		let originalSampleRate = null;
		try {
			const encoded = await file.arrayBuffer();
			originalSampleRate = inspectEncodedAudioSampleRate(encoded);
			decoded = await engine.decodeAudioData(encoded);
		} catch {
			const fallback = await ffmpeg.decode(file, { sampleRate: projectSampleRate() });
			decoded = await bufferFromChannels(fallback.channels, fallback.sampleRate, context, copy);
			originalSampleRate ??= fallback.sampleRate;
		}
		const canonical = await canonicalizeBuffer(decoded, context, null, copy);
		await preflightStorage(canonical.length * canonical.numberOfChannels * Float32Array.BYTES_PER_ELEMENT, 'import');
		const sourceId = createStableId('source');
		const clipId = createStableId('clip');
		const trackName = stripExtension(file.name) || `${copy.track} ${getProject().tracks.length + 1}`;
		const sourceName = file.name;
		const mimeType = file.type || 'audio/wav';
		const writer = await store.beginSourceWrite(sourceId, {
			name: sourceName,
			mimeType,
			sampleRate: canonical.sampleRate,
			channelCount: canonical.numberOfChannels,
			chunkFrames: SOURCE_CHUNK_FRAMES,
		});
		try {
			await writeBuffer(writer, canonical);
			await writer.commit({ sampleRate: canonical.sampleRate, channelCount: canonical.numberOfChannels });
		} catch (error) {
			await writer.abort();
			throw error;
		}

		const prepared = prepareImportedMediaCommand({
			schemaVersion: 2,
			sampleFormat: 'float32',
			chunkFrames: SOURCE_CHUNK_FRAMES,
			id: sourceId,
			storageKey: sourceId,
			name: sourceName,
			mimeType,
			frameCount: canonical.length,
			channelCount: canonical.numberOfChannels,
			sampleRate: canonical.sampleRate,
			originalSampleRate: originalSampleRate || decoded.sampleRate,
		}, {
			schemaVersion: 2,
			title: trackName,
			sourceDurationFrames: canonical.length,
			id: clipId,
			sourceId,
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			durationFrames: Math.max(1, Math.round(canonical.length * projectSampleRate() / canonical.sampleRate)),
		}, trackName, importOptions);
		cacheSourceBuffer(sourceId, canonical);
		try {
			const peaks = await generateWaveformPeaks(audioBufferChannels(canonical), copy);
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			commit(prepared.command, prepared.selection);
		} catch (error) {
			sourceBuffers.delete(sourceId);
			sourcePeaks.delete(sourceId);
			await store.deleteSource(sourceId);
			throw error;
		}
		warnEnvelope();
		return prepared.result;
	}

	async function inspectIncrementalWav(file: RuntimeValue) {
		if (!isWavFile(file) || typeof file?.slice !== 'function') return null;
		try {
			const descriptor = await inspectWavBlobPcm(file);
			if (descriptor.channelCount > 2
				|| sourcePcmBytes(descriptor) <= SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES) return null;
			return descriptor;
		} catch {
			return null;
		}
	}

	async function importIncrementalWav(file: RuntimeValue, descriptor: RuntimeValue, importOptions: RuntimeValue = normalizeImportOptions()) {
		const pcmBytes = sourcePcmBytes(descriptor);
		await preflightStorage(pcmBytes, 'import');
		const sourceId = createStableId('source');
		const clipId = createStableId('clip');
		const trackName = stripExtension(file.name) || `${copy.track} ${getProject().tracks.length + 1}`;
		const sourceName = file.name;
		const mimeType = file.type || 'audio/wav';
		const writer = await store.beginSourceWrite(sourceId, {
			name: sourceName,
			mimeType,
			sampleRate: descriptor.sampleRate,
			channelCount: descriptor.channelCount,
			chunkFrames: SOURCE_CHUNK_FRAMES,
		});
		let metadata;
		try {
			await streamWavBlobPcm(file, {
				descriptor,
				chunkFrames: SOURCE_CHUNK_FRAMES,
				onChunk: (channels: RuntimeValue) => writer.write(channels),
			});
			metadata = await writer.commit({
				sampleRate: descriptor.sampleRate,
				channelCount: descriptor.channelCount,
				chunkFrames: SOURCE_CHUNK_FRAMES,
			});
		} catch (error) {
			await writer.abort().catch(() => undefined);
			throw error;
		}

		const source = {
			schemaVersion: 2,
			sampleFormat: 'float32',
			chunkFrames: SOURCE_CHUNK_FRAMES,
			id: sourceId,
			storageKey: sourceId,
			name: sourceName,
			mimeType,
			frameCount: descriptor.frameCount,
			channelCount: descriptor.channelCount,
			sampleRate: descriptor.sampleRate,
			originalSampleRate: descriptor.sampleRate,
		};
		const prepared = prepareImportedMediaCommand(source, {
			schemaVersion: 2,
			title: trackName,
			sourceDurationFrames: descriptor.frameCount,
			id: clipId,
			sourceId,
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			durationFrames: Math.max(1, Math.round(descriptor.frameCount * projectSampleRate() / descriptor.sampleRate)),
		}, trackName, importOptions);
		try {
			await activateStoredSource(source, metadata);
			commit(prepared.command, prepared.selection);
		} catch (error) {
			sourceBuffers.delete(sourceId);
			sourceChunkProviders.delete(sourceId);
			sourcePeaks.delete(sourceId);
			await store.deleteSource(sourceId).catch(() => undefined);
			throw error;
		}
		warnEnvelope();
		return prepared.result;
	}

	async function importLegacyAudacityProject(file: RuntimeValue, legacyDataFiles: RuntimeValue = []) {
		setStatus(copy.aupImporting);
		const structure = await decodeLegacyAupProject(file, legacyDataFiles, { onProgress: updateLegacyAupImportProgress });
		const decoded = convertLegacyAupToProjectV2(structure, {
			title: stripExtension(file.name),
			projectId: createStableId('project'),
		});
		const importedProject = await persistImportedProject(decoded);
		const detail = decoded.warnings.map(formatLegacyAupWarning).filter(Boolean).join(' ');
		return {
			project: importedProject,
			warnings: decoded.warnings,
			notice: detail ? `${copy.aupImported} ${detail}` : copy.aupImported,
		};
	}

	async function persistImportedProject(decoded: RuntimeValue) {
		if (!decoded?.project || !Array.isArray(decoded.sources)) throw new TypeError(copy.structuredProjectRequired);
		const importedProject = migrateAudioEditorProject(decoded.project).project;
		const sourceById: RuntimeValue = new Map(importedProject.sources.map((source: RuntimeValue) => [source.id, source]));
		const totalBytes = decoded.sources.reduce((sum: RuntimeValue, source: RuntimeValue) => (
			sum + (source.channels || []).reduce((channelSum: RuntimeValue, channel: RuntimeValue) => channelSum + (channel?.byteLength || 0), 0)
		), 0);
		await preflightStorage(totalBytes, 'import');
		const persistedSourceIds = [];
		let projectSaved = false;
		try {
			for (const sourceAudio of decoded.sources) {
				const source = sourceById.get(sourceAudio.sourceId);
				if (!source) throw new Error(copy.importedSourceDescriptorMissing.replace('{source}', sourceAudio.sourceId));
				const channels = sourceAudio.channels;
				if (!Array.isArray(channels) || channels.length !== source.channelCount
					|| !channels.every((channel: RuntimeValue) => channel instanceof Float32Array && channel.length === source.frameCount)) {
					throw new Error(copy.importedSourcePcmInvalid.replace('{source}', source.name || source.id));
				}
				const writer = await store.beginSourceWrite(source.id, {
					name: source.name,
					mimeType: source.mimeType,
					sampleRate: source.sampleRate,
					channelCount: source.channelCount,
					chunkFrames: SOURCE_CHUNK_FRAMES,
				});
				try {
					for (let offset = 0; offset < source.frameCount; offset += SOURCE_CHUNK_FRAMES) {
						const end = Math.min(source.frameCount, offset + SOURCE_CHUNK_FRAMES);
						await writer.write(channels.map((channel: RuntimeValue) => channel.subarray(offset, end)));
					}
					await writer.commit({ sampleRate: source.sampleRate, channelCount: source.channelCount });
					persistedSourceIds.push(source.id);
					await store.saveAnalysis(peakCacheKey(source.id), await generateWaveformPeaks(channels, copy));
				} catch (error) {
					await writer.abort();
					throw error;
				}
			}
			await store.saveProject(importedProject);
			projectSaved = true;
			await switchProject(importedProject, { save: false });
			return importedProject;
		} catch (error) {
			if (projectSaved && getProject()?.id !== importedProject.id) {
				await store.deleteProject(importedProject.id).catch(() => undefined);
			}
			if (getProject()?.id !== importedProject.id) {
				for (const sourceId of persistedSourceIds) await store.deleteSource(sourceId).catch(() => undefined);
			}
			throw error;
		}
	}

	function updateLegacyAupImportProgress(progress: RuntimeValue) {
		const rawValue = typeof progress === 'number'
			? progress
			: Number(progress?.progress ?? progress?.value);
		if (!Number.isFinite(rawValue)) return;
		const percentage = rawValue <= 1 ? rawValue * 100 : rawValue;
		setStatus(`${copy.aupImporting} ${Math.max(0, Math.min(100, Math.round(percentage)))}%`);
	}
	return Object.freeze({
		importFile,
		importFiles,
		normalizeImportOptions,
		normalizeImportTimelineStartFrame,
	});
}
