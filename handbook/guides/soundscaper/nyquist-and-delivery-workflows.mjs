/* SPDX-License-Identifier: AGPL-3.0-only */

import { check, exportAudio, importAudio, menu, nyquist, open, selectRange } from '../steps.mjs';

export const GENERATOR_WORKFLOW_GUIDES = Object.freeze([
	{
		id: 'generate-a-rhythm-track',
		title: 'Generate a rhythm track',
		description: 'Create a four-bar metronome track at a chosen tempo.',
		audacity: 'Generate → Rhythm Track (Nyquist)',
		intro: 'A generated rhythm track gives you a steady reference while recording or editing. Set the tempo, meter and bar count to match the passage you are working on.',
		steps: [
			open(),
			nyquist({
				menu: 'Generate',
				name: 'Rhythm Track',
				fields: [
					{ label: 'Tempo (bpm)', value: '120' },
					{ label: 'Beats per bar', value: '4' },
					{ label: 'Number of bars', value: '4' },
				],
			}, { why: 'Four bars at 120 beats per minute make an eight-second reference. Keep the beat sound at its default metronome tick.' }),
			check({ clips: 1 }, { see: 'One eight-second rhythm clip appears on the timeline.' }),
		],
		tips: [
			'Change **Swing amount** from `0` to give alternating beats a laid-back feel.',
			'For a longer guide track, increase **Number of bars** or lower **Tempo (bpm)**.',
		],
	},
	{
		id: 'generate-a-risset-drum',
		title: 'Generate a Risset drum',
		description: 'Create a synthetic drum sound with a pitched body and a touch of noise.',
		audacity: 'Generate → Risset Drum (Nyquist)',
		intro: 'Risset Drum combines a decaying tone with a band of noise to make a synthetic percussion hit. Adjust its decay for a short accent or a longer, more resonant sound.',
		steps: [
			open(),
			nyquist({
				menu: 'Generate',
				name: 'Risset Drum',
				fields: [
					{ label: 'Frequency (Hz)', value: '100' },
					{ label: 'Decay (seconds)', value: '1.5' },
					{ label: 'Amplitude (0 - 1)', value: '0.5' },
				],
			}, { why: 'A 1.5-second decay keeps the hit compact; the moderate amplitude leaves room to mix it with other sounds.' }),
			check({ clips: 1 }, { see: 'A non-silent percussive clip about 1.5 seconds long appears on the timeline.' }),
		],
		tips: [
			'Lower **Frequency (Hz)** for a deeper hit; raise it for a brighter, higher sound.',
			'Increase **Amount of noise in mix (percent)** for a noisier attack.',
		],
	},
	{
		id: 'generate-a-plucked-tone',
		title: 'Generate a plucked tone',
		description: 'Create a short, plucked note at a chosen MIDI pitch.',
		audacity: 'Generate → Pluck (Nyquist)',
		intro: 'Pluck makes a short pitched sound that can serve as a simple musical note or sound-design accent. The MIDI pitch field lets you choose a note without calculating its frequency.',
		steps: [
			open(),
			nyquist({
				menu: 'Generate',
				name: 'Pluck',
				fields: [
					{ label: 'Pluck MIDI pitch', value: '60' },
					{ label: 'Duration (60s max)', value: '2' },
				],
			}, { why: 'MIDI pitch 60 is middle C; two seconds gives the note room to decay.' }),
			check({ clips: 1 }, { see: 'A non-silent, two-second plucked note appears on the timeline.' }),
		],
		tips: [
			'Raise **Pluck MIDI pitch** for a higher note or lower it for a deeper note.',
			'Use a shorter **Duration (60s max)** for a tighter accent.',
		],
	},
]);

