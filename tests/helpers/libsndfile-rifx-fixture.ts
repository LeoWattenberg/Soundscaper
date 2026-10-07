/* SPDX-License-Identifier: AGPL-3.0-only */

import { inflateSync } from 'node:zlib';

// Unmodified libsndfile 1.2.2 sf_writef_float exports, SF_FORMAT_WAV | SF_ENDIAN_BIG.
// The short files contain [0.25, -0.5, 0.75, -1]; the tone is mono 400 Hz,
// one second at 48 kHz, amplitude 0.25. Compression only packages the fixture.
const SAMPLE_FILES = {
	s16: 'UklGWAAAACxXQVZFZm10IAAAABAAAQABAAC7gAABdwAAAgAQZGF0YQAAAAggAMAAX/+AAQ==',
	s24: 'UklGWAAAADBXQVZFZm10IAAAABAAAQABAAC7gAACMoAAAwAYZGF0YQAAAAwgAADAAABf//+AAAE=',
	f32: 'UklGWAAAAFhXQVZFZm10IAAAABAAAwABAAC7gAAC7gAABAAgZmFjdAAAAAQAAAAEUEVBSwAAABAAAAABasWkiD+AAAAAAAADZGF0YQAAABA+gAAAvwAAAD9AAAC/gAAA',
	f64: 'UklGWAAAAGhXQVZFZm10IAAAABAAAwABAAC7gAAF3AAACABAZmFjdAAAAAQAAAAEUEVBSwAAABAAAAABasWkiD+AAAAAAAADZGF0YQAAACA/0AAAAAAAAL/gAAAAAAAAP+gAAAAAAAC/8AAAAAAAAA==',
} as const;

const TONE =
	'eNrtz7sv3XEYBvDvqUuIkENw3H7nCJ0kBpvB0qGNSiyVtGwkbRNDWSRlkDQxsLIYLDYWk0QkXQ02QxMbORe3QwjiEnJCT/oX9A/45M2T98mzfT59/DAcYj/f' +
	'fnn3+f33H1PtIYR4iBUv/P5V3EN4E+Jfx6bG/vUQ2ygZLouVr1X0V+aqpqtLa+bjoXaibq++s2G8cTWx23TYnGvZb91qm4v6onRyMplPDaZWUn9S9+0hdV/8' +
	'K6nBZD45GaWjvra51q2W/eZc02Fit3G1Yby+s26vdiIeauarS6umK3MV/eVrZbGS4dhGCC9DhfXn16eRx+2H6G7htnAzcx2uli57Lg7Ol/OjZ72nHSfRcdfR' +
	'QG42u5NtzyxmEunN9Ld0d7oqHYrpLvbNTCKzmG3P7uRmjwaOu06i046z3vzo+fLFwWXP1dJ1uJm5LdwtPESP208jz6+F9ZchXl5eXl5eXl5eXl5eXl5eXl5e' +
	'Xl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5e' +
	'Xl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5e' +
	'Xl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5e' +
	'Xl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXt7/9/4F21Nr' +
	'Vg==';

export function libsndfileRifxSamples(format: keyof typeof SAMPLE_FILES): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(Buffer.from(SAMPLE_FILES[format], 'base64'));
}

export function libsndfileRifxTone(): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(inflateSync(Buffer.from(TONE, 'base64')));
}

/** The same four samples from libsndfile's ordinary little-endian WAV float writer. */
export function libsndfileRiffSamples(): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(Buffer.from('UklGRlgAAABXQVZFZm10IBAAAAADAAEAgLsAAADuAgAEACAAZmFjdAQAAAAEAAAAUEVBSxAAAAABAAAAlaXFagAAgD8DAAAAZGF0YRAAAAAAAIA+AAAAvwAAQD8AAIC/', 'base64'));
}
