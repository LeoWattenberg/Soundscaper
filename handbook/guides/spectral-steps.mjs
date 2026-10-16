/* SPDX-License-Identifier: AGPL-3.0-only */

/** Select or process a frequency band within the current time selection. */
export function spectralRange({ minimum, maximum, operation = 'select', gain = 6 }, extras = {}) {
	if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum <= minimum) {
		throw new RangeError('A spectral range needs finite, increasing, nonnegative frequency bounds.');
	}
	if (!['select', 'delete', 'amplify'].includes(operation)) throw new RangeError('Unknown spectral operation.');
	if (!Number.isFinite(gain) || gain < -60 || gain > 60) throw new RangeError('Spectral gain must be between -60 and 60 dB.');
	for (const key of Object.keys(extras)) {
		if (!['why', 'see'].includes(key)) throw new TypeError(`A spectral-range step does not take \`${key}\`.`);
	}
	const why = extras.why ?? null;
	const see = extras.see ?? null;
	if ((why !== null && typeof why !== 'string') || (see !== null && typeof see !== 'string')) {
		throw new TypeError('A spectral step explanation must be a string.');
	}
	return Object.freeze({ kind: 'spectral-range', minimum, maximum, operation, gain, why, see });
}

export function describeSpectralRange(entry) {
	const button = { select: 'Select range', delete: 'Spectral Delete', amplify: 'Spectral Amplify' }[entry.operation];
	const gain = entry.operation === 'amplify' ? `, set **Gain (dB)** to \`${entry.gain}\`` : '';
	return `Choose **Effect → Spectral editing → Spectral box select**. Set **Minimum frequency (Hz)** to \`${entry.minimum}\` and **Maximum frequency (Hz)** to \`${entry.maximum}\`${gain}, then press **${button}**.`;
}
