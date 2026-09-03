/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertProducts, compareText, page, reviewedLabel, table } from './markdown.mjs';

const CAPABILITY_LABELS = Object.freeze({
	project: 'Projects',
	projectBin: 'Project bin',
	audioImport: 'Audio import',
	audioPlayback: 'Audio playback',
	audioTimelineEditing: 'Audio timeline editing',
	audioMixing: 'Audio mixing',
	videoImport: 'Video import',
	videoPlayback: 'Video playback',
	videoTimelineEditing: 'Video timeline editing',
	videoExport: 'Video export',
	audioRecording: 'Audio recording',
	audioGenerators: 'Audio generators',
	audioEffects: 'Audio effects',
	audioSpectralEditing: 'Spectral audio editing',
	audioAnalysis: 'Audio analysis',
	audioMacros: 'Audio macros',
	audioSampleEditing: 'Sample-level audio editing',
	audioAutomation: 'Audio automation',
	audioMixerGraph: 'Audio routing and mixer graph',
	audioTrackFreeze: 'Audio track freeze',
	assistanceAssets: 'Local assistance assets',
	videoEffects: 'Video effects',
	videoAdjustmentLayers: 'Video adjustment layers',
	videoCompositing: 'Video compositing',
	videoFreeze: 'Video freeze',
	videoGenerators: 'Video generators',
	videoGeometry: 'Video geometry',
	videoKeyframes: 'Video keyframes',
	videoMasksMattes: 'Video masks and mattes',
	multicamera: 'Multicamera editing',
	musicalTimeline: 'Musical timeline',
	nestedSequences: 'Nested sequences',
	ofxEffects: 'OpenFX effects',
	timelineAnnotations: 'Timeline annotations',
	trackFolders: 'Track folders',
	takeComp: 'Take comping',
	audioWarp: 'Audio warping',
	sequenceTiming: 'Sequence timing',
	timelineImages: 'Timeline images',
	videoRetime: 'Video retiming',
	videoCaptions: 'Video captions',
	videoColorManagement: 'Video color management',
	videoDenoise: 'Video denoise',
	videoGrading: 'Video grading',
	videoMotionTracking: 'Video motion tracking',
	videoStabilization: 'Video stabilization',
	videoStills: 'Video stills',
	videoTimingAssets: 'Video timing assets',
	videoTransitionDissolve: 'Dissolve video transitions',
	videoTransitions: 'Video transitions',
	sourceCharacteristics: 'Source characteristics',
	masteringSequences: 'Mastering sequences',
	immersiveAdm: 'Immersive ADM audio',
});

const APPLICATION_FEATURE_LABELS = Object.freeze({
	framescaperCapture: 'Screen and camera capture',
	framescaperWebVcr: 'Web VCR capture',
});

// The `scape` family ID is one machine-level identity shared by every product;
// only the suffix each product writes differs, so its label is per-product.
const FAMILY_LABELS = Object.freeze({
	scape: (product) => product.projectFileExtension,
	'audacity-project': 'Audacity projects',
	audio: 'Audio',
	video: 'Video',
	labels: 'Labels',
	'aup4-audio-only': 'AUP4 (audio-only)',
	stems: 'Audio stems',
});

function renderFeatureRows(products, field, labels, kind) {
	const keys = new Set(products.flatMap((product) => Object.keys(product[field] ?? {})));
	return [...keys]
		.map((key) => ({ key, label: reviewedLabel(labels, key, kind) }))
		.sort((left, right) => compareText(left.label, right.label) || compareText(left.key, right.key))
		.map(({ key, label }) => [
			label,
			...products.map((product) => product[field]?.[key] === true ? 'Enabled' : 'Not enabled'),
		]);
}

function familyNames(product, families) {
	if (!Array.isArray(families)) return 'None';
	return families.map((family) => {
		const label = reviewedLabel(FAMILY_LABELS, family, 'format family');
		const resolved = typeof label === 'function' ? label(product) : label;
		if (typeof resolved !== 'string' || !resolved) {
			throw new Error(`No reviewed documentation label exists for format family ${family}.`);
		}
		return resolved;
	}).join(', ');
}

export function renderCapabilityReference({ products }) {
	assertProducts(products);
	const featureRows = renderFeatureRows(products, 'capabilities', CAPABILITY_LABELS, 'capability');
	const applicationFeatureRows = renderFeatureRows(
		products,
		'applicationFeatures',
		APPLICATION_FEATURE_LABELS,
		'application feature',
	);
	const familyRows = products.map((product) => [
		product.name,
		familyNames(product, product.importChoices),
		familyNames(product, product.exportChoices),
	]);
	const featureHeaders = ['Capability', ...products.map(({ name }) => name)];
	const sections = [
		'This page reflects the current product profiles. “Enabled” means that the profile exposes that authoring or runtime capability. A disabled capability can still be preserved when a project is opened across products; this table does not claim that it can be edited.',
		'',
		'## Import and export families',
		'',
		table(['Product', 'Import families', 'Export families'], familyRows),
		'',
		'Families describe product entry points, not every file extension a decoder might accept. See [Export formats](/reference/generated/formats/) for concrete output formats and runtime conditions.',
		'',
		'## Editing and project capabilities',
		'',
		table(featureHeaders, featureRows),
	];
	if (applicationFeatureRows.length > 0) {
		sections.push(
			'',
			'## Product-specific application features',
			'',
			table(featureHeaders, applicationFeatureRows),
		);
	}
	return page({
		title: 'Product capabilities',
		description: 'Soundscaper and Framescaper import, export, editing, and project capabilities.',
		order: 3,
		body: sections.join('\n'),
	});
}
