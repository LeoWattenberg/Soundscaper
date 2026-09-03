/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The vocabulary a handbook lesson is written in.
 *
 * A lesson is data: an ordered list of steps that name the same menu entries,
 * dialog fields and buttons the editor shows. The handbook renderer turns the
 * list into prose and the browser suite replays it against the built editor,
 * so a lesson can only be published while the steps it describes still work.
 * Every sentence a reader sees about a control is produced here, from the same
 * value the browser suite clicks, which is what keeps the two from drifting.
 */

const STEP_KINDS = Object.freeze([
	'open', 'import', 'menu', 'select-range', 'cursor', 'select-clips', 'tool', 'effect',
	'noise-profile', 'export', 'track-menu', 'play', 'generate', 'marker', 'check', 'note',
]);

const KIND_SET = new Set(STEP_KINDS);

function step(data, extras = {}) {
	const { why = null, see = null } = extras;
	if (why !== null && typeof why !== 'string') throw new TypeError('A step explanation must be a string.');
	if (see !== null && typeof see !== 'string') throw new TypeError('A step observation must be a string.');
	return Object.freeze({ ...data, why, see });
}

function requireLabelPath(path, kind) {
	if (!Array.isArray(path) || path.length === 0 || path.some((label) => typeof label !== 'string' || label.length === 0)) {
		throw new TypeError(`A ${kind} step needs a non-empty list of menu labels.`);
	}
	return Object.freeze([...path]);
}

function requireFraction(value, name) {
	if (typeof value !== 'number' || !(value >= 0 && value <= 1)) throw new RangeError(`${name} must be a fraction from 0 to 1.`);
	return value;
}

/** Open the editor with a fresh, empty project. */
export function open(extras) {
	return step({ kind: 'open' }, extras);
}

/** Import one of the lesson example files, named by its fixture id. */
export function importAudio(fixture, extras) {
	if (typeof fixture !== 'string' || fixture.length === 0) throw new TypeError('An import step needs a fixture id.');
	return step({ kind: 'import', fixture }, extras);
}

/** Choose a command from the application menu bar, given the labels along its path. */
export function menu(path, extras) {
	return step({ kind: 'menu', path: requireLabelPath(path, 'menu') }, extras);
}

/** Select a time range, as fractions of the most recently imported clip. */
export function selectRange(from, to, extras) {
	requireFraction(from, 'The selection start');
	requireFraction(to, 'The selection end');
	if (to <= from) throw new RangeError('A selection must end after it starts.');
	return step({ kind: 'select-range', from, to }, extras);
}

/** Place the edit cursor by clicking in the clip, at a fraction of its length. */
export function cursor(fraction, extras) {
	return step({ kind: 'cursor', fraction: requireFraction(fraction, 'The cursor position') }, extras);
}

/** Select whole clips by their name bars: the first with a click, the rest with Shift held. */
export function selectClips(fixtures, extras) {
	if (!Array.isArray(fixtures) || fixtures.length === 0 || fixtures.some((id) => typeof id !== 'string' || id.length === 0)) {
		throw new TypeError('A select-clips step needs the fixture ids of the clips to select.');
	}
	return step({ kind: 'select-clips', fixtures: Object.freeze([...fixtures]) }, extras);
}

/** Press a toolbar button by its name; tools such as the split tool toggle. */
export function tool(name, extras) {
	if (typeof name !== 'string' || name.length === 0) throw new TypeError('A tool step needs the button name.');
	return step({ kind: 'tool', name }, extras);
}

/**
 * Apply a selection effect from the Effect menu. Settings name dialog fields
 * by their visible label: `{ label, value }` for a number, `{ label, checked }`
 * for a checkbox and `{ label, option }` for a dropdown. An effect with no
 * settings of its own applies as soon as it is chosen, which `direct` records.
 */
export function effect({ group, name, settings = [], direct = false }, extras) {
	if (typeof group !== 'string' || typeof name !== 'string') throw new TypeError('An effect step needs a submenu and an effect name.');
	if (!Array.isArray(settings)) throw new TypeError('Effect settings must be a list.');
	if (direct && settings.length > 0) throw new RangeError('A directly applied effect has no settings to change.');
	for (const setting of settings) {
		if (typeof setting?.label !== 'string') throw new TypeError('Every effect setting needs a label.');
		const forms = ['value', 'checked', 'option'].filter((key) => key in setting);
		if (forms.length !== 1) throw new TypeError(`Effect setting ${setting.label} must give exactly one of value, checked or option.`);
	}
	return step({ kind: 'effect', group, name, settings: Object.freeze(settings.map((setting) => Object.freeze({ ...setting }))), direct }, extras);
}

