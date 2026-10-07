/* SPDX-License-Identifier: AGPL-3.0-only */

import { check, exportAudio, generate, importAudio, open, trackMenu } from '../steps.mjs';

export const GENERATION_AND_EXPORT_GUIDES = Object.freeze([
	{
		id: 'generate-white-noise',
		title: 'Generate white noise',
		description: 'Create a short noise clip for sound design or checking an audio chain.',
		audacity: 'Generate → Noise (Audacity 3)',
		intro: 'White noise spreads energy across the frequency range. Generate a short, quiet clip to build a texture or check a signal chain without importing a recording.',
		steps: [
			open(),
			generate({ name: 'Noise', fields: [
				{ field: 'amplitude', label: 'Amplitude', value: '0.1' },
				{ field: 'durationSeconds', label: 'Duration (seconds)', value: '2' },
			] }, { why: 'Leave Noise color at its default, White. Start at a low amplitude before listening.' }),
			check({ clips: 1 }, { see: 'A two-second noise clip appears on the timeline.' }),
		],
		tips: [
			'The Noise color control also offers Pink and Brown for different textures.',
			'In an existing project, place the cursor where the new clip should start. A time selection makes the generator replace that passage.',
		],
	},
	{
		id: 'generate-a-frequency-sweep',
		title: 'Generate a frequency sweep',
		description: 'Create a tone that rises from one frequency to another over a set duration.',
		audacity: 'Generate → Chirp (Audacity 3)',
		intro: 'Chirp creates a tone whose frequency changes across its length. Use a gentle sweep for an electronic sound effect or to hear how a signal chain responds across a range.',
		steps: [
			open(),
			generate({ name: 'Chirp', fields: [
				{ field: 'startFrequency', label: 'Start frequency (Hz)', value: '220' },
				{ field: 'endFrequency', label: 'End frequency (Hz)', value: '880' },
				{ field: 'startAmplitude', label: 'Start amplitude (0–1)', value: '0.1' },
				{ field: 'endAmplitude', label: 'End amplitude (0–1)', value: '0.1' },
				{ field: 'durationSeconds', label: 'Duration (seconds)', value: '2' },
			] }, { why: 'This rises by two octaves while keeping a low, constant amplitude.' }),
			check({ clips: 1 }, { see: 'A two-second sweep appears on the timeline.' }),
		],
		tips: [
			'Put the higher frequency first to make a downward sweep.',
			'Waveform and Interpolation change the sweep’s tone and the way it moves between the endpoints.',
		],
	},
	{
		id: 'generate-dtmf-tones',
		title: 'Generate telephone keypad tones',
		description: 'Turn a keypad sequence into DTMF audio with an adjustable total duration.',
		audacity: 'Generate → DTMF Tones (Audacity 3)',
		intro: 'DTMF uses two simultaneous tones for each telephone keypad symbol. Generate the sequence you need for a telephone sound effect, with pauses between its symbols.',
		steps: [
			open(),
			generate({ name: 'DTMF tones', fields: [
				{ field: 'sequence', label: 'DTMF sequence', value: '123' },
				{ field: 'amplitude', label: 'Amplitude', value: '0.2' },
				{ field: 'durationSeconds', label: 'Duration (seconds)', value: '2' },
			] }, { why: 'Enter your keypad symbols in order. The total duration covers both the tones and the pauses.' }),
			check({ clips: 1 }, { see: 'One clip contains the keypad tones in the order you entered.' }),
		],
		tips: [
			'Duty cycle controls how much of the sequence is tone rather than silence.',
			'The timing summary shows each tone and pause length before you generate the clip.',
		],
	},
	{
		id: 'generate-morse-code',
		title: 'Generate a Morse code message',
		description: 'Encode text as audible dots and dashes at a chosen speed and frequency.',
		audacity: 'No directly matching built-in Morse code generator',
		intro: 'Morse code turns a message into timed dots, dashes and spaces. The generator previews the encoding and derives the clip length from your message and speed.',
		steps: [
			open(),
			generate({ name: 'Morse code', fields: [
				{ field: 'text', label: 'Message', value: 'SOS' },
				{ field: 'wordsPerMinute', label: 'Speed (words per minute)', value: '20' },
				{ field: 'frequency', label: 'Frequency (Hz)', value: '600' },
				{ field: 'amplitude', label: 'Amplitude', value: '0.2' },
			] }, { why: 'Replace the example message with your own text. Check the encoding preview; unsupported characters prevent generation.' }),
			check({ clips: 1 }, { see: 'A Morse code clip contains the message; its length follows the chosen speed.' }),
		],
		tips: [
			'A lower speed lengthens the dots, dashes and spaces without lowering the tone’s frequency.',
			'Duration is a read-only result here. Change the message or speed to change the clip length.',
		],
	},
	{
		id: 'export-a-flac',
		title: 'Export a FLAC file',
		description: 'Render the mix into a compressed lossless audio file.',
		audacity: 'File → Export Audio → FLAC (Audacity 3)',
		intro: 'FLAC compresses PCM audio without discarding samples at the chosen export precision. It is useful for a smaller listening master while your project keeps the editable tracks.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording or mix to deliver' }),
			exportAudio({ format: 'FLAC', extension: 'flac' }, { see: 'The export dialog offers a downloadable FLAC file.' }),
		],
		tips: [
			'Compression level changes the encoding work and file size, rather than the decoded audio quality.',
			'An exported mix does not keep separate tracks or undo history. [Save your project](guide:save-your-project) for later editing.',
		],
	},
	{
		id: 'export-an-ogg-vorbis-file',
		title: 'Export an Ogg Vorbis file',
		description: 'Create a compressed listening copy in an Ogg container using Vorbis audio.',
		audacity: 'File → Export Audio → Ogg Vorbis (Audacity 3)',
		intro: 'Ogg Vorbis makes a smaller listening copy by discarding some audio information. Export the mix in this format when the receiving player or service supports it.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording or mix to share' }),
			exportAudio({ format: 'Ogg Vorbis', extension: 'ogg' }, { see: 'The export dialog offers a downloadable Ogg file.' }),
		],
		tips: [
			'Quality controls the tradeoff between file size and encoding quality.',
			'Keep [a lossless master](guide:export-a-flac) if you expect to edit or encode the recording again.',
		],
	},
	{
		id: 'swap-stereo-channels',
		title: 'Swap the left and right channels',
		description: 'Correct a stereo recording whose left and right channels are reversed.',
		audacity: 'Audio Track Dropdown Menu → Swap Stereo Channels (Audacity 3)',
		intro: 'Swap stereo channels exchanges the audio on the left and right of a stereo track. Use it to correct reversed microphone or recorder connections while keeping the recording’s timing.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the stereo recording whose channels are reversed' }),
			trackMenu(['Track channels', 'Swap stereo channels']),
			check({ clips: 1, tracks: 2 }, { see: 'The recording stays in place as one stereo clip, with its channels exchanged.' }),
		],
		tips: [
			'This exchanges channel contents. Panning a track changes where you hear it without exchanging its channels.',
			'**Edit → Undo** restores the original channel order.',
		],
	},
]);
