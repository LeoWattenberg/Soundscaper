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
	deesser: 'repair',
	'multiband-compressor': 'volume',
	highpass: 'eq',
	lowpass: 'eq',
	'highpass-filter': 'eq',
	'lowpass-filter': 'eq',
	'notch-filter': 'eq',
	'shelf-filter': 'eq',
	'noise-gate': 'repair',
	'multi-tap-delay': 'delay',
	tremolo: 'modulation',
	vocoder: 'modulation',
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

const LOCAL_EFFECT_NOTES = Object.freeze({
	'multi-tap-delay': ['Finite echoes with StaffPad pitch shift; selections also offer changed-speed echoes and optional complete tails'],
	'noise-gate': ['Lookahead opens the gate before transients; rack and selection timing are compensated', 'Linked or independent channels; optional frequency-selective gating'],
	vocoder: ['Stereo uses the left channel as voice and the right as carrier; mono uses a synthesized carrier', 'Output keeps the input channel count'],
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
		factoryPresets,
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
			notes: audacity ? audacityNotes(type, audacity, staffPadEffectTypes) : LOCAL_EFFECT_NOTES[type] ?? [],
			// A selection-only Audacity effect already explains itself in the
			// runtime, because the realtime rack has to refuse it with a reason.
			selectionOnlyReason: capability && !capability.live ? capability.reason : null,
			parameters: audacity
				? audacityParameterRows(type, audacity, context)
				: localParameterRows(type, local, context),
			presets: Object.hasOwn(factoryPresets, type) ? factoryPresets[type] : [],
		};
	}).sort((left, right) => compareText(left.label, right.label) || compareText(left.type, right.type));
}

export function renderAudioEffectReference(context) {
	const { products, audacitySource, factoryPresetSource, staffPadSource } = context;
	assertProducts(products);
	if (!audacitySource?.commit || !audacitySource?.version) throw new TypeError('Audacity effect provenance is required.');
	if (!staffPadSource?.commit || !staffPadSource?.version) throw new TypeError('StaffPad provenance is required.');
	if (!factoryPresetSource?.commit || !factoryPresetSource?.version) {
		throw new TypeError('Audacity preset provenance is required.');
	}
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
		'## Regular streaming replacements {#regular-streaming-replacements}',
		'',
		'Delay, High-pass filter, Low-pass filter, Noise gate, Notch filter, Shelf filter, Tremolo and Vocoder have regular selection effects and realtime rack processors. Choose them from their Effect menu categories, or open a track’s Effects panel and choose them in its rack. Their core controls are shared across both uses; Delay also offers selection-only speed and duration controls. Existing programmatic Nyquist IDs and user plug-ins remain available, and the bundled scripts retain their pinned source and notices.',
		'',
		'Delay makes finite echoes with regular, bouncing-ball or reverse bouncing-ball spacing. Pitched echoes use the same StaffPad engine as Change Pitch, with formant preservation off, instead of moving delay heads. Rack playback keeps the incoming tempo. In the selection dialog, Pitch change effect also offers Pitch/Tempo using the Change Speed algorithm. Echo duration can keep the selected duration or include complete echoes; existing selections keep their duration by default. Rack playback and export include tails subject to the existing combined 10-second tail limit. Large echo counts or channel counts may exceed the bounded native pitch or delay memory; reduce the count, delay time, channels or sample rate. Feedback delay remains a separate rack effect.',
		'',
		'High-pass filter, Low-pass filter, Notch filter and Shelf filter include their filter release in rack playback and export, subject to the existing combined 10-second tail limit. Applying them to a selection keeps its duration.',
		'',
		'Noise gate applies attack, hold and release with configurable lookahead. By default the preview equals the attack time, allowing the gate to be fully open at the start of a word or transient; set lookahead to zero for causal gating. Playback, export and selections compensate the preview latency to preserve alignment. Gate frequencies above uses a complementary split of two one-pole filters to leave lower frequencies ungated. Channels can be linked or detected independently. There is no built-in noise-analysis mode. Rack playback and export include the split filters’ release, subject to the existing combined 10-second tail limit.',
		'',
		'Vocoder uses 10 to 240 logarithmically spaced bands from 20 Hz to just below half the sample rate, with the same band-width settings as the bundled Nyquist effect. Distance controls an eighth-order envelope low-pass filter: higher values smooth the voice envelope more slowly. In stereo, the left channel supplies the voice envelope and the right channel supplies the carrier. Mono input uses sine carriers at the band centers, mixed with optional white noise and radar pulses. Both channels preserves the voice on the left and puts vocoded audio on the right; Vocoded audio duplicates the processed signal into the first stereo pair. Additional channels pass through unchanged. The processor normalizes against its largest output peak since playback began, with a bounded gain, then applies Output gain. Unlike Nyquist’s whole-selection normalization, this cannot anticipate later peaks, so the beginning may be louder. The output keeps the input channel count. Rack playback and export include its filter and envelope release, subject to the existing combined 10-second tail limit.',
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
		// A guide links to this section from thirty pages. An id derived from the
		// heading text would change with the heading in every translation, so it is
		// written out and travels through the translator as protected text.
		'## Parameters {#parameters}',
		'',
		'Defaults and limits come from the same definitions the editor validates against, so a value outside a listed range is refused rather than clamped. Filter cutoffs must also stay below half the project sample rate, and Delay settings must fit the bounded delay buffer for the channel count. Each parameter is named the way the editor names it.',
		'',
		table(['Effect', 'Effect ID', 'Parameter', 'Default', 'Range', 'Unit'], parameterRows),
		'',
		'## Presets',
		'',
		`These effects arrive with the presets Audacity ships, transcribed from Audacity ${factoryPresetSource.version} at [\`${factoryPresetSource.commit.slice(0, 12)}\`](${factoryPresetSource.url}). Each one appears in the preset list above the effect's controls, after any preset the project saved there. A shipped preset can be applied, exported, or saved onward under a new name, and cannot be overwritten or deleted.`,
		'',
		table(
			['Effect', 'Effect ID', 'Presets'],
			effects.filter((effect) => effect.presets.length > 0).map((effect) => [
				effect.label,
				`\`${effect.type}\``,
				effect.presets.map((preset) => preset.name).join('; '),
			]),
		),
	];
	return page({
		title: 'Audio effects',
		description: 'Registered audio effects, where each one can run, and their parameter defaults and ranges.',
		order: 4,
		body: sections.join('\n'),
	});
}
