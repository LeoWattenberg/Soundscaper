/* SPDX-License-Identifier: AGPL-3.0-only */

import { check, cursor, exportAudio, exportProject, importAudio, marker, menu, open, openAudacityProject, openProjectFile, play, resample, save, tool } from '../steps.mjs';

export const PROJECT_GUIDES = Object.freeze([
	{
		id: 'save-your-project',
		title: 'Save your project',
		description: 'Keep the project, with every track and edit, in the local project library.',
		audacity: 'File → Save Project',
		intro: 'A project is more than the audio: it is the tracks, clips, effects, markers and history. Saving keeps all of that in the browser’s local project library on this computer, where it can be reopened from the File menu. Soundscaper also saves as you go, so this is mostly a way to be sure.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'something to work on' }),
			save(),
		],
		tips: [
			'To move a project to another computer or keep a copy outside the browser, see [Move a project between computers](guide:move-a-project-between-computers).',
			'An audio export is a listening copy, not a project. Keep the project if you may edit again.',
		],
	},
	{
		id: 'move-a-project-between-computers',
		title: 'Move a project between computers',
		description: 'Export the whole project as one file, then open that file elsewhere.',
		audacity: 'File → Save Project → Backup Project, then File → Open',
		intro: 'The project library lives in one browser on one computer. To carry a project anywhere else — another machine, a colleague, a backup drive — export it as a project file. The `.sscape` file holds the audio and every edit, and opens in any Soundscaper.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the project material' }),
			exportProject({ why: 'Keep the file somewhere safe; it is the complete project.' }),
			openProjectFile({ see: 'The project opens with its track and clip exactly as exported.' }),
		],
		tips: [
			'A read-only copy cannot be edited until you save it as a project of its own from the File menu.',
			'The file is a ZIP archive with the audio inside; do not unpack it by hand.',
		],
	},
	{
		id: 'open-an-audacity-project',
		title: 'Open an Audacity project',
		description: 'Bring an existing .aup3 or .aup4 project into Soundscaper with its tracks intact.',
		audacity: 'File → Open',
		intro: 'Projects made in Audacity 3 (.aup3) and Audacity 4 (.aup4) open directly. The tracks, clips, names and positions come across; effects that Soundscaper does not have are listed so you know what to check. The original file is not changed.',
		steps: [
			open(),
			openAudacityProject(),
			check({ track: 'Fixture track', clip: 'Audio 1' }, { see: 'The track and clip from the Audacity project, with their names.' }),
		],
		tips: [
			'An old-style `.aup` project needs its `_data` folder next to it; pick both when asked.',
			'**File → Audacity projects → Export AUP4** goes the other way, for handing a project back to Audacity.',
		],
	},
	{
		id: 'export-each-track-as-its-own-file',
		title: 'Export each track as its own file',
		description: 'Render the tracks separately, as stems, in one download.',
		audacity: 'File → Export Audio → Export multiple, split by tracks',
		intro: 'A mixing engineer, a video editor or a collaborator on another program usually wants the parts, not the mix. A stems export renders every track to its own file, all the same length and aligned to the project start, and packs them into one archive.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the first track' }),
			importAudio('second-loop', { what: 'the second track' }),
			exportAudio({ format: 'WAV', extension: 'zip', mode: 'Individual stems (split by tracks)' }, { why: 'Each track becomes a WAV inside the ZIP, trimmed to the same length so they line up when imported elsewhere.' }),
		],
		tips: [
			'Mute and solo do not affect stems; every track is rendered.',
			'Name the tracks before exporting — the stem files take their names from them.',
		],
	},
	{
		id: 'change-a-clips-sample-rate',
		title: 'Change a clip’s sample rate',
		description: 'Resample a clip so it matches the rate the rest of the project uses.',
		audacity: 'Tracks → Resample',
		intro: 'A clip recorded at 44.1 kHz will still play correctly in a 48 kHz project — Soundscaper converts on the fly — but for a delivery that must be at one rate, or before an effect that expects it, you can convert the clip itself. Resampling recalculates every sample at the new rate and keeps the timing exactly.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the clip at the wrong rate' }),
			resample(44100, { why: 'The clip’s properties show its current rate; 44100 Hz is CD standard.' }),
			play({ see: 'The clip sounds exactly as before; only its stored rate has changed.' }),
		],
		tips: [
			'Resampling is an edit and can be undone.',
			'Going down in rate discards the highest frequencies; going up adds nothing but is harmless.',
		],
	},

	{
		id: 'export-each-chapter-as-its-own-file',
		title: 'Export each chapter as its own file',
		description: 'Split one long recording into files at the markers you have placed.',
		audacity: 'File → Export Audio → Export Multiple, split by labels (Audacity 3; Audacity 4 has no Export Multiple)',
		intro: 'A lecture that should become one file per topic, an album side that needs cutting into tracks, an audiobook with a chapter per file: put a marker at the start of each part and export once. Every marker opens a chapter that runs to the next one, and each chapter is written as its own file, named after the marker, inside a single archive. Audacity 3 did this with Export Multiple; Audacity 4 has not brought it back.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording to split' }),
			menu(['View', 'Show markers'], { why: 'The marker lane is where the chapter starts are shown and named.' }),
			tool('Jump to project start', { why: 'The first chapter should begin at the very start, so the first marker goes at zero.' }),
			marker('Part one'),
			cursor(0.5, { where: 'where the second part begins' }),
			marker('Part two'),
			exportAudio({ format: 'MP3', extension: 'zip', mode: 'Chapters (split by labels)' }, { why: 'Each chapter becomes an MP3 inside the archive, numbered in order and named after its marker.' }),
		],
		tips: [
			'A named region exports exactly its own span, so use regions instead of markers when the parts have gaps between them.',
			'To split by tracks rather than by markers, see [Export each track as its own file](guide:export-each-track-as-its-own-file).',
		],
	},
]);