/** Capture the Noise Reduction profile from the current selection. */
export function noiseProfile(extras) {
	return step({ kind: 'noise-profile' }, extras);
}

/** Export the project through File → Export audio in the named format. */
export function exportAudio({ format, extension }, extras) {
	if (typeof format !== 'string' || typeof extension !== 'string') throw new TypeError('An export step needs a format label and a file extension.');
	return step({ kind: 'export', format, extension }, extras);
}

/** Choose a command from a track's own menu in the track header. */
export function trackMenu(path, extras) {
	return step({ kind: 'track-menu', path: requireLabelPath(path, 'track menu') }, extras);
}

/** Play the project from the start, then stop. */
export function play(extras) {
	return step({ kind: 'play' }, extras);
}

/** Run a generator from the Generate menu. Fields name dialog inputs by label. */
export function generate({ name, fields = [] }, extras) {
	if (typeof name !== 'string') throw new TypeError('A generate step needs the generator name.');
	for (const field of fields) {
		if (typeof field?.field !== 'string' || typeof field?.label !== 'string' || typeof field?.value !== 'string') {
			throw new TypeError('Every generator field needs a field id, a label and a value.');
		}
	}
	return step({ kind: 'generate', name, fields: Object.freeze(fields.map((field) => Object.freeze({ ...field }))) }, extras);
}

/** Add a marker at the playhead from the Markers panel and give it a name. */
export function marker(name, extras) {
	if (typeof name !== 'string' || name.length === 0) throw new TypeError('A marker step needs a name.');
	return step({ kind: 'marker', name }, extras);
}

/** State what the project should now contain; the browser suite asserts it. */
export function check({ clips = null, tracks = null, clip = null }, extras) {
	if (clips === null && tracks === null && clip === null) throw new TypeError('A check step must state at least one expectation.');
	return step({ kind: 'check', clips, tracks, clip }, extras);
}

/** Prose with nothing to replay. */
export function note(text) {
	if (typeof text !== 'string' || text.length === 0) throw new TypeError('A note needs text.');
	return step({ kind: 'note', text });
}

export function isStepKind(kind) {
	return KIND_SET.has(kind);
}

/** Throw unless a lesson has every field the renderer and the browser suite rely on. */
export function validateLesson(lesson, fixtures) {
	if (!lesson || typeof lesson !== 'object') throw new TypeError('A lesson must be an object.');
	for (const key of ['id', 'title', 'description', 'audacity', 'intro']) {
		if (typeof lesson[key] !== 'string' || lesson[key].length === 0) throw new TypeError(`Lesson ${String(lesson.id)} needs a ${key}.`);
	}
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(lesson.id)) throw new RangeError(`Lesson id ${lesson.id} must be a kebab-case slug.`);
	if (!Array.isArray(lesson.steps) || lesson.steps.length === 0) throw new TypeError(`Lesson ${lesson.id} needs steps.`);
	if (lesson.steps[0].kind !== 'open') throw new RangeError(`Lesson ${lesson.id} must start by opening the editor.`);
	if (!Array.isArray(lesson.tips) || lesson.tips.some((tip) => typeof tip !== 'string')) throw new TypeError(`Lesson ${lesson.id} tips must be strings.`);
	for (const [index, entry] of lesson.steps.entries()) {
		if (!isStepKind(entry?.kind)) throw new RangeError(`Lesson ${lesson.id} step ${String(index + 1)} has unknown kind ${String(entry?.kind)}.`);
		if (entry.kind === 'import' && !(entry.fixture in fixtures)) {
			throw new RangeError(`Lesson ${lesson.id} imports unknown example ${entry.fixture}.`);
		}
		if (entry.kind === 'select-clips' && entry.fixtures.some((id) => !(id in fixtures))) {
			throw new RangeError(`Lesson ${lesson.id} selects a clip from an unknown example.`);
		}
	}
	return lesson;
}

const bold = (text) => `**${text}**`;
const menuPath = (path) => bold(path.join(' → '));

function describeSetting(setting) {
	if ('value' in setting) return `set ${bold(setting.label)} to \`${setting.value}\``;
	if ('option' in setting) return `choose ${bold(setting.option)} for ${bold(setting.label)}`;
	return `${setting.checked ? 'turn on' : 'turn off'} ${bold(setting.label)}`;
}

function listPhrases(phrases) {
	if (phrases.length <= 1) return phrases.join('');
	return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
}

