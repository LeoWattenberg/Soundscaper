/* SPDX-License-Identifier: AGPL-3.0-only */

export const SELECTED_VISUAL_AUTHORING_COPY = Object.freeze({
	presetDefaultName: 'Selected Visual Preset',
	selectAdjacent: 'Select one clip from an unlocked video track containing an adjacent pair.',
	exactPair: 'Exact adjacent pair', outgoingIncoming: 'Outgoing → incoming', linkedAv: 'linked A/V',
	duration: 'Duration (sequence frames)', applyDissolve: 'Apply dissolve', removeDissolve: 'Remove dissolve',
	selectVideo: 'Select one timeline video clip first.', selectedVideo: 'Selected video occurrence',
	brightness: 'Brightness', updateAdjustment: 'Update adjustment', applyAdjustment: 'Apply adjustment',
	removeAdjustment: 'Remove adjustment', selectVisual: 'Select one timeline visual clip first.',
	selectedAttachment: 'Selected presentation attachment', attachedMask: 'Attached mask', newMask: 'New mask',
	shape: 'Shape', rectangle: 'Rectangle', ellipse: 'Ellipse', line: 'Line', width: 'Width', height: 'Height',
	updateMask: 'Update attached mask', createMask: 'Create and attach mask', removeAttachment: 'Remove attachment',
	visualPreset: 'Visual preset', presetName: 'Preset name', saveGenerator: 'Save selected generator preset',
	savedVisualPreset: 'Saved visual preset', none: 'None', applyGenerator: 'Apply to selected generator',
	removeVisualPreset: 'Remove visual preset', finishingPreset: 'Finishing preset',
	savedFinishingPreset: 'Saved finishing preset', applyFresh: 'Apply as fresh presentation',
	removeFinishingPreset: 'Remove finishing preset', exactPlayhead: 'Exact playhead picture',
	timelineSample: 'Timeline sample', freezeDuration: 'Freeze duration (sequence frames)',
	captureFrame: 'Capture authenticated rendered frame', removed: 'Selected authored state removed.',
	presetSaved: 'Selected visual preset saved.', freezeCreated: 'Exact playhead freeze created.',
	applied: 'Selected authored state applied.',
});

export const SELECTED_VISUAL_AUTHORING_SURFACE_COPY = Object.freeze({
	'video-transition': Object.freeze({ title: 'Video Transition',
		description: 'Choose one exact adjacent picture pair and author or remove its dissolve.' }),
	'video-transition-dissolve': Object.freeze({ title: 'Dissolve Transition',
		description: 'Choose one exact adjacent picture pair and set its dissolve duration.' }),
	'video-adjustment-layer': Object.freeze({ title: 'Selected Video Adjustment Layer',
		description: 'Apply, edit, or remove the adjustment that targets the selected video occurrence.' }),
	'video-visual-preset': Object.freeze({ title: 'Selected Visual Presets',
		description: 'Save, apply, or remove visual and finishing presets through fresh selected state.' }),
	'video-mask-matte': Object.freeze({ title: 'Selected Mask / Matte',
		description: 'Create, edit, attach, or remove a mask on the selected visual presentation.' }),
	'video-freeze': Object.freeze({ title: 'Freeze Selected Video',
		description: 'Capture the exact authenticated picture at the current playhead.' }),
});
