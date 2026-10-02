/* SPDX-License-Identifier: AGPL-3.0-only */

interface DisplaySize {
	readonly width: number;
	readonly height: number;
}

/** Enlarge the complete readout to fit either panel dimension without clipping digits. */
export function clockPanelDisplayScale(panel: DisplaySize, display: DisplaySize): number {
	if (panel.width <= 0 || panel.height <= 0 || display.width <= 0 || display.height <= 0) return 1;
	return Math.max(0.1, Math.min(
		Math.max(1, panel.width - 24) / display.width,
		Math.max(1, panel.height - 24) / display.height,
	));
}