/** A point in the clip as a noun phrase: "the start", "the halfway point". */
function describePoint(fraction) {
	if (fraction === 0) return 'the start';
	if (fraction === 1) return 'the end';
	if (fraction === 0.5) return 'the halfway point';
	if (fraction === 0.25) return 'the quarter point';
	if (fraction === 0.75) return 'the three-quarter point';
	return `the ${String(Math.round(fraction * 100))}% mark`;
}

/** A point in the clip as an adverbial: "at the start", "halfway through". */
function describePosition(fraction) {
	if (fraction === 0) return 'at the start';
	if (fraction === 1) return 'at the end';
	if (fraction === 0.5) return 'halfway through';
	if (fraction === 0.25) return 'a quarter of the way through';
	if (fraction === 0.75) return 'three quarters of the way through';
	return `about ${String(Math.round(fraction * 100))}% of the way through`;
}

/**
 * The imperative sentence a step turns into, in Markdown. `fixtureFile` maps a
 * fixture id to the example file name the reader is told to import.
 */
export function describeStep(entry, { fixtureFile }) {
	switch (entry.kind) {
		case 'open':
			return 'Open Soundscaper. A new, empty project is ready as soon as the editor loads.';
		case 'import':
			return `Choose ${menuPath(['File', 'Import audio'])} and pick your recording. This lesson uses \`${fixtureFile(entry.fixture)}\`. The file lands as a clip on its own track.`;
		case 'menu':
			return `Choose ${menuPath(entry.path)}.`;
		case 'select-range':
			return `Drag in the ruler above the clip, from ${describePoint(entry.from)} to ${describePoint(entry.to)} of the clip, to select that range.`;
		case 'cursor':
			return `Click the waveform ${describePosition(entry.fraction)} to put the cursor there.`;
		case 'select-clips': {
			const [first, ...rest] = entry.fixtures.map((id) => `\`${fixtureFile(id)}\``);
			if (rest.length === 0) return `Click the name bar of the ${first} clip to select it.`;
			return `Click the name bar of the ${first} clip, then hold Shift and click the name bar of ${listPhrases(rest)}, so ${rest.length === 1 ? 'both' : 'all of them'} are selected.`;
		}
		case 'tool':
			return `Press the ${bold(entry.name)} button in the toolbar.`;
		case 'effect': {
			const path = menuPath(['Effect', entry.group, entry.name]);
			if (entry.direct) return `Choose ${path}. The effect applies to the selection straight away.`;
			const settings = entry.settings.length > 0
				? ` In the ${bold(entry.name)} dialog, ${listPhrases(entry.settings.map(describeSetting))}, then`
				: ` In the ${bold(entry.name)} dialog,`;
			return `Choose ${path}.${settings} press ${bold('Apply to selection')}.`;
		}
		case 'noise-profile':
			return `Choose ${menuPath(['Effect', 'Noise removal and repair', 'Noise Reduction'])} and press ${bold('Get noise profile')}. The status line reports that the profile is ready. Press ${bold('Close')} to leave the dialog for now.`;
		case 'export':
			return `Choose ${menuPath(['File', 'Export audio'])}, set ${bold('Format')} to ${bold(entry.format)} and press ${bold('Start export')}. When the render finishes, a download link for the \`.${entry.extension}\` file appears in the dialog.`;
		case 'track-menu':
			return `Open the track's menu from the ${bold('Track menu')} button in its header and choose ${menuPath(entry.path)}.`;
		case 'play':
			return `Press ${bold('Play')} to listen, then ${bold('Stop')}.`;
		case 'generate': {
			const fields = entry.fields.length > 0
				? ` In the ${bold(entry.name)} dialog, ${listPhrases(entry.fields.map((field) => `set ${bold(field.label)} to \`${field.value}\``))}, then`
				: ` In the ${bold(entry.name)} dialog,`;
			return `Choose ${menuPath(['Generate', entry.name])}.${fields} press ${bold('Generate')}.`;
		}
		case 'marker':
			return `Choose ${menuPath(['View', 'Panels', 'Markers'])} to show the Markers panel, then press ${bold('Add marker at playhead')}. Press Enter on the new marker, type \`${entry.name}\` and press Enter again to name it.`;
		case 'check': {
			const parts = [];
			if (entry.clips !== null) parts.push(`${String(entry.clips)} clip${entry.clips === 1 ? '' : 's'}`);
			if (entry.tracks !== null) parts.push(`${String(entry.tracks)} track${entry.tracks === 1 ? '' : 's'}`);
			if (entry.clip !== null) parts.push(`a clip named ${bold(entry.clip)}`);
			return `The project now shows ${listPhrases(parts)}.`;
		}
		case 'note':
			return entry.text;
		default:
			throw new RangeError(`Unknown lesson step kind ${String(entry.kind)}.`);
	}
}

export { STEP_KINDS };
