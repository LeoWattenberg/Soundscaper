/* SPDX-License-Identifier: AGPL-3.0-only */

import { check, cursor, effect, importAudio, marker, menu, open, play, selectRange, tool } from '../steps.mjs';

const selectAll = (extras) => menu(['Select', 'Select all'], extras);

export const EDITING_LESSONS = Object.freeze([
	{
		id: 'cut-out-a-mistake',
		title: 'Cut a mistake out of a recording',
		description: 'Select a slip, remove it, and close the gap so the recording flows on.',
		audacity: 'Select the region, then Edit → Delete (or Ctrl+K)',
		intro: 'The most common edit there is: a false start, a cough, a retake. Select the part you do not want, remove it, and let the rest of the track slide left to close the gap.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectRange(0.4, 0.6, { why: 'Select exactly the part you want gone. Zoom in with **View → Zoom → Zoom in** if the mistake is short.' }),
			menu(['Edit', 'Cut', 'Cut and close gap per track'], { why: 'The selection is removed and everything after it moves left, so no silence is left behind.' }),
			check({ clips: 2 }, { see: 'Two clips sit end to end where the selection was, and the track is shorter by exactly that much. Play across the join to check it.' }),
		],
		tips: [
			'**Cut and leave gap** removes the sound but keeps the time, which is right when the track has to stay in sync with a video or another track.',
			'Not happy with the join? **Edit → Undo**, adjust the selection and try again.',
		],
	},
	{
		id: 'split-a-clip-at-the-cursor',
		title: 'Split a clip in two',
		description: 'Cut a clip at a point so each part can be moved or treated separately.',
		audacity: 'Edit → Clip Boundaries → Split (Ctrl+I)',
		intro: 'A split does not remove anything. It turns one clip into two that sit end to end, so you can drag one part elsewhere, delete it, or apply an effect to it alone. The quickest way is the split tool: while it is active, every click on a clip cuts it at that point.',
		steps: [
			open(),
			importAudio('music-loop'),
			tool('Split tool', { why: 'The pointer now cuts instead of selecting. Press **S** to toggle the tool from the keyboard.' }),
			cursor(0.5, { why: 'With the split tool active, the click cuts the clip here.' }),
			check({ clips: 2 }, { see: 'Two clips now sit where there was one.' }),
			tool('Split tool', { why: 'Press it again to return to the normal pointer.' }),
		],
		tips: [
			'To split at the playhead instead, select the clip and choose **Edit → Audio clips → Split**; with a time range selected, it splits at both ends of the range.',
			'Select both halves and choose **Edit → Audio clips → Join selected clips** to make them one clip again.',
		],
	},
	{
		id: 'keep-only-a-selection',
		title: 'Keep only the part you want',
		description: 'Trim away everything outside a selection in one step.',
		audacity: 'Edit → Remove Special → Trim Audio',
		intro: 'When a long recording contains one good take, it is quicker to select the take and throw away the rest than to delete the surroundings in pieces. Trim keeps the selection and removes the audio on both sides of it.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectRange(0.25, 0.75, { why: 'Select the passage you want to keep.' }),
			menu(['Edit', 'Remove special', 'Trim audio outside selection']),
			check({ clips: 1 }, { see: 'Only the selected passage remains on the track.' }),
		],
		tips: [
			'The trimmed clip stays where it was on the timeline. Drag it to the start if you want it to begin at zero.',
			'Trim is an edit like any other; **Edit → Undo** restores what was outside the selection.',
		],
	},
	{
		id: 'repeat-a-section',
		title: 'Repeat a section',
		description: 'Loop a selection a set number of times to make it longer.',
		audacity: 'Effect → Special → Repeat',
		intro: 'A two-bar loop, a background bed that needs to run under a longer voice-over, a sound effect that should go on: Repeat copies the selection straight after itself as many times as you ask.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectAll(),
			effect({
				group: 'Special',
				name: 'Repeat',
				settings: [{ label: 'Number of repeats', value: '2' }],
			}, { why: 'Two repeats give three copies in a row.' }),
			play({ see: 'The loop plays three times without a gap.' }),
		],
		tips: [
			'For a seamless loop, make sure the selection starts and ends on silence or at a zero crossing (**Select → At zero crossings**).',
			'The effect changes the length of the clip, so anything after it on the same track is pushed along.',
		],
	},
	{
		id: 'reverse-audio',
		title: 'Play a recording backwards',
		description: 'Reverse a selection so it plays from end to start.',
		audacity: 'Effect → Special → Reverse',
		intro: 'Reverse flips the selection in time. It is an effect for sound design — reversed cymbals, swelling pre-echoes — and occasionally for checking whether a room’s reverb tail hides anything.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectAll(),
			effect({ group: 'Special', name: 'Reverse', direct: true }),
			play({ see: 'The loop plays backwards.' }),
		],
		tips: [
			'Apply Reverse twice and you are back where you started, sample for sample.',
			'Reverse a short selection at the start of a clip to build a swell that leads into it.',
		],
	},
	{
		id: 'add-markers',
		title: 'Mark places in a recording',
		description: 'Drop named markers on the timeline so you can find points again later.',
		audacity: 'Edit → Labels → Add Label at Selection (Ctrl+B)',
		intro: 'Markers are notes on the timeline: where a chapter starts, where a mistake needs fixing, where the good take begins. They do not change the audio, they travel with the project, and they can be exported as a label file for other tools.',
		steps: [
			open(),
			importAudio('music-loop'),
			menu(['View', 'Show markers'], { why: 'This adds a marker lane above the tracks. Markers exist without it, but the lane is where you see and edit them.' }),
			cursor(0.5, { why: 'The marker goes where the cursor is.' }),
			marker('Chorus', { see: 'The marker shows in the lane above the tracks and in the panel’s list, with the name you typed.' }),
		],
		tips: [
			'With a time range selected, the same button adds a named region instead of a single point.',
			'**File → Export labels** writes the markers as a text file that Audacity and other editors can read.',
		],
	},
]);
