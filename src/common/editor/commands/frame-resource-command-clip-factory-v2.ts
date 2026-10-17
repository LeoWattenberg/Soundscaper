/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMediaClip, createMediaClipV2 } from '../project-media-factory.ts';
import { isFrameResourceCommandProjectV2 } from './frame-resource-command-carriers-v2.ts';

/** Clip construction uses the same admitted current Frame authority as carrier
 * reconciliation, while the carrier owner keeps no dependency on factories. */
export function frameCommandClipFactoryV2(project: unknown): typeof createMediaClip {
	return isFrameResourceCommandProjectV2(project) ? createMediaClipV2 : createMediaClip;
}
