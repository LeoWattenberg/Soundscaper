/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertProducts,
	compareText,
	formatNumber,
	formatRange,
	page,
	productSentence,
	table,
} from './markdown.mjs';

function colorLiteral(value) {
	return `\`#${Number(value).toString(16).padStart(6, '0')}\``;
}

function optionLabel(parameter, value) {
	const match = parameter.options?.find((item) => item.value === value);
	if (!match) throw new RangeError(`Video effect option ${String(value)} is not declared.`);
	return match.label;
}

function parameterRow(parameter) {
	if (parameter.control === 'curve') {
		return [parameter.label, parameter.default.map(point => `(${formatNumber(point.x)}, ${formatNumber(point.y)})`).join('; '),
			`2–${parameter.maximumPoints} points; input/output 0–1; strictly increasing inputs, endpoints 0 and 1`, '—'];
	}
	if (parameter.control === 'color') {
		return [parameter.label, colorLiteral(parameter.default), 'Any RGB color', '—'];
	}
	if (parameter.control === 'select') {
		const choices = parameter.options.map((item) => item.label).join('; ');
		return [parameter.label, optionLabel(parameter, parameter.default), choices, '—'];
	}
	if (parameter.control !== 'number') {
		throw new RangeError(`Unknown video effect control: ${String(parameter.control)}.`);
	}
	return [
		parameter.label,
		formatNumber(parameter.default),
		formatRange(parameter.min, parameter.max),
		parameter.unit || '—',
	];
}

export function renderVideoEffectReference({ products, definitions }) {
	assertProducts(products);
	if (!definitions || typeof definitions !== 'object') throw new TypeError('The video effect registry is required.');
	const enabledProducts = products.filter((product) => product.capabilities?.videoEffects === true);
	if (enabledProducts.length === 0) throw new Error('No product profile enables video effects.');

	const effects = Object.values(definitions)
		.map((definition) => {
			if (typeof definition.type !== 'string' || typeof definition.label !== 'string') {
				throw new TypeError('Every video effect must have a type and label.');
			}
			return {
				type: definition.type,
				label: definition.label,
				parameters: Object.values(definition.params).map(parameterRow),
			};
		})
		.sort((left, right) => compareText(left.label, right.label) || compareText(left.type, right.type));

	const body = [
		`Video effects are registered by ${productSentence(enabledProducts)}. They are stacked on a clip, an adjustment layer, or a track, and are applied in the order they appear.`,
		'',
		'One definition owns each effect’s parameters, and the preview and the export both read it, so an effect that is visible in the preview is the effect the export renders.',
		...(definitions['color-wheels-v1'] ? ['',
			'Color grading wheels use the explicit `srgb-scalar-lgg-wheels-v1` process. Shadows, midtones and highlights control overlapping lift, gamma and gain. Each straight encoded sRGB channel decodes to linear Rec.709, applies lift → gain → gamma, clips, encodes sRGB and rounds half up to a byte. Alpha stays unchanged. Only nine numeric controls persist; lookup tables are derived when the current CPU stage or native upload needs them.',
			'This scalar process preserves its own exact byte contract. Legacy managed GradeV1 retains its existing luminance recombination and rounding; the two processes can differ at half-byte boundaries.'] : []),
		'',
		'## Effects',
		'',
		table(
			['Effect', 'Effect ID', 'Parameters'],
			effects.map((effect) => [effect.label, `\`${effect.type}\``, String(effect.parameters.length)]),
		),
		'',
		'## Parameters',
		'',
		'Defaults and limits come from the same definitions the editor validates against.',
		'',
		table(
			['Effect', 'Parameter', 'Default', 'Range', 'Unit'],
			effects.flatMap((effect) => effect.parameters.map((row) => [effect.label, ...row])),
		),
	].join('\n');
	return page({
		title: 'Video effects',
		description: 'Registered video effects and their parameter defaults and ranges.',
		order: 5,
		body,
	});
}
