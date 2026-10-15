/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoLibraryExportPresetsPortCurrentV1 } from '../../../common/editor/photo-library-export-presets-port-current-v1.ts';
import type { PhotoLibraryExportPresetsSessionHostV1 } from './photo-library-export-presets-session-kernel-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';

/** Both children borrow the same captured selected Session; no store or lease is created. */
export function createPhotoLibrarySessionExportPresetsV1(host: PhotoLibraryExportPresetsSessionHostV1, current: boolean) {
	const child = (profile: 'legacy1' | 'current1'): Readonly<PhotoLibraryExportPresetsPortCurrentV1> => Object.freeze({ open(options = {}) {
		const { signal } = readPhotoDevelopSignalOptionsV2(options);
		return host.operation(async admitted => {
			if (profile === 'current1') {
				const { openPhotoLibraryExportPresetsCurrentSession } = await import('../photo-library-export-presets-current-session.ts');
				admitted.throwIfAborted(); return openPhotoLibraryExportPresetsCurrentSession(host, { signal: admitted });
			}
			const { openPhotoLibraryExportPresetsSession } = await import('../photo-library-export-presets-session.ts');
			admitted.throwIfAborted(); return openPhotoLibraryExportPresetsSession(host, { signal: admitted });
		}, signal);
	} });
	return Object.freeze({ legacy: child('legacy1'), ...(current ? { current: child('current1') } : {}) });
}
