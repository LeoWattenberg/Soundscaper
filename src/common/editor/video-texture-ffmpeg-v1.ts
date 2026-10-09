/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertTextureFfmpegOperationV1 } from './video-texture-v1.ts';
import { appendOriginalAlphaEffectFfmpegV1 } from './video-original-alpha-ffmpeg-v1.ts';

/** The private compiled operation owns GEQ text. Exact original alpha travels
 * around RGB conversion for both neighborhood weighting and publication. */
export function appendTextureFfmpegOperationV1(context:Readonly<{filters:string[];inputLabel:string;outputLabel:string;operation:unknown}>):void{
	const {operation}=context;assertTextureFfmpegOperationV1(operation);
	appendOriginalAlphaEffectFfmpegV1({...context,operation});
}
