/* SPDX-License-Identifier: AGPL-3.0-only */
import { admitBrowserExportBlob, prepareBrowserExportBlob } from '../browser-export-output.ts';
import { isVideoExportRequestFormat } from '../video-export-request-format.ts';
import { inheritTrackFolderMediaStateProjectionV12 } from '../track-folder-media-runtime.ts';
import { createExportRenderProject } from './export-render-project.ts';
import { createBw64RenderProject } from './bw64-render-project.ts';
import {
	admitAudioRenderedFallbackExport,
	audioRenderedFallbackRenderSources,
} from './audio-rendered-fallback-export.ts';
import { createPersistentExportProgressReporter } from './persistent-export-progress.ts';
import {
	admitAudioExportDelivery,
	type AudioExportAdmission,
} from './audio-export-delivery-admission.ts';
import { renderAndEncodeAudioExport, type ExportRenderSources } from './audio-export-render-orchestration.ts';
import { createRealtimeEncodedAudioExport } from './audio-realtime-encoded-export.ts';
import { directPcmContainerLabel, prepareDirectPcmExportDestination } from './direct-export-dispatch.ts';
import {
	commitDirectCompressedDestination, directCompressedStagingTemporaryBytes,
	prepareDirectCompressedDestination, type DirectCompressedDestination,
} from './direct-compressed-export.ts';
import { commitDirectPcmDestination, type DirectPcmDestination } from './direct-pcm-export.ts';
import { commitPreparedDirectStemArchiveDestination, directStemArchiveTemporaryBytes, prepareDirectStemArchiveDestination, streamDirectStemArchive } from './direct-stem-archive-export.ts';
import { createEditorVideoExportAction } from './video-export-service.ts';
import { createExportSnapshotRenderer } from './export-snapshot-renderer.ts';
import { streamStemArchiveExport } from './streaming-stem-archive-export.ts';
import { assertDesktopAudioExportCapability } from './desktop-audio-export-capability.ts';
import { createDeliveryReportForPlan } from '../delivery-conversion-inventory.ts';
import {
	assertDeliveryConformance,
	type DeliveryConformanceFinding,
} from '../delivery-conformance.ts';
import {
	conformDeliveredExport,
	conformedDeliveryReport,
} from './delivery-conformance-action.ts';
import {
	assertExactPersistentExportPlan,
	canonicalPersistentJsonRecord,
	exactPersistentAudioDeliveryExecution,
} from './persistent-audio-delivery-execution.ts';
export interface ExportServiceRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}
type RuntimeValue = ExportServiceRuntime[string];

const NO_TASK_PROGRESS = Object.freeze({
	setPhase: () => false,
	finish: () => false,
});
const PERSISTENT_EXPORT_BUSY = Object.freeze({ busy: true as const });

