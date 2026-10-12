/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy } from 'react';
import type { PhotoDevelopWorkspacePropsV2 } from './PhotoDevelopWorkspaceV2.tsx';
import type { PhotoDevelopWorkspacePropsCurrentV1 } from './PhotoDevelopWorkspaceCurrentV1.tsx';
import type { usePhotoDevelopSettingsCurrentV1 } from './use-photo-develop-settings-current-v1.ts';
import type { usePhotoDevelopSettingsV2 } from './use-photo-develop-settings-v2.ts';
const LegacyWorkspace = lazy(() => import('./PhotoDevelopWorkspaceV2.tsx'));
const CurrentWorkspace = lazy(() => import('./PhotoDevelopWorkspaceCurrentV1.tsx'));
type Props = Omit<PhotoDevelopWorkspacePropsV2, 'execute' | 'loadProxy' | 'settings'> & {
	readonly profile: 'legacy2' | 'current3';
	readonly execute: PhotoDevelopWorkspacePropsV2['execute'] | PhotoDevelopWorkspacePropsCurrentV1['execute'];
	readonly executeLegacyDevelop: PhotoDevelopWorkspacePropsV2['execute'];
	readonly loadProxy: PhotoDevelopWorkspacePropsV2['loadProxy'] | PhotoDevelopWorkspacePropsCurrentV1['loadProxy'];
	readonly settings: ReturnType<typeof usePhotoDevelopSettingsV2> | ReturnType<typeof usePhotoDevelopSettingsCurrentV1>;
};
/** The fixed App profile carries its actual factory/owner pair to the lazy view. */
export default function LightscaperPhotoDevelopSurfaceV1(props: Props) {
	if (props.profile === 'current3') return <CurrentWorkspace {...props as PhotoDevelopWorkspacePropsCurrentV1} settingsCurrent={props.settings as ReturnType<typeof usePhotoDevelopSettingsCurrentV1>} />;
	if (props.profile !== 'legacy2') throw new TypeError('Unknown photo Develop surface profile.');
	return <LegacyWorkspace {...props as PhotoDevelopWorkspacePropsV2} settings={props.settings as ReturnType<typeof usePhotoDevelopSettingsV2>} />;
}
