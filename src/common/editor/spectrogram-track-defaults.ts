/* SPDX-License-Identifier: AGPL-3.0-only */

/** Resolve preference defaults at track creation, within the destination project's frequency range. */
export function spectrogramSettingsForNewTrack(
	defaults: unknown,
	sampleRate: number,
	requested?: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
	if (defaults == null) return requested;
	if (typeof defaults !== 'object' || Array.isArray(defaults)) {
		throw new TypeError('Spectrogram defaults must be an object.');
	}
	const settings = defaults as Readonly<Record<string, unknown>>;
	const nyquist = sampleRate / 2;
	if (!Number.isFinite(nyquist) || nyquist <= 0) throw new RangeError('The project sample rate must be positive.');
	const maximumFrequency = Math.min(Number(settings.maximumFrequency ?? nyquist), nyquist);
	const minimumFrequency = Number(settings.minimumFrequency ?? 0);
	return {
		...settings,
		minimumFrequency: minimumFrequency < maximumFrequency ? minimumFrequency : 0,
		maximumFrequency,
		...requested,
	};
}
