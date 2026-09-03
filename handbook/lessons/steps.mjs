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
	'noise-profile', 'nyquist', 'analyze', 'export', 'save', 'track-menu', 'track-button',
	'add-track', 'play', 'generate', 'marker', 'check', 'note', 'rack-effect',
	'open-audacity-project', 'export-project', 'open-project-file', 'resample', 'drag-clip', 'mix-render',
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

/** Mix selected stereo lesson tracks with the Mix & Render dialog defaults. */
export function mixRender(extras) {
	return step({ kind: 'mix-render' }, extras);
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

/**
 * Run a bundled Nyquist plug-in from the Nyquist submenu of the Effect,
 * Generate or Analyze menu. Fields name the plug-in's inputs by label.
 */
export function nyquist({ menu: menuName, name, fields = [] }, extras) {
	if (!['Effect', 'Generate', 'Analyze'].includes(menuName)) throw new RangeError('A Nyquist step runs from the Effect, Generate or Analyze menu.');
	if (typeof name !== 'string' || name.length === 0) throw new TypeError('A Nyquist step needs the plug-in name.');
	for (const field of fields) {
		if (typeof field?.label !== 'string' || typeof field?.value !== 'string') throw new TypeError('Every Nyquist field needs a label and a value.');
	}
	return step({ kind: 'nyquist', menu: menuName, name, fields: Object.freeze(fields.map((field) => Object.freeze({ ...field }))) }, extras);
}

/** Open an analyzer from the Analyze menu; `panel` is the workspace panel it opens. */
export function analyze({ name, panel }, extras) {
	if (typeof name !== 'string' || typeof panel !== 'string') throw new TypeError('An analyze step needs the analyzer name and its panel id.');
	return step({ kind: 'analyze', name, panel }, extras);
}

/** Save the project to the local project library through File → Save project. */
export function save(extras) {
	return step({ kind: 'save' }, extras);
}

/** Press a button in the header of the most recently added track, such as Mute or Solo. */
export function trackButton(name, extras) {
	if (typeof name !== 'string' || name.length === 0) throw new TypeError('A track-button step needs the button name.');
	return step({ kind: 'track-button', name }, extras);
}

/** Add a track of the named type from the Add track button above the track list. */
export function addTrack(type, extras) {
	if (typeof type !== 'string' || type.length === 0) throw new TypeError('An add-track step needs the track type label.');
	return step({ kind: 'add-track', type }, extras);
}

/** Capture the Noise Reduction profile from the current selection. */
export function noiseProfile(extras) {
	return step({ kind: 'noise-profile' }, extras);
}

/** Export the project through File → Export audio in the named format; `mode` picks a non-default export mode. */
export function exportAudio({ format, extension, mode = null }, extras) {
	if (typeof format !== 'string' || typeof extension !== 'string') throw new TypeError('An export step needs a format label and a file extension.');
	if (mode !== null && typeof mode !== 'string') throw new TypeError('An export mode must be its dropdown label.');
	return step({ kind: 'export', format, extension, mode }, extras);
}

/** Add a realtime effect to the most recently added track's effect rack. */
export function rackEffect(name, extras) {
	if (typeof name !== 'string' || name.length === 0) throw new TypeError('A rack-effect step needs the effect name.');
	return step({ kind: 'rack-effect', name }, extras);
}

/** Open the lesson's example Audacity project through File → Audacity projects. */
export function openAudacityProject(extras) {
	return step({ kind: 'open-audacity-project' }, extras);
}

/** Export the project as a portable project file. */
export function exportProject(extras) {
	return step({ kind: 'export-project' }, extras);
}

/** Open the project file the previous export step produced. */
export function openProjectFile(extras) {
	return step({ kind: 'open-project-file' }, extras);
}

/** Resample the most recently imported clip from its Clip properties. */
export function resample(rate, extras) {
	if (!Number.isInteger(rate) || rate <= 0) throw new TypeError('A resample step needs a whole sample rate in hertz.');
	return step({ kind: 'resample', rate }, extras);
}

/** Drag the most recently imported clip later by its name bar, in whole seconds. */
export function dragClip(seconds, extras) {
	if (!Number.isInteger(seconds) || seconds <= 0) throw new TypeError('A drag-clip step needs a whole number of seconds to move by.');
	return step({ kind: 'drag-clip', seconds }, extras);
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
export function check({ clips = null, tracks = null, clip = null, startsAt = null, moved = null, track = null, loop = null }, extras) {
	if ([clips, tracks, clip, startsAt, moved, track, loop].every((value) => value === null)) throw new TypeError('A check step must state at least one expectation.');
	if (startsAt !== null && (typeof startsAt.fixture !== 'string' || typeof startsAt.seconds !== 'number')) {
		throw new TypeError('A start-time check names a fixture and a whole number of seconds.');
	}
	return step({ kind: 'check', clips, tracks, clip, startsAt: startsAt && Object.freeze({ ...startsAt }), moved, track, loop }, extras);
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
		case 'mix-render':
			return `Choose ${menuPath(['Tracks', 'Mix & Render'])}. In the ${bold('Mix & Render')} dialog, leave ${bold('Mix down to stereo')}, ${bold('Render effects')} and ${bold('Replace originals')} checked, then press ${bold('Mix & Render')}.`;
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
		case 'nyquist': {
			const fields = entry.fields.length > 0
				? ` In the ${bold(entry.name)} dialog, ${listPhrases(entry.fields.map((field) => `set ${bold(field.label)} to \`${field.value}\``))}, then`
				: ` In the ${bold(entry.name)} dialog,`;
			const report = entry.menu === 'Analyze' ? ` The dialog reports what it found; press ${bold('Close')} to dismiss it.` : '';
			return `Choose ${menuPath([entry.menu, 'Nyquist', entry.name])}.${fields} press ${bold('Apply')}.${report}`;
		}
		case 'analyze':
			return `Choose ${menuPath(['Analyze', entry.name])}. The ${bold(entry.name)} panel opens with the result.`;
		case 'save':
			return `Choose ${menuPath(['File', 'Save project'])}. The save indicator in the status bar shows the project is saved.`;
		case 'track-button':
			return `Press ${bold(entry.name)} in the track's header.`;
		case 'add-track':
			return `Press ${bold('Add track')} above the track list and choose ${bold(entry.type)}.`;
		case 'noise-profile':
			return `Choose ${menuPath(['Effect', 'Noise removal and repair', 'Noise Reduction'])} and press ${bold('Get noise profile')}. The status line reports that the profile is ready. Press ${bold('Close')} to leave the dialog for now.`;
		case 'export': {
			const mode = entry.mode ? ` set ${bold('Mode')} to ${bold(entry.mode)},` : '';
			return `Choose ${menuPath(['File', 'Export audio'])},${mode} set ${bold('Format')} to ${bold(entry.format)} and press ${bold('Start export')}. When the render finishes, a download link for the \`.${entry.extension}\` file appears in the dialog.`;
		}
		case 'rack-effect':
			return `Press ${bold('Effects')} in the track's header to open the Effects panel, press ${bold('Effects')} in the track's rack and choose ${bold(entry.name)}. Its settings window opens; press ${bold('Close')} when you are done with it.`;
		case 'open-audacity-project':
			return `Choose ${menuPath(['File', 'Audacity projects', 'Open Audacity project (.aup3, .aup4)'])} and pick the project. This lesson uses a small example project. Its tracks and clips appear as they were in Audacity.`;
		case 'export-project':
			return `Choose ${menuPath(['File', 'Export project file (.sscape)'])}. The whole project downloads as one \`.sscape\` file.`;
		case 'open-project-file':
			return `Choose ${menuPath(['File', 'Open Scape project file (.sscape)'])} and pick the file. On a computer that does not have the project yet it opens directly; here, where the library already holds it, Soundscaper offers ${bold('Open as read-only copy')} — press it.`;
		case 'resample':
			return `Open the clip's menu from the ${bold('Clip menu')} button on its name bar and choose ${bold('Clip properties')}. Press ${bold('Resample')}, set the rate to \`${String(entry.rate)}\` and press ${bold('Resample')} again.`;
		case 'drag-clip':
			return `Drag the clip by its name bar about ${String(entry.seconds)} second${entry.seconds === 1 ? '' : 's'} to the right.`;
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
			if (entry.startsAt !== null) parts.push(`the \`${fixtureFile(entry.startsAt.fixture)}\` clip starting at ${String(entry.startsAt.seconds)} s`);
			if (entry.moved !== null) parts.push('the clip starting later than 0 s');
			if (entry.track !== null) parts.push(`a track named ${bold(entry.track)}`);
			if (entry.loop !== null) parts.push(`the ${bold('Loop selection')} button lit`);
			return `The project now shows ${listPhrases(parts)}.`;
		}
		case 'note':
			return entry.text;
		default:
			throw new RangeError(`Unknown lesson step kind ${String(entry.kind)}.`);
	}
}

export { STEP_KINDS };
