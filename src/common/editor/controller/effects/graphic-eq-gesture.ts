/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Browser adaptation of GraphicEqBoard.qml, Audacity Team, revision
 * 16f2713979809abe7308b4e1e0d487afeece84f2 (GPLv3).
 * Adapted for kw.media in 2026: injected bounds, snapshot/commit/cancel,
 * and sampling crossed faders when browser pointer events are sparse.
 */

export interface GraphicEqBandBounds {
	readonly left: number; readonly right: number; readonly top: number; readonly bottom: number;
}
export interface GraphicEqPointer { readonly x: number; readonly y: number }

export function createGraphicEqGesture(range: Readonly<{ minimum: number; maximum: number; step: number }>) {
	let snapshot: readonly number[] | null = null;
	let gains: readonly number[] = [];
	let bands: readonly GraphicEqBandBounds[] = [];
	let pressed: number | null = null;
	let lastPainting: number | null = null;
	let painting = false;
	let previous: GraphicEqPointer;
	const under = (at: GraphicEqPointer): number | null => {
		const index = bands.findIndex((band) => at.x >= band.left && at.x <= band.right
			&& at.y >= band.top && at.y <= band.bottom);
		return index < 0 ? null : index;
	};
	const update = (index: number | null, y: number): void => {
		if (index === null) return;
		const band = bands[index]!;
		const raw = range.maximum - (y - band.top) / (band.bottom - band.top) * (range.maximum - range.minimum);
		const gain = Math.max(range.minimum, Math.min(range.maximum, Math.round(raw / range.step) * range.step));
		gains = gains.map((value, entry) => entry === index ? gain : value);
	};
	const move = (at: GraphicEqPointer): readonly number[] | null => {
		if (!snapshot) return null;
		const index = under(at);
		if (!painting && index !== null && index !== pressed) painting = true;
		if (!painting) update(pressed, at.y);
		else {
			// A sweep must also reach faders crossed between two browser events.
			if (at.x !== previous.x) {
				for (const [entry, band] of bands.entries()) {
					const amount = ((band.left + band.right) / 2 - previous.x) / (at.x - previous.x);
					const y = previous.y + (at.y - previous.y) * amount;
					if (amount > 0 && amount <= 1 && y >= band.top && y <= band.bottom) update(entry, y);
				}
			}
			if (index !== null) lastPainting = index;
			update(lastPainting, at.y);
		}
		previous = at;
		return gains;
	};
	return {
		begin(values: readonly number[], bounds: readonly GraphicEqBandBounds[], at: GraphicEqPointer): readonly number[] {
			snapshot = [...values]; gains = [...values]; bands = bounds;
			pressed = under(at); lastPainting = null; painting = false; previous = at;
			update(pressed, at.y);
			return gains;
		},
		move,
		complete(): Readonly<{ gains: readonly number[]; indices: readonly number[] }> | null {
			if (!snapshot) return null;
			const original = snapshot;
			snapshot = null;
			return { gains, indices: gains.flatMap((gain, index) => gain === original[index] ? [] : [index]) };
		},
		cancel(): readonly number[] | null {
			const original = snapshot;
			snapshot = null;
			return original;
		},
	};
}
