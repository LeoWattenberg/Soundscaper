/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionDesktopUpdates } from '../../../../motionscaper/desktop-updates-contract.ts';
/** A browser shell receives no update capability; the own desktop bridge handles its native result dialog. */
export function motionscaperDesktopUpdates(): MotionDesktopUpdates | null {
	const scope = globalThis as typeof globalThis & { scapeDesktop?: { v1?: { motionUpdates?: MotionDesktopUpdates } } };
	const bridge = scope.scapeDesktop?.v1?.motionUpdates;
	return typeof bridge?.check === 'function' ? bridge : null;
}