export function createEditorExportService(runtime: ExportServiceRuntime) {
	let audioExportPreparing = false;
	let exportOwner: 'direct' | 'persistent' | null = null;
	const persistentProgressReporter = createPersistentExportProgressReporter();
	const reportPersistentProgress = persistentProgressReporter.report;
	const {
		abortError, applyMediaChannelMapping, audioBufferChannels,
		copy, createAiffStreamEncoder, createCacheAwareRenderEngine, createExportPlan,
		createStableId, createStreamingStemArchive, createStreamingWindowedSincResampler, createTemporaryFileSink,
		createWavStreamEncoder, encodeAiff, encodeWav,
		ffmpeg, fileService,
		handleError, lifetime,
		normalizeProjectSampleRate, options, preflightStorage, prepareCommittedTimePitchCaches, productName,
		projectGeneration, publishDocumentSnapshot,
		resampleBuffer, setStatus, sourceBuffers, sourceChunkProviders, state,
		stemProject, store, throwIfAborted, toggleExport,
		updateExportProgress, taskProgress, verifyProjectFallbackIntegrity,
	} = runtime;
	const persistentIdleWaiters = new Set<() => void>();
	const persistentAudioDeliveryAvailable = () => !audioExportPreparing && exportOwner === null;
	const releaseExportOwner = (owner: 'direct' | 'persistent') => {
		if (exportOwner !== owner) return;
		exportOwner = null;
		for (const resolve of persistentIdleWaiters) resolve();
		persistentIdleWaiters.clear();
	};
	const whenPersistentAudioDeliveryAvailable = () => persistentAudioDeliveryAvailable()
		? Promise.resolve()
		: new Promise<void>((resolve) => { persistentIdleWaiters.add(resolve); });
	const reportExportProgress = (value: RuntimeValue) => {
		updateExportProgress(value);
		reportPersistentProgress(value);
	};
	const suppliedExportSnapshotRenderer = runtime.exportSnapshotRenderer;
	const { renderSnapshot, withRenderProgress } = suppliedExportSnapshotRenderer
		?? createExportSnapshotRenderer({
			options, sourceBuffers, taskProgress,
			createCacheAwareRenderEngine, prepareCommittedTimePitchCaches,
			throwIfAborted, updateExportProgress: reportExportProgress,
		});
	if (typeof runtime.setPersistentExportProgressObserver === 'function') {
		runtime.setPersistentExportProgressObserver(reportPersistentProgress);
	} else suppliedExportSnapshotRenderer?.observeExportProgress?.(reportPersistentProgress);
	const exportVideo = createEditorVideoExportAction(runtime, renderSnapshot);
	const renderRealtimeEncoded = createRealtimeEncodedAudioExport({
		applyMediaChannelMapping, copy, createAiffStreamEncoder, createCacheAwareRenderEngine,
		createStableId, createStreamingWindowedSincResampler, createTemporaryFileSink,
		createWavStreamEncoder, ffmpeg, normalizeProjectSampleRate,
		prepareCommittedTimePitchCaches, setStatus, throwIfAborted, withRenderProgress,
	});
	async function handleExportAction(
		action: RuntimeValue,
		requestedSettings: RuntimeValue = null,
		expectedPersistentExportPlan: RuntimeValue = null,
		executionOwner: 'direct' | 'persistent' = 'direct',
	) {
		if (action === 'cancel') {
			if (exportOwner !== null && exportOwner !== executionOwner) return;
			state.exportGeneration += 1;
			state.exportAbort?.abort();
			state.exportAbort = null;
			toggleExport(false);
			publishDocumentSnapshot();
			return;
		}
		if (isVideoExportRequestFormat(requestedSettings?.format)) {
			return exportVideo(requestedSettings);
		}
		if (state.exportAbort || audioExportPreparing || exportOwner !== null) {
			return executionOwner === 'persistent' ? PERSISTENT_EXPORT_BUSY : undefined;
		}
		const preparationGeneration = state.exportGeneration;
		audioExportPreparing = true;
		exportOwner = executionOwner;
		try {
			if (typeof runtime.prepareProjectForExport === 'function') {
				await runtime.prepareProjectForExport('audio-export');
			}
		} catch (error) {
			releaseExportOwner(executionOwner);
			throw error;
		} finally {
			audioExportPreparing = false;
		}
		if (state.exportAbort || state.exportGeneration !== preparationGeneration || state.disposed) {
			releaseExportOwner(executionOwner);
			return;
		}
		let admission: AudioExportAdmission;
		try {
			admission = admitAudioExportDelivery(runtime, requestedSettings);
		} catch (error) {
			handleError(error);
			releaseExportOwner(executionOwner);
			return;
		}
		const { canonicalProject, delivery, deliveredProject, settings } = admission;
		if (!admission.hasMaterial) { releaseExportOwner(executionOwner); return; }
		if (admission.localSourcesMissing) {
			releaseExportOwner(executionOwner);
			throw new Error(copy.localSourcesMissing);
		}
		const generation = ++state.exportGeneration;
		const projectToken = projectGeneration.capture(canonicalProject.id);
		const exportTask = lifetime.startTask('export');
		const abort = Object.freeze({ signal: exportTask.signal, abort: () => lifetime.cancelTask('export') });
		const assertExportCurrent = () => {
			throwIfAborted(abort.signal);
			exportTask.assertCurrent();
			projectGeneration.assertCurrent(projectToken);
			if (generation !== state.exportGeneration || state.disposed) throw abortError();
		};
		state.exportAbort = abort;
		toggleExport(true);
		const progressTask = taskProgress?.begin?.('export', copy.rendering, 0) || NO_TASK_PROGRESS;
		let exportProject = createExportRenderProject(deliveredProject);
		let exportRenderSources: ExportRenderSources;
		let pendingCleanup = null;
		let pendingDirectDestination: DirectPcmDestination | DirectCompressedDestination | null = null;
		let directStemArchive = false;
		let directCompressed = false;
		const browserMaximumOutputBytes = requestedSettings && typeof requestedSettings === 'object'
			? requestedSettings.maximumOutputBytes
			: undefined;
		try {
			const fallbackProvider = await admitAudioRenderedFallbackExport(canonicalProject, delivery, {
				store, verifyProjectFallbackIntegrity,
			}, { signal: abort.signal, assertCurrent: assertExportCurrent });
			exportRenderSources = fallbackProvider && delivery.audioRenderedFallback
				? audioRenderedFallbackRenderSources(delivery.audioRenderedFallback, fallbackProvider, {
					sourceBuffers,
					sourceChunkProviders: sourceChunkProviders ?? new Map(),
				})
				: Object.freeze({
					sourceMap: new Map(sourceBuffers),
					chunkSources: null,
					prepareTimePitchCaches: true,
				});
			const plan = createExportPlan(exportProject, {
				...settings,
				inputChannelCount: exportProject.masterChannels,
				mobile: state.mobile,
				livePcmBytes: undefined,
				productName,
			});
			if (expectedPersistentExportPlan !== null) {
				assertExactPersistentExportPlan(plan, expectedPersistentExportPlan);
			}
			await assertDesktopAudioExportCapability(ffmpeg, plan);
			if (typeof ffmpeg.preflightEncodeFile === 'function') {
				await ffmpeg.preflightEncodeFile(plan.format, {
					...plan.encoding,
					frameCount: plan.outputFrames,
					metadata: plan.metadata,
					maximumOutputBytes: browserMaximumOutputBytes,
					signal: abort.signal,
				});
			}
			// Derived from the plan this delivery is about to execute, so the report
			// describes the render that actually happens rather than the settings
			// that were asked for. It is session state, never project state: a
			// report describes a delivery and must not join the document it describes.
			// Not published yet: everything between here and the render can still end
			// the delivery without producing anything — a dismissed save dialog most of
			// all — and publishing then would open the report surface on a delivery that
			// never ran, over the report of the last one that did.
			const plannedReport = createDeliveryReportForPlan(plan, {
				sampleRate: exportProject.sampleRate,
			});
			if (plan.format === 'bw64' && plan.adm) {
				exportProject = inheritTrackFolderMediaStateProjectionV12(
					exportProject,
					createBw64RenderProject(exportProject, {
						channelCount: plan.channelCount,
						metadata: plan.adm.metadata,
					}),
				);
			}
			const directStemTemporaryBytes = directStemArchiveTemporaryBytes(plan);
			const directCompressedTemporaryBytes = directCompressedStagingTemporaryBytes(plan);
			const stemPreparation = await prepareDirectStemArchiveDestination(
				fileService, plan,
				requestedSettings && typeof requestedSettings === 'object' ? requestedSettings : null,
				abort.signal,
			);
			if (stemPreparation.cancelled) return stemPreparation.cancelled;
			pendingDirectDestination = stemPreparation.destination;
			directStemArchive = Boolean(pendingDirectDestination);
			if (!pendingDirectDestination) {
				const compressedPreparation = await prepareDirectCompressedDestination(
					fileService, plan,
					requestedSettings && typeof requestedSettings === 'object' ? requestedSettings : null,
					abort.signal,
				);
				if (compressedPreparation.cancelled) return compressedPreparation.cancelled;
				pendingDirectDestination = compressedPreparation.destination;
				directCompressed = Boolean(pendingDirectDestination);
			}
			if (!pendingDirectDestination) {
				const directPreparation = await prepareDirectPcmExportDestination(
					fileService, plan,
					requestedSettings && typeof requestedSettings === 'object' ? requestedSettings : null,
					abort.signal,
				);
				if (directPreparation.cancelled) return directPreparation.cancelled;
				pendingDirectDestination = directPreparation.destination;
			}
			if (directStemArchive) {
				if (directStemTemporaryBytes === null) throw new Error('The direct stem archive plan changed before rendering.');
				await preflightStorage(directStemTemporaryBytes, 'export');
			} else if (!pendingDirectDestination || directCompressed) {
				await preflightStorage(
					directCompressed
						? Math.max(plan.requiredTemporaryBytes ?? 0, directCompressedTemporaryBytes ?? 0)
						: plan.requiredTemporaryBytes ?? plan.outputBytesPerRender * Math.max(1, plan.outputs.length),
					'export',
				);
			}
			// The delivery is committed to rendering: from here a failure has
			// something to describe, so the report becomes the session's.
			state.deliveryReport = plannedReport;
			setStatus(copy.rendering);
			let blob: Blob | null = null;
			let fileName;
			let outputCleanup = null;
			let directOutput = null;
			let stemConformance: readonly DeliveryConformanceFinding[] = [];
			if (plan.mode === 'mix') {
				const encoded = await renderAndEncode(
					exportProject, plan, settings, abort.signal, exportRenderSources,
					plan.outputs[0],
					{ start: 0, end: 1 },
					directCompressed ? null : pendingDirectDestination as DirectPcmDestination | null,
					directCompressed ? pendingDirectDestination as DirectCompressedDestination : null,
					assertExportCurrent,
				);
				// Registered the moment the render has staged something, because
				// everything between here and publication can throw: conformance can
				// fail the delivery, and a cancel can land during the reopen. Anything
				// registered after those would leave the staging file — up to the full
				// size of the export — stranded in origin storage with no owner.
				if (!encoded.directDestination) {
					outputCleanup = encoded.cleanup || null;
					pendingCleanup = outputCleanup;
				}
				// Conformance runs on every delivery, from the bytes that delivery
				// produced, before anything is published — it is not a verification
				// mode somebody has to remember to run.
				const conformance = await conformPersistentExport(plan, encoded);
				assertExportCurrent();
				state.deliveryReport = conformedDeliveryReport({
					plan, sampleRate: exportProject.sampleRate, conformance,
					loudness: encoded.loudnessNormalization,
					deliveredLoudness: encoded.deliveredLoudness,
				}) ?? state.deliveryReport;
				// The report is published first, so a delivery that failed its own
				// conformance can still say why.
				assertDeliveryConformance(conformance);
				if (encoded.directDestination) directOutput = encoded;
				else blob = prepareBrowserExportBlob(encoded, 'Audio export', browserMaximumOutputBytes);
				fileName = plan.outputs[0].fileName;
			} else if (directStemArchive) {
				if (!plan.archive) throw new Error('The stem export plan has no archive descriptor.');
				const findings: DeliveryConformanceFinding[] = [];
				directOutput = await streamDirectStemArchive({
					destination: pendingDirectDestination as DirectPcmDestination, plan, signal: abort.signal,
					assertCurrent: assertExportCurrent,
					async renderStem(output, index) {
						const renderOutput = plan.outputs[index];
						if (!renderOutput || renderOutput.trackId !== output.trackId) {
							throw new Error('The direct stem archive output changed before rendering.');
						}
						const snapshot = stemProject(exportProject, renderOutput.trackId);
						const encoded = await renderAndEncode(
							snapshot, plan, settings, abort.signal, exportRenderSources, renderOutput, {
								start: index / plan.outputs.length,
								end: (index + 1) / plan.outputs.length,
							}, null, null, assertExportCurrent,
						);
						// Only the archive container streams: each stem still reaches it
						// as readable bytes, so it is conformed from its own bytes just
						// as the browser stem route conforms it. Reporting the delivery
						// as unverified here would let a stem that fails conformance on
						// the download route publish silently through Save As.
						findings.push(...await conformPersistentExport(
							plan, encoded, index / plan.outputs.length, (index + 1) / plan.outputs.length,
						));
						return encoded;
					},
						onStemComplete(progress) { reportExportProgress(progress); },
				});
				stemConformance = Object.freeze(findings);
				fileName = plan.archive.fileName;
			} else {
				const archived = await streamStemArchiveExport({
					abortSignal: abort.signal,
					admitOutputBytes: browserMaximumOutputBytes,
					conformExport: conformPersistentExport,
					copy,
					createStreamingStemArchive,
					exportProject,
					exportRenderSources,
					plan,
					renderAndEncode,
					reportProgress: reportExportProgress,
					settings,
					stemProject,
					throwIfAborted,
				});
				stemConformance = archived.conformance;
				outputCleanup = archived.cleanup;
				pendingCleanup = outputCleanup;
				blob = archived.blob;
				fileName = archived.fileName;
			}
			if (stemConformance.length > 0) {
				// Same rule the mix branch follows: the report is rebuilt with what the
				// delivery found, and published before the failure is thrown.
				state.deliveryReport = conformedDeliveryReport({
					plan, sampleRate: exportProject.sampleRate, conformance: stemConformance,
				}) ?? state.deliveryReport;
				assertDeliveryConformance(stemConformance);
			}
			assertExportCurrent();
			if (directOutput) {
				await clearPreviousExportOutput();
				const published = directStemArchive
					? await commitPreparedDirectStemArchiveDestination(
						pendingDirectDestination as DirectPcmDestination, plan, directOutput.byteLength, assertExportCurrent,
					)
					: directCompressed
						? await commitDirectCompressedDestination(
							pendingDirectDestination as DirectCompressedDestination, plan, directOutput.byteLength, assertExportCurrent,
						)
					: await commitDirectPcmDestination(
						pendingDirectDestination as DirectPcmDestination, plan.outputFileBytesPerRender, directOutput.byteLength,
						assertExportCurrent, directPcmContainerLabel(plan.format),
					);
				pendingDirectDestination = null;
				const result = Object.freeze({
					url: null,
					fileName: published.fileName || fileName,
					mimeType: directOutput.mimeType,
					size: published.size,
					method: published.method,
				});
				try { assertExportCurrent(); } catch { return result; }
				state.exportOutput = result;
				setStatus(copy.done, 'success');
				publishDocumentSnapshot();
				return result;
			}
			blob = admitBrowserExportBlob(blob, 'Audio export', browserMaximumOutputBytes);
			await clearPreviousExportOutput();
			const published = await fileService.createDownload({
				purpose: 'audio',
				suggestedName: fileName,
				mimeType: blob.type || 'application/octet-stream',
				blob,
			});
			if (abort.signal.aborted || generation !== state.exportGeneration || state.disposed) {
				await published.cleanup?.();
				await outputCleanup?.();
				pendingCleanup = null;
				throw abortError();
			}
			if (published.cancelled) {
				await outputCleanup?.();
				pendingCleanup = null;
				return published;
			}
			state.outputCleanup = async () => {
				await published.cleanup?.();
				await outputCleanup?.();
			};
			pendingCleanup = null;
			state.outputUrl = published.url || null;
			state.exportOutput = Object.freeze({
				url: state.outputUrl,
				fileName: published.fileName || fileName,
				mimeType: blob.type || 'application/octet-stream',
				size: blob.size,
				method: published.method,
			});
			setStatus(copy.done, 'success');
			publishDocumentSnapshot();
			return state.exportOutput;
		} catch (caughtError) {
			let error = caughtError;
			if (pendingDirectDestination) {
				try {
					await pendingDirectDestination.abort(error);
				} catch (cleanupError) {
					error = new AggregateError(
						[error, cleanupError],
						'The streamed audio export and destination cleanup both failed.',
					);
				}
			}
			await pendingCleanup?.().catch(() => undefined);
			if ((error as Readonly<{ name?: string }>)?.name !== 'AbortError') handleError(error);
		} finally {
			if (generation === state.exportGeneration) {
				state.exportAbort = null;
				toggleExport(false);
			}
			progressTask.finish();
			exportTask.finish();
			releaseExportOwner(executionOwner);
		}
	}

	async function clearPreviousExportOutput() {
		if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
		await state.outputCleanup?.();
		state.outputUrl = null;
		state.outputCleanup = null;
		state.exportOutput = null;
	}

	async function derivePersistentAudioDeliveryPlan(requestedSettings: RuntimeValue = {}) {
		if (isVideoExportRequestFormat(requestedSettings?.format)) {
			throw new TypeError('Persistent audio delivery does not accept a video export plan.');
		}
		const admission = admitAudioExportDelivery(runtime, requestedSettings);
		if (!admission.hasMaterial) throw new Error('Persistent delivery requires audible project material.');
		if (admission.localSourcesMissing) throw new Error(copy.localSourcesMissing);
		const { settings } = admission;
		const exportProject = createExportRenderProject(admission.deliveredProject);
		const exportPlan = createExportPlan(exportProject, {
			...settings,
			inputChannelCount: exportProject.masterChannels,
			mobile: state.mobile,
			livePcmBytes: undefined,
			productName,
		});
		await assertDesktopAudioExportCapability(ffmpeg, exportPlan);
		return Object.freeze({
			settings: canonicalPersistentJsonRecord(settings, 'normalized persistent export settings'),
			exportPlan: canonicalPersistentJsonRecord(exportPlan, 'exact persistent export plan'),
		});
	}

	async function executePersistentAudioDeliveryPlan(value: RuntimeValue) {
		const request = exactPersistentAudioDeliveryExecution(value);
		if (state.exportAbort || audioExportPreparing || exportOwner !== null) return PERSISTENT_EXPORT_BUSY;
		const progress = request.onProgress ?? null;
		persistentProgressReporter.observe(progress);
		try {
			return await handleExportAction(
				'start', { ...request.settings, saveTarget: request.destination }, request.exportPlan, 'persistent',
			);
		} finally { persistentProgressReporter.release(progress); }
	}
	const cancelPersistentAudioDelivery = () => handleExportAction('cancel', null, null, 'persistent');
	async function conformPersistentExport(
		plan: RuntimeValue, encoded: RuntimeValue, start = 0, end = 1,
	): Promise<readonly DeliveryConformanceFinding[]> {
		reportPersistentProgress(start + (end - start) * 0.92);
		const findings = await conformDeliveredExport(plan, encoded);
		reportPersistentProgress(start + (end - start) * 0.98);
		return findings;
	}

	async function renderAndEncode(
		snapshot: RuntimeValue, plan: RuntimeValue, settings: RuntimeValue, signal: RuntimeValue,
		renderSources: ExportRenderSources,
		renderTarget: RuntimeValue,
		progressRange: RuntimeValue = { start: 0, end: 1 },
		directDestination: DirectPcmDestination | null = null,
		directCompressedDestination: DirectCompressedDestination | null = null,
		assertDirectCurrent: () => void = () => undefined,
	): Promise<RuntimeValue> {
		return renderAndEncodeAudioExport({
			encodingRuntime: {
				applyMediaChannelMapping, audioBufferChannels, copy,
				createAiffStreamEncoder, createWavStreamEncoder, encodeAiff, encodeWav,
				ffmpeg, resampleBuffer, setStatus, throwIfAborted,
			},
			normalizeProjectSampleRate,
			renderRealtimeEncoded,
			renderSnapshot,
			taskProgress,
		}, {
			assertDirectCurrent,
			directCompressedDestination,
			directDestination,
			plan,
			progressRange,
			renderSources,
			renderTarget,
			settings,
			signal,
			snapshot,
		});
	}


	return Object.freeze({
		derivePersistentAudioDeliveryPlan,
		executePersistentAudioDeliveryPlan,
		cancelPersistentAudioDelivery,
		persistentAudioDeliveryAvailable,
		whenPersistentAudioDeliveryAvailable,
		exportVideo,
		handleExportAction,
		renderSnapshot,
	});
}
