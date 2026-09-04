/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectWavContainerSignature, inspectWavForImport } from './wav-import-routing.ts';
import { admitAudioImportChannelCount } from './audio-import-channel-admission.ts';
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
import { createImportResultWithWarnings } from './import-result-warnings.ts';
import { inspectDecodedAudioSampleRate } from '../audio-file-metadata.js';
import { scanEncodedAudioMarkers } from '../encoded-audio-marker-scan.ts';
import { streamAiffBlobPcm } from '../aiff-pcm-chunk-reader.ts';
import { inspectDesktopStandalonePcm } from './desktop-standalone-pcm-import.ts';
import { createIncrementalPcmImporter } from './incremental-wav-import-service.ts';
import {
	createImportedAudioContentIdentityWriter,
	rollbackImportedAudioContentIdentityWriter,
	type ImportedAudioContentIdentity,
} from './imported-audio-content-identity.ts';
import { createLegacyAudacityProjectImport } from './legacy-audacity-project-import.ts';
import { createLinkedAudioImportAdmission } from './linked-audio-import-admission.ts';
import { createLinkedPcmImporter } from './linked-wav-import-service.ts';
import { persistDecodedLegacyAupProject } from './legacy-aup-project-persistence.ts';
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

export function createProjectImportService(runtime: ProjectImportRuntime) {
	const {
		SOURCE_CHUNK_FRAMES, activateStoredSource, audioBufferChannels,
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
	const importResultWithWarnings = createImportResultWithWarnings(copy);
	const importIncrementalPcm = createIncrementalPcmImporter({
		SOURCE_CHUNK_FRAMES, activateStoredSource, commit, copy, createStableId,
		getProject, importResultWithWarnings, preflightStorage,
		prepareImportedMediaCommand, projectSampleRate,
		reportProgress: (value) => { activeImportProgress?.update?.(value); },
		retireSourceChunkProvider, sourceBuffers, sourcePcmBytes, sourcePeaks, store,
		streamAiffBlobPcm, streamWavBlobPcm, stripExtension, warnEnvelope,
	});
	const importLinkedPcm = createLinkedPcmImporter({
		SOURCE_CHUNK_FRAMES, activateStoredSource, assertProject, captureProject,
		commit, copy, createStableId, getProject, importResultWithWarnings,
		peakCacheKey, prepareImportedMediaCommand, projectSampleRate, sourceBuffers,
		retireSourceChunkProvider, sourcePeaks, store, stripExtension, warnEnvelope,
	});
	const importLegacyAudacityProject = createLegacyAudacityProjectImport({
		assertProject, captureProject, convertLegacyAupToProject, copy, createStableId,
		decodeLegacyAupProject, formatLegacyAupWarning, generateWaveformPeaks, getProject,
		peakCacheKey, persistDecodedLegacyAupProject, preflightStorage,
		reportProgress: (value: number) => { activeImportProgress?.update?.(value); },
		setStatus, sourceChunkFrames: SOURCE_CHUNK_FRAMES, store, stripExtension, switchProject,
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
		const startingProjectId = getProject()?.id ?? null;
		const hasProjectToken = typeof captureProject === 'function' && typeof assertProject === 'function';
		const startingProjectToken = hasProjectToken ? captureProject() : null;
		const assertImportProjectCurrent = () => {
			try { if (hasProjectToken) assertProject(startingProjectToken); }
			catch (error) { throw new Error('The project changed during audio import.', { cause: error }); }
			if ((getProject()?.id ?? null) !== startingProjectId) throw new Error('The project changed during audio import.');
		};
		assertImportProjectCurrent();
		validateImportTimelineTrack(normalizedImportOptions);
		const wavSignature = await inspectWavContainerSignature(file, isWavFile);
		assertImportProjectCurrent();
		const wavDescriptor: RuntimeValue = await inspectWavForImport(
			file, isWavFile, inspectWavBlobPcm, wavSignature,
		);
		assertImportProjectCurrent();
		if (wavDescriptor) admitAudioImportChannelCount(wavDescriptor.channelCount);
		const wavMetadata = prepareWavImportMetadata(wavDescriptor, normalizedImportOptions);
		const requireChunkStream = Boolean(wavDescriptor
			&& isAudioEditorEngineSupported?.() === false);
		if (wavSignature === 'RF64' || wavSignature === 'BW64') {
			if (!wavDescriptor) throw new Error(`The ${wavSignature} WAV file could not be inspected incrementally.`);
			return importIncrementalPcm(file, wavDescriptor, wavMetadata.importOptions, wavMetadata,
				{ requireChunkStream }, { assertCurrent: assertImportProjectCurrent });
		}
		const desktopPcmDescriptor = await inspectDesktopStandalonePcm(file, ffmpeg, wavDescriptor);
		assertImportProjectCurrent();
		if (desktopPcmDescriptor) {
			const pcmMetadata = desktopPcmDescriptor === wavDescriptor
				? wavMetadata
				: prepareWavImportMetadata(desktopPcmDescriptor, normalizedImportOptions);
			return importIncrementalPcm(file, desktopPcmDescriptor, pcmMetadata.importOptions, pcmMetadata, {
				requireChunkStream: true,
			}, { assertCurrent: assertImportProjectCurrent });
		}
		// Every PCM WAV the maintained reader accepted streams straight into the
		// store. Short ones used to be decoded instead, back when the codec
		// runtime was the only import path and the streaming reader was a
		// large-file escape hatch; the size split bought nothing but a skipped
		// read-back, and it cost the file its identity — `decodeAudioData`
		// resamples to the output device's rate and folds anything above two
		// channels to stereo, so the same recording imported as 192 kHz 6-channel
		// or as 48 kHz stereo depending only on whether it crossed 32 MB.
		if (wavDescriptor) {
			return importIncrementalPcm(file, wavDescriptor, wavMetadata.importOptions, wavMetadata,
				{ requireChunkStream }, { assertCurrent: assertImportProjectCurrent });
		}
		await preflightStorage(Math.max(file.size * 8, 8 * 1024 * 1024), 'import');
		assertImportProjectCurrent();
		// A container the maintained PCM reader refused (a non-PCM WAV, say) still
		// carries its cue chunk; scan it out before the codec decode discards
		// everything but samples.
		const rescuedMarkerScan = wavDescriptor ? null : await scanEncodedAudioMarkers(file);
		assertImportProjectCurrent();
		const { context, decoded, originalSampleRate } = await decodeStandaloneAudioForImport({
			file, codecRuntime: ffmpeg, sampleRate: projectSampleRate(),
			getAudioContext: () => engine.getAudioContext({ resume: false }),
			// Pinning the native decode to the file's own rate keeps a compressed
			// import from inheriting the output device's rate, the way the PCM
			// streaming path above keeps a WAV's.
			decodeWithWebAudio: (encoded: ArrayBuffer, decodedSampleRate: number | null) => (
				engine.decodeAudioData(encoded, { sampleRate: decodedSampleRate })
			),
			decodeWithCodec: (input, settings) => ffmpeg.decode(input, settings),
			bufferFromChannels: (channels, sampleRate, audioContext) => (
				bufferFromChannels(channels, sampleRate, audioContext, copy)
			),
			inspectEncodedSampleRate: inspectEncodedAudioSampleRate,
			inspectDecodedSampleRate: inspectDecodedAudioSampleRate,
		});
		assertImportProjectCurrent();
		const canonical = await canonicalizeBuffer(decoded, context, null, copy);
		assertImportProjectCurrent();
		await preflightStorage(canonical.length * canonical.numberOfChannels * Float32Array.BYTES_PER_ELEMENT, 'import');
		assertImportProjectCurrent();
		const sourceId = createStableId('source'), clipId = createStableId('clip');
		const trackName = stripExtension(file.name) || `${copy.track} ${getProject().tracks.length + 1}`;
		const sourceName = file.name;
		const mimeType = file.type || 'audio/wav';
		const writer = createImportedAudioContentIdentityWriter(await store.beginSourceWrite(sourceId, {
			name: sourceName,
			mimeType,
			sampleRate: canonical.sampleRate,
			channelCount: canonical.numberOfChannels,
			chunkFrames: SOURCE_CHUNK_FRAMES,
		}), SOURCE_CHUNK_FRAMES);
		let contentIdentity: ImportedAudioContentIdentity;
		let importedResult: RuntimeValue;
		try {
			assertImportProjectCurrent();
			await writeBuffer(writer, canonical);
			assertImportProjectCurrent();
			await writer.commit({ sampleRate: canonical.sampleRate, channelCount: canonical.numberOfChannels });
			assertImportProjectCurrent();
			contentIdentity = writer.contentIdentity(canonical.length);
		} catch (error) {
			return rollbackImportedAudioContentIdentityWriter(
				writer, () => store.deleteSource(sourceId), error,
			);
		}
		try {
			assertImportProjectCurrent();
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
				contentSha256: contentIdentity.contentSha256,
				byteLength: contentIdentity.byteLength,
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
			}, trackName, wavMetadata.importOptions, wavMetadata.projectBext, wavDescriptor?.markers || rescuedMarkerScan?.markers || [], wavDescriptor?.sampleRate || rescuedMarkerScan?.sampleRate || canonical.sampleRate, wavMetadata.projectIxml, wavMetadata.projectCart, wavMetadata.projectAdmCandidate, wavDescriptor);
			cacheSourceBuffer(sourceId, canonical);
			const peaks = await generateWaveformPeaks(audioBufferChannels(canonical), copy);
			assertImportProjectCurrent();
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			assertImportProjectCurrent();
			commit(prepared.command, prepared.selection);
			importedResult = prepared.result;
		} catch (error) {
			sourceBuffers.delete(sourceId);
			sourcePeaks.delete(sourceId);
			const cleanupErrors: unknown[] = [];
			try { await store.deleteAnalysis?.(peakCacheKey(sourceId)); }
			catch (cleanupError) { cleanupErrors.push(cleanupError); }
			try { await store.deleteSource(sourceId); }
			catch (cleanupError) { cleanupErrors.push(cleanupError); }
			if (cleanupErrors.length) {
				throw new AggregateError(
					[error, ...cleanupErrors],
					'Decoded audio import and rollback both failed.',
					{ cause: error },
				);
			}
			throw error;
		}
		warnEnvelope();
		return importResultWithWarnings(importedResult, wavMetadata.warnings);
	}

	function prepareWavImportMetadata(descriptor: RuntimeValue, importOptions: RuntimeValue) {
		return prepareImportedWavMetadata({ descriptor, importOptions, project: getProject(),
			projectSampleRate: projectSampleRate(), copy, freezeImportOptions });
	}
	return Object.freeze({
		importFile,
		importFiles,
		normalizeImportOptions,
		normalizeImportTimelineStartFrame,
	});
}
