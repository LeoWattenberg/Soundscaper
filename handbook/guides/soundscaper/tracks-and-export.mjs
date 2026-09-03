/* SPDX-License-Identifier: AGPL-3.0-only */

import { addTrack, check, exportAudio, generate, importAudio, mixRender, open, selectClips, trackButton, trackMenu } from '../steps.mjs';

export const TRACK_AND_EXPORT_GUIDES = Object.freeze([
	{
		id: 'split-stereo-into-mono-tracks',
		title: 'Split a stereo track into two mono tracks',
		description: 'Separate the left and right channels so each can be edited on its own.',
		audacity: 'Track dropdown → Split Stereo Track',
		intro: 'A stereo recording is one track with two channels. When the channels hold different things — an interviewer on the left, a guest on the right, or a guitar and a click track from a two-channel recorder — you want them on separate tracks with their own levels and effects.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the stereo recording' }),
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
		intro: 'Once a bed of tracks is balanced, mixing them down to one makes the project lighter to work with and gives you a single clip to export or take elsewhere. The mix uses each selected track’s gain, pan, automation and effects. Mute and solo are ignored for selected tracks during this operation, and master processing stays live.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the first part' }),
			importAudio('second-loop', { what: 'the second part' }),
			selectClips(['music-loop', 'second-loop'], { which: ['the first clip', 'the second clip'], why: 'Every track with a selected clip goes into the mix.' }),
			mixRender(),
			check({ clip: 'Mix' }, { see: 'One track holds a clip named Mix; the source tracks are gone.' }),
		],
		tips: [
			'Choose **Mono**, **Stereo**, or the project’s configured multichannel layout under **Mix down to** before rendering.',
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
			importAudio('music-loop', { what: 'the recording to publish' }),
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
			importAudio('music-loop', { what: 'the recording to deliver' }),
			exportAudio({ format: 'WAV', extension: 'wav' }),
		],
		tips: [
			'WAV files are large: about ten megabytes a minute for stereo at CD quality.',
			'To export each track as its own file, set **Mode** in the export dialog to individual stems.',
		],
	},
	{
		id: 'mute-and-solo-tracks',
		title: 'Mute and solo tracks',
		description: 'Silence a track, or listen to one track by itself, while you work on a mix.',
		audacity: 'The Mute and Solo buttons in the track control panel',
		intro: 'Every track has a Mute button and a Solo button in its header. Mute silences that track; Solo silences every other track so you hear this one alone. Both are listening aids only — they change what you hear while you work, and the export still renders every unmuted track.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'one track' }),
			importAudio('second-loop', { what: 'another track' }),
			trackButton('Mute', { why: 'The second track drops out of playback.' }),
			trackButton('Solo', { why: 'Solo overrides mute on this track and silences every other one, so you hear this track on its own.' }),
		],
		tips: [
			'Press a button again to release it. **Tracks → Mute all tracks** clears every track at once.',
			'Solo several tracks to audition a group together; muting is then only needed for the odd one out.',
		],
	},
	{
		id: 'add-an-empty-track',
		title: 'Add an empty track',
		description: 'Create a new track to record into or to paste onto.',
		audacity: 'Tracks → Add New → Mono Track',
		intro: 'Importing a file makes a track for you, but a recording or a paste needs somewhere to land. The Add track button above the track list creates an empty audio track; a label track holds markers and text instead of sound.',
		steps: [
			open(),
			addTrack('Audio track'),
			check({ tracks: 2 }, { see: 'A second, empty audio track under the first.' }),
		],
		tips: [
			'Rename the track from its menu so a session with many tracks stays readable.',
			'Drag a track by its header to reorder it.',
		],
	},
]);
