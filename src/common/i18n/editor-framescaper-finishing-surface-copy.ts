/* SPDX-License-Identifier: AGPL-3.0-only */

export const FRAMESCAPER_FINISHING_SURFACE_COPY = Object.freeze({
	'visual-inspector': Object.freeze({
		title: 'Selected Visual Inspector',
		description: 'Edit the selected still or built-in generator through exact presentation state.',
	}),
	'color-management': Object.freeze({
		title: 'Managed Color & Source Interpretation',
		description: 'Inspect disclosed source assumptions, override them explicitly, and select deterministic sRGB or Rec.709 output.',
	}),
	'grading-presets': Object.freeze({
		title: 'Grading & Finishing Presets',
		description: 'Author managed-SDR grades, presentations, and reusable visual finishing presets.',
	}),
	'motion-tracking': Object.freeze({
		title: 'Motion Tracking',
		description: 'Configure deterministic built-in tracking and its digest-bound analysis references.',
	}),
	stabilization: Object.freeze({
		title: 'Similarity Stabilization',
		description: 'Configure similarity stabilization with optical flow used only as its motion provider.',
	}),
	denoise: Object.freeze({
		title: 'Spatial & Temporal Denoise',
		description: 'Configure deterministic spatial and temporal denoise with CPU/WebGL2 parity.',
	}),
	captions: Object.freeze({
		title: 'Caption Tracks',
		description: 'Author explicit caption tracks or import/export strict SRT, WebVTT, and IMSC 1.1 sidecars.',
	}),
	automation: Object.freeze({
		title: 'Automation Lanes',
		description: 'Edit shared V21 automation-lane documents for Framescaper audio strips.',
	}),
	mixer: Object.freeze({
		title: 'Mixer & Routing',
		description: 'Edit the shared V21 mixer graph used by Framescaper audio finishing.',
	}),
	'dialogue-chain': Object.freeze({
		title: 'Dialogue Chain',
		description: 'Apply the deterministic Framescaper dialogue chain to the selected audio track.',
	}),
});
