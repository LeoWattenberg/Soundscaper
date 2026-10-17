/* SPDX-License-Identifier: AGPL-3.0-only */

import { appendOriginalAlphaEffectFfmpegV1 } from './video-original-alpha-ffmpeg-v1.ts';

export function appendClarityFfmpegOperationV1(context: Readonly<{ filters: string[]; inputLabel: string; outputLabel: string;
	operation: Readonly<Record<string, unknown>> }>): void {
	const { operation } = context;
	if(operation.kind!=='clarity-v1' || typeof operation.expression!=='string' || operation.preserveAlpha!==true) {
		throw new TypeError('Clarity requires its owning compiled local-contrast operation.');
	}
	appendOriginalAlphaEffectFfmpegV1({ ...context, operation:{ expression:operation.expression,preserveAlpha:true } });
}
