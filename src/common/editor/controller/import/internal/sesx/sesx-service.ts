/* SPDX-License-Identifier: AGPL-3.0-only */

import { setLocalizedStatus } from '../../../../../i18n/presentation-message.ts';
import { desktopReadCapabilityIdFor } from '../../../../desktop-read-capability-registry.ts';
import { SESX_XML_MAXIMUM_BYTES } from '../../../../sesx-format.ts';
import { sesxAudioReferences, parseSesxDocument, type SesxAudioReference } from '../../../../sesx-import.ts';
import { buildSesxProject, type SesxDecodedMediaInfo } from '../../../../sesx-import-project.ts';
import { dawprojectImportedAudioMimeType } from '../../../../dawproject-import-project.ts';
import { createCurrentAudioEditorProject } from '../../../../project-current.ts';
import { AUDIO_EDITOR_PCM_CHUNK_FRAMES } from '../../../../pcm-chunks.js';
import { inspectWavBlobPcm } from '../../../../wav-import.js';
import { createWavBlobPcmChunkReader, type WavBlobPcmChunkReader, type WavPcmDescriptor } from '../../../../wav-pcm-chunk-reader.ts';
import { stageDawprojectCompressedSource } from '../dawproject/dawproject-import-compressed.ts';
import type { PreparedStreamedAudioImport } from '../../../../browser-streamed-audio-import.ts';
import type { DawprojectServiceHelpers } from '../dawproject/dawproject-service.ts';
import type {
	NativeProjectAudioSource, NativeProjectDocument, NativeProjectFile,
	NativeProjectFileService, NativeProjectServiceRuntime, NativeSesxReadDescriptor,
} from '../../../document/native-project-types.ts';

export type SesxServiceHelpers = Pick<DawprojectServiceHelpers,
	'beginProjectTask' | 'assertOwnership' | 'beginImport' | 'finishImport'
	| 'persistSourceChunks' | 'updateNativeProjectProgress' | 'requireProject'>;

export interface SesxOpenResult extends Readonly<Record<string, unknown>> {
	readonly project: NativeProjectDocument;
	readonly report: unknown;
}

const SESX_COMPRESSED_MAXIMUM_BYTES = 192 * 1024 * 1024;

