/* SPDX-License-Identifier: AGPL-3.0-only */

import { readDawprojectArchive, type DawprojectArchive } from '../dawproject-archive.ts';
import { writeDawprojectArchive } from '../dawproject-archive.ts';
import { createDawprojectExport } from '../dawproject-export.ts';
import {
	DAWPROJECT_FILE_EXTENSION,
	DAWPROJECT_MIME_TYPE,
	entryBaseName,
	isDawprojectFileName,
} from '../dawproject-format.ts';
import { dawprojectMediaReferences, parseDawprojectDocument } from '../dawproject-import.ts';
import { buildDawprojectProject, type DawprojectDecodedMediaInfo } from '../dawproject-import-project.ts';
import { createCurrentAudioEditorProject } from '../project-current.ts';
import { encodeWav } from '../wav.js';
import { decodeDawprojectAudioEntry } from './dawproject-audio-decode.ts';
import { resolveDeliveredProject } from './interchange-export-action.ts';
import type { EditorProjectToken, EditorTaskScope } from './lifecycle.ts';
import type {
	Aup4DecodedSource,
	NativeProgress,
	NativeProjectAudioSource,
	NativeProjectDocument,
	NativeProjectFile,
	NativeProjectServiceRuntime,
	NativeSavedFile,
} from './native-project-types.ts';

/**
 * DAWproject open and export, composed into the native project service.
 *
 * Open follows the Audacity path exactly: read and decode everything first,
 * build the document, persist the sources, then switch — so a failure at any
 * step leaves the previous project untouched and no orphaned PCM behind.
 * Export follows the interchange path: the report is published before the
 * save dialog, so a cancelled save still leaves the omissions readable.
 *
 * The task-ownership helpers are the native service's own closures, handed in
 * rather than duplicated, because `state.importing` and the save-state flags
 * are shared UI state that must have exactly one owner.
 */

export interface DawprojectServiceOperation {
	readonly task: EditorTaskScope;
	readonly projectToken: EditorProjectToken;
}

export interface DawprojectServiceHelpers {
	beginProjectTask(name: string, expectedProjectId?: string): DawprojectServiceOperation;
	assertOwnership(task: EditorTaskScope, token: EditorProjectToken): void;
	beginImport(task: EditorTaskScope): void;
	finishImport(task: EditorTaskScope): void;
	persistDecodedSource(
		project: NativeProjectDocument,
		sourceAudio: Aup4DecodedSource,
		persistedSourceIds: string[],
		operation: DawprojectServiceOperation,
	): Promise<void>;
	updateNativeProjectProgress(
		progress: NativeProgress,
		prefix: string,
		task?: EditorTaskScope,
		projectToken?: EditorProjectToken,
	): void;
	requireProject(): NativeProjectDocument;
}

export interface SaveDawprojectOptions {
	readonly fileName?: string;
}

export interface DawprojectOpenResult extends Readonly<Record<string, unknown>> {
	readonly project: NativeProjectDocument;
	readonly report: unknown;
}

interface DecodedEntry {
	readonly info: DawprojectDecodedMediaInfo;
	readonly channels: readonly Float32Array[];
}

