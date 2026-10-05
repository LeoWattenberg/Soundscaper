/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createFramescaperCaptureSetupActions as CreateCaptureSetupActions }
	from '../common/editor/framescaper-capture-setup-actions.ts';

export const createFramescaperCaptureSetupActions: typeof CreateCaptureSetupActions = () => {
	throw new Error('Capture setup is unavailable in Soundscaper desktop.');
};

interface CaptureSnapshot {
	readonly capture?: Readonly<{ readonly phase?: string }> | null;
}

export function useFramescaperCaptureRecordVisibility(_snapshot: CaptureSnapshot): boolean {
	return false;
}

export function framescaperCaptureRecordRequired(
	_capture: CaptureSnapshot['capture'],
): boolean {
	return false;
}

export default function SoundscaperCaptureRecordControl(): null {
	return null;
}
