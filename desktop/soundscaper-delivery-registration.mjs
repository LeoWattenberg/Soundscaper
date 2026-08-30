/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { SOUNDSCAPER_DELIVERY_DATABASE_FILE_NAME } from './project-library-runtime/desktop/soundscaper-delivery-database.js';
import {
	createUnavailableSoundscaperDeliveryFilesystemAuthority,
} from './project-library-runtime/desktop/soundscaper-delivery-filesystem-authority.js';
import {
	createSoundscaperDeliveryFilesystemProcessAuthority,
} from './project-library-runtime/desktop/soundscaper-delivery-filesystem-process.js';
import { registerSoundscaperDeliveryMainIpc } from './project-library-runtime/desktop/soundscaper-delivery-main-ipc.js';
import { SoundscaperDeliveryService } from './project-library-runtime/desktop/soundscaper-delivery-service.js';
import { describeSoundscaperProfessionalNativePayload } from './soundscaper-professional-native-payload.mjs';

/** Composes the Soundscaper-only durable queue without growing the desktop entrypoint. */
export async function startSoundscaperDeliveryRegistration(options) {
	if (options.productId !== 'soundscaper') return null;
	const authority = options.projectLibraryRuntime?.soundscaperDeliveryProjectAuthority?.();
	if (!authority || typeof authority.readProjectAuthority !== 'function') {
		throw new Error('Soundscaper persistent delivery requires the exact project-library authority.');
	}
	const filesystem = await deliveryFilesystem(options);
	const service = await SoundscaperDeliveryService.start({
		databasePath: resolve(options.userDataPath, SOUNDSCAPER_DELIVERY_DATABASE_FILE_NAME),
		instanceId: options.instanceId,
		processId: options.processId,
		filesystem,
		readProjectIdentity: async (projectId) => (await authority.readProjectAuthority(projectId))?.projectIdentity ?? null,
	});
	try {
		const ipc = registerSoundscaperDeliveryMainIpc({
			handle: options.handle,
			removeHandler: options.removeHandler,
			on: options.on,
			removeListener: options.removeListener,
			ownerFor: options.ownerFor,
			service,
			readProjectAuthority: authority.readProjectAuthority,
			dialog: options.dialog,
			windowFor: options.windowFor,
		});
		return Object.freeze({
			revokeOwner: (owner) => ipc.revokeOwner(owner),
			async dispose() { await ipc.dispose(); await service.close(); },
		});
	} catch (error) {
		await service.close();
		throw error;
	}
}

async function deliveryFilesystem(options) {
	const availability = await describeSoundscaperProfessionalNativePayload(options.nativePayloadLocation);
	if (availability.status === 'available') {
		const executablePath = availability.descriptor?.deliveryFilesystem?.path;
		if (typeof executablePath !== 'string') {
			throw new Error('The authenticated professional payload omitted its delivery filesystem helper.');
		}
		return createSoundscaperDeliveryFilesystemProcessAuthority({ executablePath });
	}
	const detail = `Authenticated persistent delivery is unavailable (${String(availability.reason)}): ${String(availability.detail)}`;
	if (options.releaseChannel === 'stable') {
		throw new Error(`Stable Soundscaper requires its authenticated delivery filesystem helper. ${detail}`);
	}
	return createUnavailableSoundscaperDeliveryFilesystemAuthority(detail);
}
