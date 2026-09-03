/* SPDX-License-Identifier: AGPL-3.0-only */

import { check, exportAudio, generate, importAudio, menu, open, selectClips, trackMenu } from '../steps.mjs';

export const TRACK_AND_EXPORT_LESSONS = Object.freeze([
	{
		id: 'split-stereo-into-mono-tracks',
		title: 'Split a stereo track into two mono tracks',
		description: 'Separate the left and right channels so each can be edited on its own.',
		audacity: 'Track dropdown → Split Stereo Track',
		intro: 'A stereo recording is one track with two channels. When the channels hold different things — an interviewer on the left, a guest on the right, or a guitar and a click track from a two-channel recorder — you want them on separate tracks with their own levels and effects.',
		steps: [
			open(),
			importAudio('music-loop'),
			trackMenu(['Track channels', 'Split stereo to left/right mono'], { why: 'Each channel becomes its own mono track, panned hard left and hard right so the mix still sounds the same.' }),
			check({ clips: 2 }, { see: 'Two mono clips, one per channel, on two tracks named after their side.' }),
		],
		tips: [
			'Select both tracks and choose **Track channels → Make stereo track** from the track menu to join them again.',
			'**Split stereo to centered mono** does the same but centres both tracks, which is right when the channels held the same sound.',
		],
	},
	{
		id: 'mix-tracks-into-one',
		title: 'Mix several tracks into one',
		description: 'Render the selected tracks down to a single track.',
		audacity: 'Tracks → Mix → Mix and Render',
		intro: 'Once a bed of tracks is balanced, mixing them down to one makes the project lighter to work with and gives you a single clip to export or take elsewhere. The mix uses each track’s gain, pan, mute and effects, exactly as playback does.',
		steps: [
			open(),
			importAudio('music-loop'),
			importAudio('second-loop'),
			selectClips(['music-loop', 'second-loop'], { why: 'Every track with a selected clip goes into the mix.' }),
			menu(['Tracks', 'Mix', 'Mix-down to']),
			check({ clip: 'Mix' }, { see: 'One track holds a clip named Mix; the source tracks are gone.' }),
		],
		tips: [
			'**Edit → Undo** brings the original tracks back if you need to change the balance.',
			'You do not have to mix down to export. **File → Export audio** renders the whole project on its own.',
		],
	},
	{
		id: 'generate-a-test-tone',
		title: 'Generate a test tone',
		description: 'Create a sine wave of a set frequency and length from nothing.',
		audacity: 'Generate → Tone',
		intro: 'A tone at a known frequency and level is the first thing to reach for when checking a signal chain, calibrating a level, or building a beep to cover a word. Generators create audio at the cursor, or replace the selection if there is one.',
		steps: [
			open(),
			generate({
				name: 'Tone',
				fields: [
					{ field: 'frequency', label: 'Frequency (Hz)', value: '440' },
					{ field: 'durationSeconds', label: 'Duration (seconds)', value: '2' },
				],
			}, { why: '440 Hz is concert A, the standard tuning reference.' }),
			check({ clips: 1 }, { see: 'A new clip holds two seconds of tone.' }),
		],
		tips: [
			'Set **Amplitude** to `0.5` or lower if the tone is going to be mixed with anything.',
			'**Generate → Silence** works the same way and is the easiest way to add a gap between clips.',
		],
	},
	{
		id: 'export-an-mp3',
		title: 'Export an MP3',
		description: 'Render the project to an MP3 file for sharing or publishing.',
		audacity: 'File → Export Audio → MP3',
		intro: 'An MP3 is small, plays everywhere and is what most podcast hosts and messaging apps expect. The export renders the whole project — every track, effect and edit — into one file.',
		steps: [
			open(),
			importAudio('music-loop'),
			exportAudio({ format: 'MP3', extension: 'mp3' }, { why: 'The file is encoded in the browser; nothing leaves your computer.' }),
		],
		tips: [
			'An MP3 is a delivery copy, not a backup. Keep the project or export a WAV as well if you may edit again.',
			'Peaks right at full scale can clip after encoding. Normalize to −1 dB or lower before exporting.',
		],
	},
	{
		id: 'export-a-wav',
		title: 'Export a WAV',
		description: 'Render the project to an uncompressed WAV file.',
		audacity: 'File → Export Audio → WAV',
		intro: 'WAV keeps every sample exactly as the editor has it. Use it for masters, for handing audio to a video editor or another DAW, and for anything you may want to process again.',
		steps: [
			open(),
			importAudio('music-loop'),
			exportAudio({ format: 'WAV', extension: 'wav' }),
		],
		tips: [
			'WAV files are large: about ten megabytes a minute for stereo at CD quality.',
			'To export each track as its own file, set **Mode** in the export dialog to individual stems.',
		],
	},
]);
