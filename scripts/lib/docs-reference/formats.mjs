/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertProducts, compareText, page, productNames, table } from './markdown.mjs';

function audioRuntimeRequirement(descriptor) {
	if (descriptor.backend === 'native-wav' || descriptor.backend === 'native-aiff') return 'Built in';
	if (descriptor.backend === 'custom-ffmpeg') {
		return 'FFmpeg runtime required; settings determine the encoder and container';
	}
	if (descriptor.backend !== 'ffmpeg') throw new RangeError(`Unknown audio export backend: ${String(descriptor.backend)}.`);
	const encoders = (descriptor.requiredEncoders ?? []).join(', ') || 'runtime-selected';
	const muxers = (descriptor.requiredMuxers ?? [])
		.map((alternatives) => Array.isArray(alternatives) ? alternatives.join(' or ') : String(alternatives))
		.join(', ') || 'runtime-selected';
	return `FFmpeg runtime required (encoders: ${encoders}; muxers: ${muxers})`;
}

function videoRuntimeRequirement(descriptor) {
	const encoders = (descriptor.requiredEncoders ?? []).join(', ') || 'runtime-selected';
	const muxers = (descriptor.requiredMuxers ?? []).join(', ') || 'runtime-selected';
	return `FFmpeg runtime required (encoders: ${encoders}; muxers: ${muxers})`;
}

function assertAudioFormatInventory(audioFormatIds, audioFormats) {
	if (!Array.isArray(audioFormatIds) || !audioFormats || typeof audioFormats !== 'object') {
		throw new TypeError('The audio export format registries are required.');
	}
	const declared = [...audioFormatIds].sort(compareText);
	const described = Object.keys(audioFormats).sort(compareText);
	if (declared.length !== new Set(declared).size || declared.join('\n') !== described.join('\n')) {
		throw new Error('The editor audio export format list and descriptor registry must contain the same unique IDs.');
	}
}

export function renderFormatReference({ products, audioFormatIds, audioFormats, videoFormats }) {
	assertProducts(products);
	assertAudioFormatInventory(audioFormatIds, audioFormats);
	if (!videoFormats || typeof videoFormats !== 'object') throw new TypeError('The video export format registry is required.');

	const audioProducts = products.filter((product) => product.exportChoices?.includes('audio'));
	const videoProducts = products.filter((product) => (
		product.exportChoices?.includes('video') && product.capabilities?.videoExport !== false
	));
	const audioRows = Object.values(audioFormats)
		.map((descriptor) => [
			descriptor.label,
			descriptor.extension ? `.${descriptor.extension}` : 'Chosen at export',
			`${descriptor.codec} / ${descriptor.container}`,
			descriptor.lossless === true ? 'Lossless' : descriptor.lossless === false ? 'Lossy' : 'Depends on settings',
			String(descriptor.maximumChannels),
			audioRuntimeRequirement(descriptor),
			productNames(audioProducts),
		])
		.sort((left, right) => compareText(left[0], right[0]));
	const videoRows = Object.values(videoFormats)
		.map((descriptor) => [
			descriptor.label,
			`.${descriptor.extension}`,
			`${descriptor.videoCodec} video; ${descriptor.audioCodec} audio / ${descriptor.container}`,
			videoRuntimeRequirement(descriptor),
			productNames(videoProducts),
		])
		.sort((left, right) => compareText(left[0], right[0]));

	const body = [
		'These are the concrete formats registered by the current export runtime. Product availability comes from the product profiles.',
		'',
		'“Built in” means the application has a native writer for that format. “FFmpeg runtime required” is conditional: the table does not promise that the FFmpeg runtime can be loaded in every build or environment, or that an arbitrary replacement runtime contains the listed encoder and muxer.',
		'',
		'Project files and label files are listed separately in [Project and label files](/reference/generated/project-files/).',
		'',
		'## Audio',
		'',
		table(
			['Format', 'Extension', 'Codec / container', 'Fidelity', 'Maximum channels', 'Runtime requirement', 'Products'],
			audioRows,
		),
		'',
		'## Video',
		'',
		table(
			['Format', 'Extension', 'Codecs / container', 'Runtime requirement', 'Products'],
			videoRows,
		),
	].join('\n');
	return page({
		title: 'Export formats',
		description: 'Registered audio and video export formats and their runtime requirements.',
		order: 2,
		body,
	});
}
