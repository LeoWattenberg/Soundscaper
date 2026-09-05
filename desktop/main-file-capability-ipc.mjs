/* SPDX-License-Identifier: AGPL-3.0-only */

import { throwAfterReadCapabilityRollback } from './file-capabilities.js';
import { redispatchPendingProjectsAfterReadRelease } from './file-associations.js';
import { registerSelectedReadCapability } from './read-selection-service.js';
import { acceptsFile, validateFileChoice, validateSaveChoice } from './validation.js';

// The two save purposes that name an operation of their own; everything else exports.
const SAVE_DIALOG_TITLES = Object.freeze({
	project: 'Save project',
	aup4: 'Export Audacity interchange',
});

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
	readCapabilities, saves, saveTargets, windowFor,
}) {
	async function chooseFiles(event, value) {
		const owner = ownerFor(event);
		const choice = validateFileChoice(value);
		const smokeFilePaths = desktopSmokeProbe.resolveOpenPaths(choice);
		const result = smokeFilePaths !== null ? { canceled: false, filePaths: smokeFilePaths }
			: await dialog.showOpenDialog(windowFor(), {
				title: choice.purpose === 'project' ? 'Open project' : 'Import files',
				properties: choice.multiple ? ['openFile', 'multiSelections'] : ['openFile'], filters: choice.filters,
			});
		if (result.canceled) return [];
		const descriptors = [];
		try {
			for (const filePath of result.filePaths) {
				if (!acceptsFile(choice.purpose, filePath)) throw new TypeError('The selected file type is not allowed');
				descriptors.push(await registerSelectedReadCapability(readCapabilities, filePath, { owner, purpose: choice.purpose }));
			}
			return descriptors;
		} catch (error) {
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
		const result = await dialog.showSaveDialog(windowFor(), {
			title: SAVE_DIALOG_TITLES[choice.purpose] ?? 'Export',
			defaultPath: choice.suggestedName,
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
	handle(channels.chooseSaveTarget, (event, value) => chooseSaveTarget(event, value));
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