/** Desktop-only SESX open with a session-scoped media capability and staged PCM. */
export function createSesxService(runtime: NativeProjectServiceRuntime, helpers: SesxServiceHelpers) {
	return Object.freeze({ openSesx });

	async function openSesx(file: NativeProjectFile): Promise<SesxOpenResult | undefined> {
		if (!file || !/\.sesx$/iu.test(String(file.name || ''))) {
			throw new TypeError('Choose an Adobe Audition session (.sesx).');
		}
		const files = runtime.fileService;
		if (!files.isDesktop) throw new Error('Adobe Audition SESX import requires the desktop app.');
		const sessionReadId = desktopReadCapabilityIdFor(file);
		if (!sessionReadId) throw new Error('Open the SESX session through desktop File > Open to grant media access.');
		try {
			const resolveMedia = files.resolveSesxMedia;
			const chooseFolder = files.chooseSesxMediaFolder;
			const withRead = files.withReadDescriptors;
			if (!resolveMedia || !chooseFolder || !withRead || !files.releaseSesxSession) {
				throw new Error('Desktop SESX media access is unavailable.');
			}
			if (runtime.editingBlocked()) return undefined;
			if (file.size > SESX_XML_MAXIMUM_BYTES) throw new RangeError('The SESX session exceeds the 32 MiB XML limit.');
			const operation = helpers.beginProjectTask('native-project-open');
			const signal = operation.task.signal;
			const assertReady = (): void => { helpers.assertOwnership(operation.task, operation.projectToken); };
			const persistedSourceIds: string[] = [];
			let importedProject: NativeProjectDocument | null = null;
			let activated = false;
			helpers.beginImport(operation.task);
			setLocalizedStatus(runtime.setStatus, runtime.copy, 'importing');
			try {
				const document = parseSesxDocument(await file.text());
				assertReady();
				const references = sesxAudioReferences(document);
				const media = new Map<string, SesxDecodedMediaInfo | null>();
				const resolutionIssues = new Map<string, 'ambiguous' | 'scan-limited'>();
				const stagedSourceIds = new Map<string, string>();
				await resolveReferences(sessionReadId, references, resolveMedia, chooseFolder, assertReady,
					async (reference, descriptor, index) => {
					await withRead([descriptor], { signal }, async (blobs) => {
						const blob = blobs[0];
						if (!blob) throw new Error(`SESX media ${reference.name} was not opened.`);
						const wav = await inspectPcmWav(blob, signal);
						let prepared: PreparedStreamedAudioImport | null = null;
						try {
							if (!wav && runtime.prepareDawprojectAudio) {
								if (blob.size > SESX_COMPRESSED_MAXIMUM_BYTES) {
									throw new RangeError(`SESX media ${reference.name} exceeds the compressed import memory budget.`);
								}
								try { prepared = await runtime.prepareDawprojectAudio(blob, reference.name, signal); }
								catch (error) {
									if (error instanceof RangeError) throw error;
									assertReady();
								}
							}
							assertReady();
							if (!wav && !prepared) { media.set(reference.id, null); return; }
							const info = wav ?? prepared!.descriptor;
							if (info.channelCount !== 1 && info.channelCount !== 2) {
								media.set(reference.id, info);
								return;
							}
							if (info.sampleRate !== document.sampleRate) { media.set(reference.id, info); return; }
							const sourceBytes = info.frameCount * info.channelCount * Float32Array.BYTES_PER_ELEMENT;
							if (!Number.isSafeInteger(sourceBytes)) throw new RangeError(`SESX media ${reference.name} is too large.`);
							await runtime.preflightStorage(sourceBytes, 'import');
							assertReady();
							const sourceId = runtime.createStableId('source');
							const staged = stagedProjectSource(sourceId, reference.name, info);
							const chunkFrames = Math.min(runtime.sourceChunkFrames, AUDIO_EDITOR_PCM_CHUNK_FRAMES);
							if (wav) {
								const reader = createWavBlobPcmChunkReader(blob, { descriptor: wav, chunkFrames });
								await helpers.persistSourceChunks(staged, sourceId,
									readWavChunks(reader, signal), persistedSourceIds, operation);
							} else if (!await stageDawprojectCompressedSource(runtime.store, prepared!,
								staged.sources[0] as NativeProjectAudioSource, chunkFrames, signal,
								assertReady, persistedSourceIds, 'SESX')) {
								media.set(reference.id, null);
								return;
							}
							assertReady();
							media.set(reference.id, info);
							stagedSourceIds.set(reference.id, sourceId);
						} finally { prepared?.dispose(); }
					});
					assertReady();
					helpers.updateNativeProjectProgress(
						{ value: (index + 1) / references.length }, runtime.copy.importing,
						operation.task, operation.projectToken, undefined, { key: 'importing' },
					);
				}, (reference, status) => {
					if (status === 'ambiguous' || status === 'scan-limited') resolutionIssues.set(reference.id, status);
				});
				const plan = buildSesxProject(document, {
					fileName: String(file.name), media, resolutionIssues, stagedSourceIds, createStableId: runtime.createStableId,
				});
				const created = createCurrentAudioEditorProject(plan.project as never);
				importedProject = runtime.adaptAudacityProject
					? await runtime.adaptAudacityProject(created)
					: runtime.loadProject(created).project;
				assertReady();
				const retainedIds = new Set(plan.media.map((binding) => binding.sourceId));
				for (const sourceId of persistedSourceIds) {
					if (!retainedIds.has(sourceId)) await Promise.resolve(runtime.store.deleteSource(sourceId));
				}
				await runtime.switchProject(importedProject, { readOnly: false, save: true });
				activated = true;
				operation.task.assertCurrent();
				runtime.projectGeneration.capture(importedProject.id);
				runtime.state.deliveryReport = plan.report;
				setLocalizedStatus(runtime.setStatus, runtime.copy, 'sesxOpened', undefined, 'success', { fallback: 'Adobe Audition session imported.' });
				runtime.publishDocumentSnapshot();
				return Object.freeze({ project: importedProject, report: plan.report });
			} catch (error) {
				const current = importedProject !== null && runtime.getProject()?.id === importedProject.id;
				if (!activated && !current) {
					for (const sourceId of persistedSourceIds) {
						await Promise.resolve(runtime.store.deleteSource(sourceId)).catch(() => undefined);
					}
				}
				throw error;
			} finally {
				helpers.finishImport(operation.task);
				operation.task.finish();
			}
		} finally {
			await files.releaseSesxSession?.(sessionReadId);
		}
	}
}

