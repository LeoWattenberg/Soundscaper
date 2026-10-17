/* SPDX-License-Identifier: AGPL-3.0-only */

import { bindPhotoDevelopSettingsHostCurrentV1, type PhotoDevelopSettingsHostBindingCurrentV1 } from './photo-library-develop-settings-host-current-v1.ts';
import { createPhotoLibraryDevelopSettingsSessionCurrentV1 } from './photo-library-develop-settings-session-current-v1.ts';
import { createPhotoLibraryDevelopPresetsSessionCurrentV1 } from './photo-library-develop-presets-session-current-v1.ts';
import type { PhotoDevelopPresetSettingsPortV1 } from '../storage/photo-develop-presets-v1.ts';

export interface PhotoDevelopPresetsHostBindingCurrentV1 extends PhotoDevelopSettingsHostBindingCurrentV1 {
	readonly presetSettings?: PhotoDevelopPresetSettingsPortV1;
}
/** Both selected children borrow the same captured native writer, lease and
 * lifetime. Stored presets never enter the clipboard child's private issuer. */
export function createPhotoDevelopPresetChildrenCurrentV1(host: PhotoDevelopPresetsHostBindingCurrentV1) {
	const settingsHost = bindPhotoDevelopSettingsHostCurrentV1(host), ports = host.ports;
	const luts = ports.cubeLutResources, brushes = ports.maskRasterResources;
	const resources = Object.freeze({ cubeLutResources: async () => {
		if (!luts) throw new Error('Selected LUT resources are unavailable.');
		return Reflect.apply(luts, ports, []) as ReturnType<NonNullable<typeof luts>>;
	}, maskRasterResources: async () => {
		if (!brushes) throw new Error('Selected brush resources are unavailable.');
		return Reflect.apply(brushes, ports, []) as ReturnType<NonNullable<typeof brushes>>;
	} });
	const storage = host.presetSettings ? Object.freeze({ settings: host.presetSettings, catalog: ports.catalog, resources }) : undefined;
	return Object.freeze({ settingsCurrent: createPhotoLibraryDevelopSettingsSessionCurrentV1({ ...settingsHost, ...(storage ? { presetStorage: storage } : {}) }),
		...(storage ? { presetsCurrent: createPhotoLibraryDevelopPresetsSessionCurrentV1({ storage, ready: settingsHost.ready,
			operation: settingsHost.operation, mutate: settingsHost.mutate }) } : {}) });
}
