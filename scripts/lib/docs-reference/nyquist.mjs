/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertProducts,
	compareText,
	formatNumber,
	formatRange,
	page,
	productNames,
	reviewedLabel,
	table,
} from './markdown.mjs';

const ROLE_LABELS = Object.freeze({
	process: 'Process',
	analyze: 'Analyze',
	generate: 'Generate',
});

const CONTROL_KIND_LABELS = Object.freeze({
	choice: 'Choice',
	number: 'Number',
	string: 'Text',
	text: 'Text',
});

function pluginNotes(plugin) {
	const notes = [];
	if (plugin.isTool === true) notes.push('Tool rather than a processing effect');
	if (plugin.spectral === true) notes.push('Needs a spectral selection');
	return notes.join('; ') || '—';
}

function choiceLabel(control, value) {
	const match = control.options.find((option) => option.value === value);
	return match ? match.label : `\`${String(value)}\``;
}

function controlRow(control) {
	const kind = reviewedLabel(CONTROL_KIND_LABELS, control.kind, 'Nyquist control kind');
	const notes = control.unit || '—';
	if (control.kind === 'choice') {
		return [
			control.label,
			kind,
			choiceLabel(control, control.defaultValue),
			control.options.map((option) => option.label).join('; '),
			notes,
		];
	}
	if (control.kind === 'number') {
		return [control.label, kind, formatNumber(control.defaultValue), formatRange(control.min, control.max), notes];
	}
	return [control.label, kind, `\`${String(control.defaultValue)}\``, 'Any text', notes];
}

function pinnedCommit(plugins) {
	const commits = [...new Set(plugins.map((plugin) => plugin.sourceCommit))];
	if (commits.length !== 1) {
		throw new Error(
			'The bundled Nyquist plug-ins no longer share one upstream commit; the generated reference must name each plug-in’s own source.',
		);
	}
	return commits[0];
}

export function renderNyquistReference({ plugins, products, isProductCommandDisabled }) {
	assertProducts(products);
	if (!Array.isArray(plugins) || plugins.length === 0) throw new TypeError('The bundled Nyquist plug-in catalog is required.');
	if (typeof isProductCommandDisabled !== 'function') throw new TypeError('The product command filter is required.');
	const commit = pinnedCommit(plugins);

	const entries = plugins
		.map((plugin) => ({
			name: plugin.name,
			actionId: plugin.actionId,
			role: reviewedLabel(ROLE_LABELS, plugin.role, 'Nyquist plug-in role'),
			author: plugin.author,
			release: plugin.release,
			copyright: plugin.copyright,
			fileName: plugin.fileName,
			notes: pluginNotes(plugin),
			products: productNames(products.filter((product) => !isProductCommandDisabled(
				plugin.actionId,
				product.shortcuts?.disabledCommandIds ?? [],
			))) || 'None',
			controls: plugin.controls.map(controlRow),
		}))
		.sort((left, right) => compareText(left.name, right.name));

	const body = [
		`These Nyquist plug-ins ship with the editor. Each \`.ny\` file is a byte-for-byte copy of the Audacity source at \`${commit.slice(0, 12)}\`, recorded with its SHA-256 digest, and is run by the in-tree Nyquist runtime rather than by Audacity.`,
		'',
		'Each plug-in is invoked by the command ID below; see [Commands and shortcuts](/reference/generated/commands/) for where it appears in the menus.',
		'',
		'## Plug-ins',
		'',
		table(
			['Plug-in', 'Command ID', 'Kind', 'Products', 'Author', 'Upstream release', 'Licence', 'Notes'],
			entries.map((entry) => [
				entry.name,
				`\`${entry.actionId}\``,
				entry.role,
				entry.products,
				entry.author,
				entry.release,
				entry.copyright,
				entry.notes,
			]),
		),
		'',
		'## Controls',
		'',
		'Controls come from each plug-in’s own source, so the wording is the upstream author’s and is not translated. A plug-in with no controls runs directly on the selection.',
		'',
		table(
			['Plug-in', 'Control', 'Type', 'Default', 'Range', 'Notes'],
			entries.flatMap((entry) => entry.controls.map((row) => [entry.name, ...row])),
		),
	].join('\n');
	return page({
		title: 'Nyquist plug-ins',
		description: 'Bundled Nyquist plug-ins, their provenance, and the controls each one exposes.',
		order: 6,
		body,
	});
}