async function resolveReferences(
	sessionReadId: string,
	references: readonly SesxAudioReference[],
	resolve: NonNullable<NativeProjectFileService['resolveSesxMedia']>,
	choose: NonNullable<NativeProjectFileService['chooseSesxMediaFolder']>,
	assertReady: () => void,
	consume: (reference: SesxAudioReference, descriptor: NativeSesxReadDescriptor, index: number) => Promise<void>,
	reportUnresolved: (reference: SesxAudioReference, status: 'missing' | 'ambiguous' | 'scan-limited') => void,
): Promise<void> {
	const unresolved: Array<Readonly<{ reference: SesxAudioReference; path: string; index: number }>> = [];
	for (const [index, reference] of references.entries()) {
		const path = mediaLookupPath(reference);
		if (!path) continue;
		const result = await resolve({ sessionReadId, relativePath: path });
		if (result.status === 'found') await consume(reference, result.descriptor, index);
		else {
			unresolved.push({ reference, path, index });
			reportUnresolved(reference, result.status);
		}
		assertReady();
	}
	if (unresolved.length) {
		const folder = await choose({ sessionReadId });
		assertReady();
		if (folder.status === 'selected') {
			for (const { reference, path, index } of unresolved) {
				const result = await resolve({
					sessionReadId, relativePath: path, mediaRootId: folder.mediaRootId,
				});
				if (result.status === 'found') await consume(reference, result.descriptor, index);
				else reportUnresolved(reference, result.status);
				assertReady();
			}
		}
	}
}

function mediaLookupPath(reference: SesxAudioReference): string | null {
	const relative = reference.relativePath?.replaceAll('\\', '/');
	const parts = relative?.split('/') ?? [];
	if (relative && relative.length <= 4096 && parts.length <= 32 && !relative.startsWith('/')
		&& !/^[a-z][a-z\d+.-]*:/iu.test(relative)
		&& parts.every((part) => part && part.length <= 255 && part !== '.' && part !== '..'
			&& !hasControlCharacter(part))) return relative;
	const name = reference.name;
	return name && name.length <= 255 && name !== '.' && name !== '..'
		&& !/[\\/:]/u.test(name) && !hasControlCharacter(name) ? name : null;
}

function hasControlCharacter(value: string): boolean {
	return Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

async function inspectPcmWav(blob: Blob, signal: AbortSignal): Promise<WavPcmDescriptor | null> {
	const signature = String.fromCharCode(...new Uint8Array(await blob.slice(0, 4).arrayBuffer()));
	if (!['RIFF', 'RF64', 'BW64'].includes(signature)) return null;
	try { return await inspectWavBlobPcm(blob, { signal }) as WavPcmDescriptor; }
	catch (error) { if (signal.aborted) throw error; return null; }
}

function stagedProjectSource(id: string, name: string, info: SesxDecodedMediaInfo): NativeProjectDocument {
	return {
		id: `staging-${id}`, title: 'SESX staging', schemaVersion: 17,
		sources: [{ kind: 'audio', id, storageKey: id, name, mimeType: dawprojectImportedAudioMimeType(name),
			frameCount: info.frameCount, channelCount: info.channelCount, sampleRate: info.sampleRate }],
		clips: [],
	};
}

async function* readWavChunks(reader: WavBlobPcmChunkReader, signal: AbortSignal): AsyncGenerator<readonly Float32Array[]> {
	for (let index = 0; index < reader.chunkCount; index += 1) {
		signal.throwIfAborted();
		yield (await reader.readChunk(index, { signal })).channels;
	}
}
