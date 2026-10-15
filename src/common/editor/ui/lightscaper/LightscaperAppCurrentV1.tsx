/* SPDX-License-Identifier: AGPL-3.0-only */

import LightscaperAppKernelV1 from './LightscaperAppKernelV1.tsx';
import type { LightscaperAppPropsV2 } from './LightscaperAppV2.tsx';
import type { CreatePhotoLibrarySessionCurrentV1 } from '../../photo-library-session-port-current-v1.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeCurrentV1 } from '../../photo-library-develop-proxy-port-current-v1.ts';

export interface LightscaperAppPropsCurrentV1 extends Omit<LightscaperAppPropsV2, 'createSession' | 'loadDevelopProxyRuntime'> {
	readonly createSession?: CreatePhotoLibrarySessionCurrentV1;
	readonly loadDevelopProxyRuntime?: CreatePhotoLibraryDevelopProxyRuntimeCurrentV1;
}
export default function LightscaperAppCurrentV1(props: LightscaperAppPropsCurrentV1) { return <LightscaperAppKernelV1 {...props} profile="current3" />; }