export const ANALYSIS_WORKFLOW_GUIDES = Object.freeze([
	{
		id: 'measure-rms-level',
		title: 'Measure a selection’s RMS level',
		description: 'Read the average signal level of a selected passage with the bundled RMS analyzer.',
		audacity: 'Analyze → Measure RMS (Nyquist)',
		intro: 'RMS is an average measure of signal level over time. Use the Measure RMS analyzer to compare sections or check how strong a passage is before adjusting it.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the passage whose average level you want to measure' }),
			menu(['Select', 'Select all']),
			nyquist({ menu: 'Analyze', name: 'Measure RMS' }, { see: 'The report shows an RMS level in dB for each channel and for the stereo signal.' }),
		],
		tips: [
			'RMS describes average level; use [peak normalization](guide:normalize-peaks) when you need to set the highest sample to a target.',
			'Select only the section you want to compare so unrelated audio does not affect the measurement.',
		],
	},
	{
		id: 'label-sounds-separated-by-silence',
		title: 'Label sounds separated by silence',
		description: 'Create labels around sounds that rise above a threshold after a pause.',
		audacity: 'Analyze → Label Sounds (Nyquist)',
		intro: 'Label Sounds scans a passage for sound separated by silence and places a label around each detected sound. It can mark spoken phrases, isolated hits or other distinct events for later editing.',
		steps: [
			open(),
			importAudio('gapped-take', { what: 'the recording with pauses between sounds' }),
			menu(['Select', 'Select all']),
			nyquist({
				menu: 'Analyze',
				name: 'Label Sounds',
				fields: [
					{ label: 'Threshold level (dB)', value: '-30' },
					{ label: 'Minimum silence duration', value: '0.5' },
					{ label: 'Minimum label interval', value: '0.5' },
				],
			}, { why: 'A half-second of silence lets the analyzer separate phrases. The threshold sets how loud a sound must be to count.' }),
			check({ track: 'Label Sounds' }, { see: 'A Label Sounds track appears with labels around the detected phrases.' }),
		],
		tips: [
			'Lower **Threshold level (dB)** to include quieter sounds; raise it to ignore background noise.',
			'Increase **Minimum silence duration** when short pauses should not split one phrase into several labels.',
		],
	},
]);

export const DELIVERY_WORKFLOW_GUIDES = Object.freeze([
	{
		id: 'export-clips-as-an-archive',
		title: 'Export clips as a WAV archive',
		description: 'Render each clip as its own WAV file in one ZIP archive.',
		audacity: 'File → Export Audio → Multiple Files, split by tracks or labels (Audacity 3)',
		intro: 'Exporting individual clips keeps each edit as a separate audio file while collecting the files in one archive. Split a passage into clips first, then choose the clips output mode in the export dialog.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording whose clips you want to export separately' }),
			selectRange(0.25, 0.75, { where: 'a passage to export as its own clip' }),
			menu(['Edit', 'Audio clips', 'Split']),
			exportAudio({ format: 'WAV', extension: 'zip', mode: 'Individual clips (split by clips)' }, { why: 'Each clip is rendered as a separate WAV inside one ZIP archive.' }),
		],
		tips: [
			'Use descriptive clip names before exporting so you can identify the files in the archive.',
			'Choose **Entire project** when you want a single mix instead of separate clip files.',
		],
	},
	{
		id: 'export-an-aiff',
		title: 'Export an AIFF file',
		description: 'Render the project as uncompressed, lossless AIFF audio.',
		audacity: 'File → Export Audio → Other uncompressed files → AIFF (Audacity 3)',
		intro: 'AIFF is an uncompressed PCM format often used in audio workflows on Apple systems. Export it when a receiving application or delivery specification asks for AIFF.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording or mix to deliver' }),
			exportAudio({ format: 'AIFF', extension: 'aiff' }, { see: 'The export dialog provides a downloadable `.aiff` file.' }),
		],
		tips: [
			'AIFF is lossless but larger than compressed formats such as [FLAC](guide:export-a-flac).',
			'Choose a sample format and sample rate that match the delivery requirements.',
		],
	},
]);
