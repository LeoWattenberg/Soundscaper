/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectWavContainerSignature, inspectWavForImport } from './wav-import-routing.ts';
import {
	createImportedAdmPassthroughMetadata,
	prepareImportedWavMetadata,
} from './wav-import-metadata.ts';
import {
	freezeProjectImportOptions,
	linkedOriginalLocatorReferenceFromImportOptions,
	linkedVideoLocatorReferenceFromImportOptions,
	normalizeProjectImportOptions,
	normalizeProjectImportOptionsForUse,
	normalizeProjectImportTimelineStartFrame,
	type LinkedOriginalImportLocatorReference,
} from './project-import-options.ts';
import { createIncrementalWavImporter } from './incremental-wav-import-service.ts';
import { createLinkedAudioImportAdmission } from './linked-audio-import-admission.ts';
import { createLinkedPcmImporter } from './linked-wav-import-service.ts';
import { decodeStandaloneAudioForImport } from './standalone-audio-import-decoder.ts';
import { createAddTimelineAnnotationCommand } from '../commands/factories.ts';
import {
	createOmittedRiffAnnotationImportReport,
	createRiffAnnotationImport,
} from '../timeline-annotation-riff-interchange.ts';
import { scaleSampleFrame } from '../timeline-time.ts';

export interface ProjectImportRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = ProjectImportRuntime[string];

