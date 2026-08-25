/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveFramescaperVideoProxyUseV20,
	type FramescaperVideoProxyPressureV20,
} from './editor-video-proxy-use-policy-v20.ts';

export function snapshotFramescaperVideoProxyPressureV20(
	value: Readonly<FramescaperVideoProxyPressureV20>,
): Readonly<FramescaperVideoProxyPressureV20> {
	resolveFramescaperVideoProxyUseV20({
		purpose: 'preview', mode: 'auto', originalAvailable: true,
		proxyTrust: 'attested', pressure: value,
	});
	return Object.freeze({
		droppedFrameRatio: value.droppedFrameRatio,
		decodeQueueDepth: value.decodeQueueDepth,
		viewportScale: value.viewportScale,
	});
}

export function framescaperVideoProxyPressureSelectsProxyV20(
	value: Readonly<FramescaperVideoProxyPressureV20> | null,
): boolean {
	return resolveFramescaperVideoProxyUseV20({
		purpose: 'preview', mode: 'auto', originalAvailable: true,
		proxyTrust: 'attested', pressure: value,
	}).kind === 'proxy';
}
