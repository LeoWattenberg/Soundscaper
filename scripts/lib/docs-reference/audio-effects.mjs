/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertProducts,
	compareText,
	formatNumber,
	formatRange,
	page,
	productSentence,
	reviewedLabel,
	table,
} from './markdown.mjs';

const CATEGORY_LABELS = Object.freeze({
	volume: 'Volume and dynamics',
	eq: 'EQ and filters',
	repair: 'Noise and repair',
	'pitch-tempo': 'Pitch and tempo',
	fades: 'Fades',
	delay: 'Delay and reverb',
	modulation: 'Distortion and modulation',
	special: 'Special',
});

/**
 * Categories for the effects this repository wrote itself.
 *
 * The Audacity inventory carries a category on every definition because the
 * upstream menus are organized that way. The local definitions are keyed only
 * by type, so their placement is a documentation decision and is reviewed here
 * rather than guessed from the identifier.
 */
const LOCAL_EFFECT_CATEGORIES = Object.freeze({
	highpass: 'eq',
	lowpass: 'eq',
	eq: 'eq',
	compressor: 'volume',
	limiter: 'volume',
	gate: 'volume',
	reverb: 'delay',
	delay: 'delay',
	bitcrusher: 'modulation',
	'reviewed-utility-gain': 'volume',
});

/** Parameters whose value is a structure rather than a scalar or a choice. */
const STRUCTURED_LOCAL_PARAMETERS = Object.freeze({
	'eq.bands': 'Each band has a type, frequency, gain, Q, and slope',
});

const BROWSER_ADAPTATION_NOTES = Object.freeze({
	schroeder: 'Browser build uses a Schroeder reverb network',
});

const CURVE_RANGE_NOTE = 'Frequency and gain pairs';

function categoryFor(type, definition) {
	if (typeof definition?.category === 'string') {
		return reviewedLabel(CATEGORY_LABELS, definition.category, 'effect category');
	}
	const category = reviewedLabel(LOCAL_EFFECT_CATEGORIES, type, 'local effect');
	return reviewedLabel(CATEGORY_LABELS, category, 'effect category');
}

function audacityNotes(type, definition, staffPadEffectTypes) {
	const notes = [];
	if (definition.requiresControlTrack === true) notes.push('Needs a control track');
	if (definition.requiresNoiseProfile === true) notes.push('Needs a captured noise profile');
	if (definition.requiresContext === true) notes.push('Needs audio on either side of the selection');
	if (definition.lengthChanging === true) notes.push('Changes the selection length');
	if (definition.requiresStaffPad === true || staffPadEffectTypes.includes(type)) {
		notes.push('Uses the StaffPad time and pitch library');
	}
	if (typeof definition.browserAdaptation === 'string') {
		notes.push(reviewedLabel(BROWSER_ADAPTATION_NOTES, definition.browserAdaptation, 'browser adaptation'));
	}
	return notes;
}

function parameterName(type, name, parameterLabel) {
	return parameterLabel(type, name) ?? `\`${name}\``;
}

function audacityParameterRows(type, definition, context) {
	const { parameterLabel, optionLabel, formatCurve } = context;
	return Object.entries(definition.params).map(([name, descriptor]) => {
		const label = parameterName(type, name, parameterLabel);
		const unit = descriptor.unit || '—';
		if (descriptor.kind === 'number') {
			return [label, formatNumber(descriptor.default), formatRange(descriptor.minimum, descriptor.maximum), unit];
		}
		if (descriptor.kind === 'boolean') {
			return [label, descriptor.default === true ? 'On' : 'Off', 'On or off', '—'];
		}
		if (descriptor.kind === 'enum') {
			const choices = descriptor.options
				.map((item) => optionLabel(type, name, item.value) ?? `\`${String(item.value)}\``);
			const selected = optionLabel(type, name, descriptor.default) ?? `\`${String(descriptor.default)}\``;
			return [label, selected, choices.join('; '), unit];
		}
		if (descriptor.kind === 'curve') {
			return [label, formatCurve(descriptor.default), CURVE_RANGE_NOTE, 'Hz and dB'];
		}
		if (descriptor.kind === 'bands') {
			const bands = descriptor.frequencies.length;
			return [
				label,
				`${formatNumber(descriptor.default[0])} on each of the ${String(bands)} bands`,
				formatRange(descriptor.minimum, descriptor.maximum),
				unit,
			];
		}
		throw new RangeError(`Unknown Audacity effect parameter kind: ${String(descriptor.kind)}.`);
	});
}

function localScalarDefault(definition, name) {
	const own = definition.defaults?.[name];
	if (own !== undefined && (typeof own !== 'object' || own === null)) return formatNumber(own);
	const band = definition.bandDefaults?.[name];
	if (band !== undefined && (typeof band !== 'object' || band === null)) return formatNumber(band);
	return '—';
}

