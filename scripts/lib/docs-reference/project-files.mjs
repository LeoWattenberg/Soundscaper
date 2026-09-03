/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertProducts, page, productSentence, reviewedLabel, table } from './markdown.mjs';

const LABEL_FORMAT_NAMES = Object.freeze({
	txt: 'Audacity label text',
	srt: 'SubRip (SRT)',
	vtt: 'WebVTT',
	json: 'Podcast 2.0 chapters (JSON)',
});

const LEGACY_SUFFIX_NOTE = 'Written by releases from before each product had its own suffix. Nothing writes it now.';
const UNCLAIMED_SUFFIX_NOTE = 'Accepted so that no later product can claim it by accident.';

function suffixOwner(extension, extensionByProduct, products) {
	const ownerId = Object.entries(extensionByProduct)
		.find(([, suffix]) => suffix === extension)?.[0] ?? null;
	if (!ownerId) return null;
	return products.find((product) => product.id === ownerId) ?? { id: ownerId, name: null };
}

export function renderProjectFileReference({
	products,
	extensionByProduct,
	acceptedExtensions,
	legacyExtension,
	mimeType,
	labelImportFormats,
	labelExportFormats,
}) {
	assertProducts(products);
	if (!Array.isArray(acceptedExtensions) || acceptedExtensions.length === 0) throw new TypeError('The accepted project suffix list is required.');
	if (!Array.isArray(labelImportFormats) || !Array.isArray(labelExportFormats)) throw new TypeError('The label format lists are required.');

	const suffixRows = acceptedExtensions.map((extension) => {
		if (extension === legacyExtension) return [`\`${extension}\``, 'Nothing', 'Every product', LEGACY_SUFFIX_NOTE];
		const owner = suffixOwner(extension, extensionByProduct, products);
		if (!owner) throw new Error(`Accepted project suffix ${extension} has no owning product and is not the legacy suffix.`);
		if (!owner.name) return [`\`${extension}\``, 'No shipping product', 'Every product', UNCLAIMED_SUFFIX_NOTE];
		return [`\`${extension}\``, owner.name, 'Every product', '—'];
	});

	const labelFormats = [...new Set([...labelImportFormats, ...labelExportFormats])];
	const labelRows = labelFormats.map((format) => [
		reviewedLabel(LABEL_FORMAT_NAMES, format, 'label format'),
		`\`.${format}\``,
		labelImportFormats.includes(format) ? 'Yes' : 'No',
		labelExportFormats.includes(format) ? 'Yes' : 'No',
	]);

	const body = [
		`A project file is the editable document. ${productSentence(products)} each write their own suffix and open all of them.`,
		'',
		`Every suffix below holds the same archive: one ZIP with the same manifest and the same \`${mimeType}\` media type. The suffix is only a routing hint. What a file actually is stays decided by its manifest, schema, capability, and digest checks, so renaming a file neither admits one those checks would refuse nor refuses one they accept.`,
		'',
		'## Project file suffixes',
		'',
		table(['Suffix', 'Written by', 'Opened by', 'Notes'], suffixRows),
		'',
		'A project file is not the same as a rendered export. See [Export formats](/reference/generated/formats/) for the audio and video a finished project can produce.',
		'',
		'## Label files',
		'',
		'Labels are timed text on their own track. These are the interchange formats the editor reads and writes.',
		'',
		table(['Format', 'Extension', 'Import', 'Export'], labelRows),
	].join('\n');
	return page({
		title: 'Project and label files',
		description: 'Project file suffixes, what writes and opens each one, and the label interchange formats.',
		order: 9,
		body,
	});
}
