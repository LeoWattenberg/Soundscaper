/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { throwAfterReadCapabilityRollback } from './file-capabilities.js';
import { redispatchPendingProjectsAfterReadRelease } from './file-associations.js';
import { registerSelectedReadCapability } from './read-selection-service.js';
import { acceptsFile, validateFileChoice, validateSaveChoice } from './validation.js';

/** @typedef {{id: string, name: string}} OriginalFileDescriptor */
/**
 * @typedef {object} OriginalFileCapabilityService
 * @property {(id: string, options: {owner: object}) => Promise<OriginalFileDescriptor | null>} registerRead
 * @property {(id: string, options: {owner: object}) => Promise<OriginalFileDescriptor>} prepare
 * @property {(id: string, options: {owner: object}) => boolean} release
 */

// Save purposes that write a project rather than exporting something out of one.
const SAVE_DIALOG_TITLES = new Map([
	['project', 'Save project'],
	['project-copy', 'Save project copy'],
	['aup3', 'Export Audacity 3 project'],
	['aup4', 'Export Audacity interchange'],
]);

/**
 * The renderer's file surface: the two native choosers and the capability-scoped reads and
 * writes they hand out.
 *
 * Every handler here is defined by the same rule — the renderer never names a path, it
 * receives an opaque capability the main process minted from a dialog the user answered —
 * so they register together, away from the composition root that owns the window lifecycle.
 */
export function registerFileCapabilityIpc({
	channels, desktopSmokeProbe, dialog, handle, opaqueId, ownerFor, pendingOpenProjects,
	readCapabilities, saves, saveTargets, originalFiles = /** @type {OriginalFileCapabilityService | null} */ (null), sesxMediaSessions = null, windowFor,
	projectDirectory = /** @type {(() => Promise<string | null>) | null} */ (null),
}) {
	async function chooseFiles(event, value) {
		const owner = ownerFor(event);
		const choice = validateFileChoice(value);
		const smokeFilePaths = desktopSmokeProbe.resolveOpenPaths(choice);
		const result = smokeFilePaths !== null ? { canceled: false, filePaths: smokeFilePaths }
			: await dialog.showOpenDialog(windowFor(), {
				title: choice.purpose === 'project' ? 'Open file' : 'Import files',
				properties: choice.multiple ? ['openFile', 'multiSelections'] : ['openFile'], filters: choice.filters,
			});
		if (result.canceled) return [];
		const descriptors = [];
		try {
			for (const filePath of result.filePaths) {
				if (!acceptsFile(choice.purpose, filePath)) throw new TypeError('The selected file type is not allowed');
				const descriptor = await registerSelectedReadCapability(readCapabilities, filePath, { owner, purpose: choice.purpose, originalFiles });
				descriptors.push(descriptor);
				if (choice.purpose === 'project' && /\.sesx$/iu.test(filePath)) await sesxMediaSessions?.registerSelection(descriptor.id, filePath, { owner });
			}
			return descriptors;
		} catch (error) {
			for (const descriptor of descriptors) if (descriptor.originalFile) originalFiles?.release(descriptor.originalFile.id, { owner });
			for (const descriptor of descriptors) sesxMediaSessions?.release(descriptor.id, { owner });
			await throwAfterReadCapabilityRollback(readCapabilities, descriptors, owner, error);
		}
	}

	async function chooseSaveTarget(event, value) {
		const owner = ownerFor(event);
		const choice = validateSaveChoice(value);
		const smokeFilePath = await desktopSmokeProbe.resolveSavePath(choice);
		if (smokeFilePath !== null) {
			return saveTargets.registerPath(smokeFilePath, { owner, purpose: choice.purpose });
		}
		let defaultPath = choice.suggestedName;
		if (projectDirectory && SAVE_DIALOG_TITLES.has(choice.purpose)) {
			const directory = await projectDirectory();
			if (directory) {
				try {
					await mkdir(directory, { recursive: true, mode: 0o700 });
					defaultPath = join(directory, choice.suggestedName);
				} catch {
					// An unavailable default directory must not prevent choosing another location.
				}
			}
		}
		const result = await dialog.showSaveDialog(windowFor(), {
			title: SAVE_DIALOG_TITLES.get(choice.purpose) ?? 'Export',
			defaultPath,
			filters: choice.filters,
		});
		return result.canceled || !result.filePath
			? null
			: saveTargets.registerPath(result.filePath, { owner, purpose: choice.purpose });
	}

	handle(channels.chooseFiles, (event, value) => chooseFiles(event, value));
	handle(channels.releaseRead, (event, id) => redispatchPendingProjectsAfterReadRelease(
		pendingOpenProjects,
		readCapabilities.release(opaqueId(id, 64), { owner: ownerFor(event) }),
	));
	if (sesxMediaSessions) {
		handle(channels.sesxResolveMedia, (event, value) => sesxMediaSessions.resolve({
			owner: ownerFor(event), sessionReadId: opaqueId(value?.sessionReadId, 64),
			relativePath: value?.relativePath,
			...(value?.mediaRootId === undefined ? {} : { mediaRootId: opaqueId(value.mediaRootId, 48) }),
		}));
		handle(channels.sesxChooseFolder, (event, value) => sesxMediaSessions.chooseFolder({
			owner: ownerFor(event), sessionReadId: opaqueId(value?.sessionReadId, 64),
		}));
		handle(channels.sesxReleaseSession, (event, id) => sesxMediaSessions.release(opaqueId(id, 64), { owner: ownerFor(event) }));
	}
	handle(channels.chooseSaveTarget, (event, value) => chooseSaveTarget(event, value));
	if (originalFiles) {
		handle(channels.prepareOriginalOverwrite, (event, id) => originalFiles.prepare(opaqueId(id, 48), { owner: ownerFor(event) }));
		handle(channels.releaseOriginalFile, (event, id) => originalFiles.release(opaqueId(id, 48), { owner: ownerFor(event) }));
	}
	handle(channels.beginWrite, (event, value) => saves.begin({
		owner: ownerFor(event),
		targetId: opaqueId(value?.targetId, 48),
		size: value?.size,
		maximumSize: value?.maximumSize,
		finalPrefixByteLength: value?.finalPrefixByteLength,
	}));
	handle(channels.writeChunk, (event, value) => saves.writeChunk({ owner: ownerFor(event), writeId: opaqueId(value?.writeId, 32), offset: value?.offset, bytes: value?.bytes }));
	handle(channels.patchFinalPrefix, (event, value) => saves.patchFinalPrefix({ owner: ownerFor(event), writeId: opaqueId(value?.writeId, 32), bytes: value?.bytes }));
	handle(channels.finishWrite, (event, id) => saves.finish(opaqueId(id, 32), { owner: ownerFor(event) }));
	handle(channels.abortWrite, (event, id) => saves.abort(opaqueId(id, 32), { owner: ownerFor(event) }));
}