function localParameterRows(type, definition, context) {
	const { parameterLabel, optionLabel } = context;
	const ranges = definition.ranges ?? {};
	const choices = definition.choices ?? {};
	const rows = [];
	for (const [name, range] of Object.entries(ranges)) {
		const [minimum, maximum, metadata = {}] = range;
		rows.push([
			parameterName(type, name, parameterLabel),
			localScalarDefault(definition, name),
			formatRange(minimum, maximum),
			metadata.unit || '—',
		]);
	}
	for (const [name, choice] of Object.entries(choices)) {
		const options = choice.options.map((value) => optionLabel(type, name, value) ?? `\`${String(value)}\``);
		const selected = optionLabel(type, name, definition.defaults?.[name]) ?? `\`${String(definition.defaults?.[name])}\``;
		rows.push([parameterName(type, name, parameterLabel), selected, options.join('; '), '—']);
	}
	for (const [name, value] of Object.entries(definition.defaults ?? {})) {
		if (Object.hasOwn(ranges, name) || Object.hasOwn(choices, name)) continue;
		const shape = STRUCTURED_LOCAL_PARAMETERS[`${type}.${name}`];
		if (!shape) throw new Error(`No reviewed documentation shape exists for structured parameter ${type}.${name}.`);
		const count = Array.isArray(value) ? `${String(value.length)} bands` : '—';
		rows.push([parameterName(type, name, parameterLabel), count, shape, '—']);
	}
	return rows;
}

function collectEffects(context) {
	const {
		audacityDefinitions,
		localDefinitions,
		rackEffectTypes,
		selectionEffectTypes,
		effectLabel,
		liveCapability,
		staffPadEffectTypes,
	} = context;
	const rack = new Set(rackEffectTypes);
	const selection = new Set(selectionEffectTypes);
	const types = [...new Set([...rack, ...selection])];
	return types.map((type) => {
		const audacity = Object.hasOwn(audacityDefinitions, type) ? audacityDefinitions[type] : null;
		const local = Object.hasOwn(localDefinitions, type) ? localDefinitions[type] : null;
		const definition = audacity ?? local;
		if (!definition) throw new Error(`Audio effect ${type} has no definition to document.`);
		const capability = audacity ? liveCapability(type) : null;
		return {
			type,
			label: effectLabel(type),
			category: categoryFor(type, audacity),
			rack: rack.has(type),
			selection: selection.has(type),
			origin: audacity ? 'Audacity' : 'Soundscaper local',
			notes: audacity ? audacityNotes(type, audacity, staffPadEffectTypes) : [],
			// A selection-only Audacity effect already explains itself in the
			// runtime, because the realtime rack has to refuse it with a reason.
			selectionOnlyReason: capability && !capability.live ? capability.reason : null,
			parameters: audacity
				? audacityParameterRows(type, audacity, context)
				: localParameterRows(type, local, context),
		};
	}).sort((left, right) => compareText(left.label, right.label) || compareText(left.type, right.type));
}

export function renderAudioEffectReference(context) {
	const { products, audacitySource, staffPadSource } = context;
	assertProducts(products);
	if (!audacitySource?.commit || !audacitySource?.version) throw new TypeError('Audacity effect provenance is required.');
	if (!staffPadSource?.commit || !staffPadSource?.version) throw new TypeError('StaffPad provenance is required.');
	const effects = collectEffects(context);
	const enabledProducts = products.filter((product) => product.capabilities?.audioEffects === true);
	if (enabledProducts.length === 0) throw new Error('No product profile enables audio effects.');

	const inventory = table(
		['Effect', 'Effect ID', 'Category', 'Realtime rack', 'Selection', 'Notes'],
		effects.map((effect) => [
			effect.label,
			`\`${effect.type}\``,
			effect.category,
			effect.rack ? 'Yes' : 'No',
			effect.selection ? 'Yes' : 'No',
			effect.notes.join('; ') || '—',
		]),
	);
	const selectionOnly = effects.filter((effect) => effect.selectionOnlyReason);
	const parameterRows = effects.flatMap((effect) => effect.parameters
		.map((row) => [effect.label, `\`${effect.type}\``, ...row]));

	const sections = [
		`Audio effects are registered by ${productSentence(enabledProducts)}. Effects whose ID begins with \`audacity-\` are adapted from Audacity ${audacitySource.version} at [\`${audacitySource.commit.slice(0, 12)}\`](${audacitySource.url}); the pitch and tempo effects use the StaffPad time and pitch library pinned to Audacity ${staffPadSource.version} at [\`${staffPadSource.commit.slice(0, 12)}\`](${staffPadSource.url}). Every other effect is written for this repository.`,
		'',
		'“Realtime rack” means the effect can sit in a track or master rack and process audio while it plays. “Selection” means the effect can be previewed and applied destructively to a selected range. An effect can do both.',
		'',
		'## Effects',
		'',
		inventory,
		'',
		'## Why some effects are selection-only',
		'',
		'These effects cannot be a realtime insert, because each one needs more of the selection than a live block gives it.',
		'',
		table(
			['Effect', 'Effect ID', 'Reason'],
			selectionOnly.map((effect) => [effect.label, `\`${effect.type}\``, effect.selectionOnlyReason]),
		),
		'',
		'## Parameters',
		'',
		'Defaults and limits come from the same definitions the editor validates against, so a value outside a listed range is refused rather than clamped. Each parameter is named the way the editor names it.',
		'',
		table(['Effect', 'Effect ID', 'Parameter', 'Default', 'Range', 'Unit'], parameterRows),
	];
	return page({
		title: 'Audio effects',
		description: 'Registered audio effects, where each one can run, and their parameter defaults and ranges.',
		order: 4,
		body: sections.join('\n'),
	});
}
