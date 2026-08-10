/* SPDX-License-Identifier: AGPL-3.0-only */

/** Copy for sequence timing: the rational rate, its SMPTE labels, and frame navigation. */
export const SEQUENCE_TIMING_COPY_BY_LOCALE = Object.freeze({
	de: Object.freeze({
		sequenceTiming: 'Sequenz-Timing',
		sequenceName: 'Sequenzname',
		sequenceRate: 'Bildrate',
		sequenceDropFrame: 'Drop-Frame',
		sequenceStartTimecode: 'Start-Timecode',
		sequenceTimecode: 'Timecode',
		sequenceTimecodeRuler: 'Timecode-Lineal',
		sequenceTimecodeInvalid: 'Timecode passt nicht zur Bildrate der Sequenz',
		sequenceSourceTimecode: 'Quell-Timecode',
		previousFrame: 'Vorheriges Bild',
		nextFrame: 'Nächstes Bild',
	}),
	en: Object.freeze({
		sequenceTiming: 'Sequence timing',
		sequenceName: 'Sequence name',
		sequenceRate: 'Frame rate',
		sequenceDropFrame: 'Drop frame',
		sequenceStartTimecode: 'Start timecode',
		sequenceTimecode: 'Timecode',
		sequenceTimecodeRuler: 'Timecode ruler',
		sequenceTimecodeInvalid: 'Enter a timecode this sequence rate produces',
		sequenceSourceTimecode: 'Source timecode',
		previousFrame: 'Previous frame',
		nextFrame: 'Next frame',
	}),
});
