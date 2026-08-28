/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveFramescaperVideoProxyUseRetime,
	type FramescaperVideoProxyPressureRetime,
} from './editor-video-proxy-use-policy-retime.ts';

export function snapshotFramescaperVideoProxyPressureRetime(
	value: Readonly<FramescaperVideoProxyPressureRetime>,
): Readonly<FramescaperVideoProxyPressureRetime> {
	resolveFramescaperVideoProxyUseRetime({
		purpose: 'preview', mode: 'auto', originalAvailable: true,
		proxyTrust: 'attested', pressure: value,
	});
	return Object.freeze({
		droppedFrameRatio: value.droppedFrameRatio,
		decodeQueueDepth: value.decodeQueueDepth,
		viewportScale: value.viewportScale,
	});
}

export function framescaperVideoProxyPressureSelectsProxyRetime(
	value: Readonly<FramescaperVideoProxyPressureRetime> | null,
): boolean {
	return resolveFramescaperVideoProxyUseRetime({
		purpose: 'preview', mode: 'auto', originalAvailable: true,
		proxyTrust: 'attested', pressure: value,
	}).kind === 'proxy';
}
