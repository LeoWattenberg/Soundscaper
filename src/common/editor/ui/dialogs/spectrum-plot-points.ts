/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reduce logarithmic display columns by their maximum so narrow tones remain visible. */
export function spectrumPlotPoints(bins: readonly Readonly<{ db?: number }>[]): string {
	const last = Math.max(0, bins.length - 1);
	return Array.from({ length: 128 }, (_, index) => {
		const start = index === 0 ? 0 : Math.round(last ** ((index - 0.5) / 127));
		const end = index === 127 ? bins.length : Math.round(last ** ((index + 0.5) / 127));
		let peakDb = -120;
		for (let bin = start; bin < Math.max(start + 1, end) && bin < bins.length; bin += 1) {
			const db = Number(bins[bin]?.db);
			if (Number.isFinite(db)) peakDb = Math.max(peakDb, db);
		}
		return `${String(index * 5)},${String(Math.round(-Math.max(-120, Math.min(0, peakDb)) / 120 * 150))}`;
	}).join(' ');
}
