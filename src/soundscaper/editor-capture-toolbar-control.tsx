/* SPDX-License-Identifier: AGPL-3.0-only */

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