const BEXT_CODEC_WARNING_CODES = new Set([
	'invalid-ascii', 'invalid-chunk-id', 'invalid-date', 'invalid-line-ending',
	'invalid-loudness', 'invalid-padding', 'invalid-time', 'nonzero-reserved',
	'payload-too-large', 'truncated-chunk', 'truncated-payload',
	'unterminated-coding-history', 'unsupported-version',
]);
export function createProjectImportService(runtime: ProjectImportRuntime) {
	const {
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES, SOURCE_CHUNK_FRAMES, activateStoredSource, audioBufferChannels,
		bufferFromChannels, cacheSourceBuffer, canonicalizeBuffer, commit,
		convertLegacyAupToProject, copy, createAddClipCommand, createAddSourceCommand,
		createAddTrackCommand, createStableId, decodeLegacyAupProject, assertProject, captureProject,
		editingBlocked, engine, ffmpeg, findTrack,
		formatLegacyAupWarning, generateWaveformPeaks, handleError, importVideoFile,
		inspectEncodedAudioSampleRate, inspectWavBlobPcm, isAudioEditorVideoFile,
		isAudioEditorEngineSupported, isLegacyAupFile, isLegacyBlockFile, isWavFile,
		peakCacheKey, preflightStorage, getProject, projectSampleRate,
		publishDocumentSnapshot, retireSourceChunkProvider, setStatus, sourceBuffers,
		sourcePcmBytes, sourcePeaks, state, store,
		streamWavBlobPcm, stripExtension, switchProject, warnEnvelope,
		writeBuffer, taskProgress,
	} = runtime;
	let activeImportProgress: RuntimeValue = null;
	const importIncrementalWav = createIncrementalWavImporter({
		SOURCE_CHUNK_FRAMES, activateStoredSource, commit, copy, createStableId,
		getProject, importResultWithWarnings, preflightStorage,
		prepareImportedMediaCommand, projectSampleRate,
		reportProgress: (value) => { activeImportProgress?.update?.(value); },
		retireSourceChunkProvider, sourceBuffers, sourcePcmBytes, sourcePeaks, store,
		streamWavBlobPcm, stripExtension, warnEnvelope,
	});
	const importLinkedPcm = createLinkedPcmImporter({
		SOURCE_CHUNK_FRAMES, activateStoredSource, assertProject, captureProject,
		commit, copy, createStableId, getProject, importResultWithWarnings,
		peakCacheKey, prepareImportedMediaCommand, projectSampleRate, sourceBuffers,
		retireSourceChunkProvider, sourcePeaks, store, stripExtension, warnEnvelope,
	});
	const importLinkedAudio = createLinkedAudioImportAdmission({
		importLinkedPcm, inspectWavBlobPcm, isWavFile, prepareWavImportMetadata,
		releaseLinkedOriginalLocator, validateImportTimelineTrack,
	});
	async function importFiles(fileList: RuntimeValue, requestedOptions: RuntimeValue = {}) {
		const files = [...(fileList || [])];
		const importOptions = await normalizedImportOptionsForUse(requestedOptions);
		const linkedOriginalLocator = linkedOriginalLocatorReferenceFromImportOptions(importOptions);
		if (!files.length || editingBlocked()) {
			if (linkedOriginalLocator) await releaseLinkedOriginalLocator(linkedOriginalLocator);
			return;
		}
		if (linkedOriginalLocator && (files.length !== 1
			|| (linkedOriginalLocator.kind === 'video' && !isAudioEditorVideoFile(files[0]))
			|| (linkedOriginalLocator.kind === 'audio' && isAudioEditorVideoFile(files[0])))) {
			try { await rejectLinkedOriginalLocator(linkedOriginalLocator); }
			catch (error) { handleError(error); }
			return;
		}
		const progressTask = taskProgress?.begin?.('import', copy.importing) || null;
		activeImportProgress = progressTask;
		state.importing = true;
		publishDocumentSnapshot();
		setStatus(copy.importing);
		let failures = 0;
		let successes = 0;
		const notices = [];
		let importQueue = files;
		const progressFiles = files.filter((file: RuntimeValue) => !isLegacyBlockFile(file));
		const totalBytes = Math.max(1, progressFiles.reduce((sum: number, file: RuntimeValue) => (
			sum + Math.max(1, Number(file?.size) || 0)
		), 0));
		let completedBytes = 0;
		const legacyProject = files.find(isLegacyAupFile);
		if (legacyProject) {
			setImportFileProgress(legacyProject, completedBytes, totalBytes);
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
			activeImportProgress?.update?.(1);
			completedBytes += Math.max(1, Number(legacyProject.size) || 0);
			// `.au` files selected with a legacy project are its immutable block
			// store, not independent media imports.
			importQueue = files.filter((file: RuntimeValue) => file !== legacyProject && !isLegacyAupFile(file) && !isLegacyBlockFile(file));
		}
		let audioFileIndex = 0;
		for (const file of importQueue) {
			setImportFileProgress(file, completedBytes, totalBytes);
			try {
				const result = await importFile(file, importFilePlacement(importOptions, audioFileIndex));
				if (result?.notice) notices.push(result.notice);
				successes += 1;
			} catch (error) {
				failures += 1;
				handleError(error);
			}
			activeImportProgress?.update?.(1);
			completedBytes += Math.max(1, Number(file?.size) || 0);
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
			progressTask?.finish?.();
			if (activeImportProgress === progressTask) activeImportProgress = null;
		}
	}

	function setImportFileProgress(file: RuntimeValue, completedBytes: number, totalBytes: number) {
		const fileBytes = Math.max(1, Number(file?.size) || 0);
		activeImportProgress?.setPhase?.(copy.importing, {
			start: completedBytes / totalBytes,
			end: Math.min(1, (completedBytes + fileBytes) / totalBytes),
			value: null,
		});
	}

	function normalizeImportOptions(value: RuntimeValue = {}) {
		return normalizeProjectImportOptions(value, copy.timelineFramesFinite);
	}

	function normalizedImportOptionsForUse(value: RuntimeValue) {
		return normalizeProjectImportOptionsForUse(
			value,
			copy.timelineFramesFinite,
			releaseLinkedOriginalLocator,
		);
	}
	async function releaseLinkedOriginalLocator(reference: LinkedOriginalImportLocatorReference) {
		const { kind, locatorId, locatorRevision } = reference;
		const locator = Object.freeze({ locatorId, locatorRevision });
		if (kind === 'video') return releaseLinkedVideoLocator(locator);
		const released = typeof store.releaseLinkedOriginalLocator === 'function'
			? await store.releaseLinkedOriginalLocator(reference)
			: await store.releaseLinkedAudioOriginalLocator(locator);
		if (released === false) throw new Error('The unused linked-audio locator was not released.');
	}
	async function releaseLinkedVideoLocator(reference: RuntimeValue) {
		const released = await store.releaseLinkedVideoOriginalLocator(reference);
		if (released === false) throw new Error('The unused linked-video locator was not released.');
	}

	async function rejectLinkedVideoLocator(locatorId: RuntimeValue): Promise<never> {
		const reference = linkedVideoLocatorReferenceFromImportOptions({
			linkedVideoLocatorId: locatorId?.locatorId,
			linkedVideoLocatorRevision: locatorId?.locatorRevision,
		});
		if (!reference) throw new TypeError('A valid linked video locator is required.');
		return rejectLinkedOriginalLocator({ kind: 'video', ...reference });
	}

	async function rejectLinkedOriginalLocator(
		reference: LinkedOriginalImportLocatorReference,
	): Promise<never> {
		const refusal = new TypeError(
			`A linked ${reference.kind} locator can only be used for a ${reference.kind} import.`,
		);
		try {
			await releaseLinkedOriginalLocator(reference);
		} catch (cleanupError) {
			throw new AggregateError([refusal, cleanupError], 'Linked-original import refusal cleanup failed.', {
				cause: refusal,
			});
		}
		throw refusal;
	}

	function freezeImportOptions(value: RuntimeValue, timelineStartExplicit: boolean) {
		return freezeProjectImportOptions(value, timelineStartExplicit);
	}

	function normalizeImportTimelineStartFrame(value: RuntimeValue) {
		return normalizeProjectImportTimelineStartFrame(value, copy.timelineFramesFinite);
	}

	function importFilePlacement(importOptions: RuntimeValue, fileIndex: RuntimeValue) {
		if (importOptions.destination !== 'timeline' || !importOptions.trackId) return importOptions;
		if (fileIndex === 0) return importOptions;
		const targetTrackIndex = getProject().tracks.findIndex((track: RuntimeValue) => track.id === importOptions.trackId);
		return freezeImportOptions({
			...importOptions,
			trackId: null,
			trackIndex: targetTrackIndex < 0 ? undefined : targetTrackIndex + fileIndex,
		}, Boolean(importOptions.timelineStartExplicit));
	}

	function prepareImportedMediaCommand(
		source: RuntimeValue,
		clip: RuntimeValue,
		trackName: RuntimeValue,
		importOptions: RuntimeValue,
		projectBext: RuntimeValue = null,
		wavMarkers: readonly RuntimeValue[] = [],
		sourceSampleRate: number = projectSampleRate(),
		projectIxml: RuntimeValue = null,
		projectCart: RuntimeValue = null,
		projectAdmCandidate: RuntimeValue = null,
		wavDescriptor: RuntimeValue = null,
	) {
		const projectAdm = createImportedAdmPassthroughMetadata({
			candidate: projectAdmCandidate, source, descriptor: wavDescriptor, project: getProject(),
		});
		const markerImport = wavMarkers.length
			? importOptions.destination === 'project-bin'
				? { annotations: [], report: createOmittedRiffAnnotationImportReport(wavMarkers, 'project-bin') }
				: createRiffAnnotationImport(getProject(), wavMarkers, {
					sourceSampleRate,
					timelineStartFrame: importOptions.timelineStartFrame,
					idFactory: createStableId,
				})
			: null;
		const commands = [];
		if (projectBext || projectIxml || projectCart || projectAdm) commands.push({ type: 'metadata/update', changes: {
			...(projectBext ? { bext: projectBext } : {}),
			...(projectIxml ? { ixml: projectIxml } : {}),
			...(projectCart ? { cart: projectCart } : {}),
			...(projectAdm ? { adm: projectAdm } : {}),
		} });
		commands.push(createAddSourceCommand(source));
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
					...(markerImport ? { timelineAnnotationInterchangeReport: markerImport.report } : {}),
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
		if (markerImport) commands.push(...markerImport.annotations.map(createAddTimelineAnnotationCommand));
		return {
			command: { type: 'batch', commands },
			selection: { selectTrackId: trackId, selectClipId: clip.id },
			result: Object.freeze({
				destination: 'timeline',
				sourceId: source.id,
				clipId: clip.id,
				trackId,
				...(markerImport ? { timelineAnnotationInterchangeReport: markerImport.report } : {}),
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
		const normalizedImportOptions = await normalizedImportOptionsForUse(importOptions);
		const linkedOriginalLocator = linkedOriginalLocatorReferenceFromImportOptions(normalizedImportOptions);
		const legacyFile = isLegacyAupFile(file);
		if (linkedOriginalLocator && legacyFile) {
			return rejectLinkedOriginalLocator(linkedOriginalLocator);
		}
		if (legacyFile) {
			await preflightStorage(Math.max(file.size * 8, 8 * 1024 * 1024), 'import');
			return importLegacyAudacityProject(file);
		}
		const videoFile = isAudioEditorVideoFile(file);
		if (linkedOriginalLocator?.kind === 'video' && !videoFile) {
			return rejectLinkedVideoLocator(linkedVideoLocatorReferenceFromImportOptions(normalizedImportOptions));
		}
		if (linkedOriginalLocator?.kind === 'audio' && videoFile) {
			return rejectLinkedOriginalLocator(linkedOriginalLocator);
		}
		if (videoFile) return importVideoFile(file, normalizedImportOptions);
		if (linkedOriginalLocator?.kind === 'audio') {
			return importLinkedAudio(file, normalizedImportOptions, linkedOriginalLocator);
		}
		validateImportTimelineTrack(normalizedImportOptions);
		const wavSignature = await inspectWavContainerSignature(file, isWavFile);
		const wavDescriptor: RuntimeValue = await inspectWavForImport(
			file, isWavFile, inspectWavBlobPcm, wavSignature,
		);
		const wavMetadata = prepareWavImportMetadata(wavDescriptor, normalizedImportOptions);
		const requireChunkStream = Boolean(wavDescriptor
			&& isAudioEditorEngineSupported?.() === false);
		if (wavSignature === 'RF64' || wavSignature === 'BW64') {
			if (!wavDescriptor) throw new Error(`The ${wavSignature} WAV file could not be inspected incrementally.`);
			return importIncrementalWav(file, wavDescriptor, wavMetadata.importOptions, wavMetadata, { requireChunkStream });
		}
		if (requireChunkStream || isIncrementalWav(wavDescriptor)) {
			return importIncrementalWav(file, wavDescriptor, wavMetadata.importOptions, wavMetadata, { requireChunkStream });
		}
		await preflightStorage(Math.max(file.size * 8, 8 * 1024 * 1024), 'import');
		const { context, decoded, originalSampleRate } = await decodeStandaloneAudioForImport({
			file, codecRuntime: ffmpeg, sampleRate: projectSampleRate(),
			getAudioContext: () => engine.getAudioContext({ resume: false }),
			decodeWithWebAudio: (encoded) => engine.decodeAudioData(encoded),
			decodeWithCodec: (input, settings) => ffmpeg.decode(input, settings),
			bufferFromChannels: (channels, sampleRate, audioContext) => (
				bufferFromChannels(channels, sampleRate, audioContext, copy)
			),
			inspectEncodedSampleRate: inspectEncodedAudioSampleRate,
		});
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
			...((wavMetadata.sourceBext || wavMetadata.sourceIxml || wavMetadata.sourceCart || wavMetadata.sourceAdm) ? { opaqueExtensions: {
				...(wavMetadata.sourceBext ? { bext: wavMetadata.sourceBext } : {}),
				...(wavMetadata.sourceIxml ? { ixml: wavMetadata.sourceIxml } : {}),
				...(wavMetadata.sourceCart ? { cart: wavMetadata.sourceCart } : {}),
				...(wavMetadata.sourceAdm ? { adm: wavMetadata.sourceAdm } : {}),
			} } : {}),
		}, {
			title: trackName,
			sourceDurationFrames: canonical.length,
			id: clipId,
			sourceId,
			timelineStartFrame: 0,
			sourceStartFrame: 0,
				durationFrames: Math.max(1, scaleSampleFrame(
					canonical.length, canonical.sampleRate, projectSampleRate(), 'point',
				)),
		}, trackName, wavMetadata.importOptions, wavMetadata.projectBext, wavDescriptor?.markers || [], wavDescriptor?.sampleRate || canonical.sampleRate, wavMetadata.projectIxml, wavMetadata.projectCart, wavMetadata.projectAdmCandidate, wavDescriptor);
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
		return importResultWithWarnings(prepared.result, wavMetadata.warnings);
	}

	function isIncrementalWav(descriptor: RuntimeValue) {
		return Boolean(descriptor
			&& sourcePcmBytes(descriptor) > SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES);
	}

	function prepareWavImportMetadata(descriptor: RuntimeValue, importOptions: RuntimeValue) {
		return prepareImportedWavMetadata({ descriptor, importOptions, project: getProject(),
			projectSampleRate: projectSampleRate(), copy, freezeImportOptions });
	}

	function importResultWithWarnings(result: RuntimeValue, warnings: readonly RuntimeValue[]) {
		if (!warnings.length) return result;
		const messages = [...new Set(warnings.map((warning) => {
			if (typeof warning === 'string') return warning;
			if (warning?.code === 'bext-time-reference-conversion' || warning?.code === 'bext-spot-out-of-range') {
				return warning.message;
			}
			if (isBextMetadataWarning(warning)) {
				return copy.bextMetadataImportWarning || warning.message;
			}
			if (typeof warning?.message === 'string') return warning.message;
			return String(warning?.code || 'WAV metadata warning.');
		}).filter(Boolean))];
		return Object.freeze({
			...result,
			metadataWarnings: Object.freeze([...warnings]),
			...(messages.length ? { notice: messages.join(' ') } : {}),
		});
	}

	function isBextMetadataWarning(warning: RuntimeValue) {
		const code = typeof warning?.code === 'string' ? warning.code : '';
		return code.startsWith('bext-') || BEXT_CODEC_WARNING_CODES.has(code);
	}

	async function importLegacyAudacityProject(file: RuntimeValue, legacyDataFiles: RuntimeValue = []) {
		setStatus(copy.aupImporting);
		const structure = await decodeLegacyAupProject(file, legacyDataFiles, { onProgress: updateLegacyAupImportProgress });
		const decoded = convertLegacyAupToProject(structure, {
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
		const importedProject = decoded.project;
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
		activeImportProgress?.update?.(percentage / 100);
		setStatus(`${copy.aupImporting} ${Math.max(0, Math.min(100, Math.round(percentage)))}%`);
	}
	return Object.freeze({
		importFile,
		importFiles,
		normalizeImportOptions,
		normalizeImportTimelineStartFrame,
	});
}
