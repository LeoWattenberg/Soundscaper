/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy } from 'react';
import type { PhotoDevelopWorkspacePropsV2 } from './PhotoDevelopWorkspaceV2.tsx';
import type { PhotoDevelopWorkspacePropsCurrentV1 } from './PhotoDevelopWorkspaceCurrentV1.tsx';
const LegacyWorkspace = lazy(() => import('./PhotoDevelopWorkspaceV2.tsx'));
const CurrentWorkspace = lazy(() => import('./PhotoDevelopWorkspaceCurrentV1.tsx'));
type Props = Omit<PhotoDevelopWorkspacePropsV2, 'execute' | 'loadProxy'> & {
	readonly profile: 'legacy2' | 'current3';
	readonly execute: PhotoDevelopWorkspacePropsV2['execute'] | PhotoDevelopWorkspacePropsCurrentV1['execute'];
	readonly executeLegacyDevelop: PhotoDevelopWorkspacePropsV2['execute'];
	readonly loadProxy: PhotoDevelopWorkspacePropsV2['loadProxy'] | PhotoDevelopWorkspacePropsCurrentV1['loadProxy'];
};
/** The fixed App profile carries its actual factory/owner pair to the lazy view. */
export default function LightscaperPhotoDevelopSurfaceV1(props: Props) {
	if (props.profile === 'current3') return <CurrentWorkspace {...props as PhotoDevelopWorkspacePropsCurrentV1} legacySettings={props.settings} />;
	if (props.profile !== 'legacy2') throw new TypeError('Unknown photo Develop surface profile.');
	return <LegacyWorkspace {...props as PhotoDevelopWorkspacePropsV2} />;
}