export function createDawprojectService(runtime: NativeProjectServiceRuntime, helpers: DawprojectServiceHelpers) {
	return Object.freeze({ openDawproject, saveDawproject });

	async function openDawproject(file: NativeProjectFile): Promise<DawprojectOpenResult | undefined> {
		if (!file || !isDawprojectFileName(String(file.name || ''))) {
			throw new TypeError(runtime.copy.chooseDawprojectFile ?? 'Choose a DAWproject file (.dawproject).');
		}
		if (runtime.editingBlocked()) return undefined;
		const operation = helpers.beginProjectTask('native-project-open');
		const signal = operation.task.signal;
		const assertReady = (): void => { helpers.assertOwnership(operation.task, operation.projectToken); };
		const persistedSourceIds: string[] = [];
		let importedProject: NativeProjectDocument | null = null;
		let activated = false;
		let archive: DawprojectArchive | null = null;
		helpers.beginImport(operation.task);
		runtime.setStatus(runtime.copy.importing);
		try {
			archive = await readDawprojectArchive(file, { signal });
			assertReady();
			const document = parseDawprojectDocument(archive.projectXml, archive.metadataXml);
			const references = dawprojectMediaReferences(document)
				.filter((reference) => reference.kind === 'audio' && !reference.external);
			const decoded = new Map<string, DecodedEntry>();
			const media = new Map<string, DawprojectDecodedMediaInfo | null>();
			let decodedBytes = 0;
			for (const [index, reference] of references.entries()) {
				const blob = await archive.readEntry(reference.path);
				assertReady();
				if (!blob) continue;
				const audio = await decodeDawprojectAudioEntry(blob, entryBaseName(reference.path), {
					decodeAudioFile: runtime.decodeAudioFile ?? null, signal,
				});
				assertReady();
				if (!audio || audio.channels.length === 0) {
					media.set(reference.path, null);
					continue;
				}
				const frameCount = audio.channels[0]!.length;
				decodedBytes += frameCount * audio.channels.length * Float32Array.BYTES_PER_ELEMENT;
				const info = { frameCount, channelCount: audio.channels.length, sampleRate: audio.sampleRate };
				decoded.set(reference.path, { info, channels: audio.channels });
				media.set(reference.path, info);
				helpers.updateNativeProjectProgress(
					{ value: (index + 1) / references.length }, runtime.copy.importing, operation.task, operation.projectToken,
				);
			}
			await runtime.preflightStorage(decodedBytes, 'import');
			assertReady();
			const plan = buildDawprojectProject(document, {
				fileName: String(file.name), media, createStableId: runtime.createStableId,
			});
			const created = createCurrentAudioEditorProject(plan.project as never);
			importedProject = runtime.loadProject(created).project;
			for (const binding of plan.media) {
				const entry = decoded.get(binding.path);
				if (!entry) continue;
				await helpers.persistDecodedSource(
					importedProject, { sourceId: binding.sourceId, channels: entry.channels }, persistedSourceIds, operation,
				);
			}
			await runtime.switchProject(importedProject, { readOnly: false, save: true });
			activated = true;
			operation.task.assertCurrent();
			runtime.projectGeneration.capture(importedProject.id);
			runtime.state.deliveryReport = plan.report;
			runtime.setStatus(runtime.copy.dawprojectOpened ?? 'DAWproject imported.', 'success');
			runtime.publishDocumentSnapshot();
			return Object.freeze({ project: importedProject, report: plan.report });
		} catch (error) {
			const importedProjectIsCurrent = importedProject !== null && runtime.getProject()?.id === importedProject.id;
			if (!activated && !importedProjectIsCurrent) {
				for (const sourceId of persistedSourceIds) {
					await Promise.resolve(runtime.store.deleteSource(sourceId)).catch(() => undefined);
				}
			}
			throw error;
		} finally {
			await archive?.close().catch(() => undefined);
			helpers.finishImport(operation.task);
			operation.task.finish();
		}
	}

	async function saveDawproject(options: SaveDawprojectOptions = {}): Promise<NativeSavedFile & Readonly<{
		fileName: string;
		report: unknown;
	}>> {
		const snapshot = helpers.requireProject();
		if (runtime.hasMissingTimelineSources(snapshot, { audioOnly: true })) {
			throw new Error(runtime.copy.missingSourcesPreventSave);
		}
		const operation = helpers.beginProjectTask('dawproject-export', snapshot.id);
		const assertReady = (): void => { helpers.assertOwnership(operation.task, operation.projectToken); };
		const saving = runtime.copy.dawprojectSaving ?? 'Exporting DAWproject';
		try {
			runtime.setStatus(saving);
			const delivered = resolveDeliveredProject({
				getProject: () => snapshot, state: runtime.state as unknown as Record<string, unknown>,
			});
			if (!delivered) throw new Error(runtime.copy.projectNotFound);
			const embeddableVideoSourceIds = typeof runtime.store.loadMediaAsset === 'function'
				? snapshot.sources.filter((source) => source.kind === 'video').map((source) => source.id)
				: [];
			const exported = createDawprojectExport({
				project: delivered,
				title: snapshot.title,
				application: {
					name: runtime.product?.name ?? 'Soundscaper',
					version: runtime.applicationVersion ?? 'unknown',
				},
				embeddableVideoSourceIds,
			});
			// Publish before the save dialog: a cancelled save keeps the report.
			runtime.state.deliveryReport = exported.report;
			runtime.publishDocumentSnapshot();
			const files: { path: string; blob: Blob }[] = [];
			for (const [index, entry] of exported.media.entries()) {
				assertReady();
				const source = snapshot.sources.find((candidate) => candidate.id === entry.sourceId);
				if (!source) continue;
				files.push({ path: entry.path, blob: await mediaBlob(source, entry.kind) });
				assertReady();
				helpers.updateNativeProjectProgress(
					{ value: (index + 1) / exported.media.length }, saving, operation.task, operation.projectToken,
				);
			}
			const blob = await writeDawprojectArchive(
				{ projectXml: exported.projectXml, metadataXml: exported.metadataXml, files },
				{ signal: operation.task.signal },
			);
			assertReady();
			const saved = await runtime.fileService.saveFile({
				purpose: 'interchange',
				suggestedName: options.fileName ? withDawprojectExtension(options.fileName) : exported.fileName,
				mimeType: DAWPROJECT_MIME_TYPE,
				blob,
				signal: operation.task.signal,
			});
			assertReady();
			runtime.setStatus(runtime.copy.dawprojectSaved ?? 'DAWproject exported.', 'success');
			runtime.publishDocumentSnapshot();
			return Object.freeze({ ...saved, fileName: exported.fileName, report: exported.report });
		} finally {
			operation.task.finish();
		}
	}

	async function mediaBlob(source: NativeProjectDocument['sources'][number], kind: 'audio' | 'video'): Promise<Blob> {
		const unavailable = (): Error => new Error(
			runtime.copy.sourcePcmUnavailable.replace('{source}', source.name || source.id),
		);
		if (kind === 'video') {
			const blob = await runtime.store.loadMediaAsset?.(source.storageKey ?? source.id);
			if (!blob) throw unavailable();
			return blob;
		}
		const audio = source as NativeProjectAudioSource;
		const buffer = runtime.sourceBuffers.get(audio.id);
		const channels = buffer
			? Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
			: await runtime.loadStoredSourceChannels(runtime.store, audio);
		if (!channels?.length) throw unavailable();
		const bytes = encodeWav(channels, { sampleRate: audio.sampleRate, float: true }) as Uint8Array<ArrayBuffer>;
		return new Blob([bytes], { type: 'audio/wav' });
	}
}

function withDawprojectExtension(fileName: string): string {
	const trimmed = String(fileName).trim() || 'project';
	return isDawprojectFileName(trimmed) ? trimmed : `${trimmed}${DAWPROJECT_FILE_EXTENSION}`;
}
