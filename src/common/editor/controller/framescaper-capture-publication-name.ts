/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCaptureSourceRole } from '../framescaper-capture-session-manifest.ts';
import { isWebVcrRecoveryOwner } from './framescaper-capture-source-adapter-router.ts';

export function framescaperCapturePublicationName(
	role: FramescaperCaptureSourceRole,
	sourceId: string,
	createdAt: number,
): string {
	if (isWebVcrRecoveryOwner(sourceId)) {
		const timestamp = new Date(createdAt);
		if (!Number.isSafeInteger(createdAt) || Number.isNaN(timestamp.valueOf())) {
			throw new RangeError('Web VCR capture creation time is invalid.');
		}
		const base = `Web Capture ${timestamp.toISOString()
			.replace('T', ' ')
			.replace(/\.\d{3}Z$/u, ' UTC')
			.replace(/:/gu, '-')}`;
		return role === 'microphone' || role === 'system-audio' ? `${base} Audio` : base;
	}
	switch (role) {
		case 'camera': return 'Camera Capture';
		case 'microphone': return 'Microphone Capture';
		case 'display': return 'Screen Capture';
		case 'system-audio': return 'System Audio Capture';
	}
}
