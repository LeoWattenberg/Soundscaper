/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The vocabulary a handbook guide or tutorial is written in.
 *
 * A guide is data: an ordered list of steps that name the same menu entries,
 * dialog fields and buttons the editor shows. The handbook renderer turns the
 * list into prose and the browser suite replays it against the built editor,
 * so a guide can only be published while the steps it describes still work.
 *
 * A step that touches example material has two facets. The procedure — the
 * menu path, the dialog, the field, the button, the outcome — is the same for
 * every reader and is what the suite verifies. The instance — which example
 * file, which stretch of which clip, how far to drag — is what the suite
 * replays, and is only ever shown to a reader in a tutorial, where a canned
 * exercise is the point. A how-to shows the reader's own material in its place,
 * through the phrase the author supplies: `what` for an import, `where` for a
 * selection, `which` for the clips to select, `as` for a value that names an
 * example, `that` for an outcome stated about one. Those phrases are required,
 * so no how-to can turn into an exercise by accident.
 */

const STEP_KINDS = Object.freeze([
	'open', 'import', 'menu', 'select-range', 'cursor', 'select-clips', 'tool', 'effect',
	'noise-profile', 'nyquist', 'analyze', 'export', 'save', 'track-menu', 'track-button',
	'add-track', 'play', 'generate', 'marker', 'check', 'note', 'rack-effect',
	'open-audacity-project', 'export-project', 'open-project-file', 'resample', 'drag-clip', 'mix-render',
	'contrast', 'macro', 'play-at-speed',
]);

const CONTRAST_ROLES = new Set(['foreground', 'background']);

const KIND_SET = new Set(STEP_KINDS);
const FACETS = new Set(['howto', 'tutorial']);
const EXAMPLE_VALUE = /^guide-/u;

function phrase(extras, key, kind, { required = true, list = false } = {}) {
	const value = extras[key];
	if (value === undefined || value === null) {
		if (required) throw new TypeError(`A ${kind} step needs a reader-facing \`${key}\` phrase.`);
		return null;
	}
	if (list) {
		if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
			throw new TypeError(`The \`${key}\` phrase of a ${kind} step must be a list of strings.`);
		}
		return Object.freeze([...value]);
	}
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`The \`${key}\` phrase of a ${kind} step must be a string.`);
	return value;
}

function step(data, extras = {}, phraseKeys = []) {
	const allowed = new Set(['why', 'see', ...phraseKeys]);
	for (const key of Object.keys(extras)) {
		if (!allowed.has(key)) throw new TypeError(`A ${data.kind} step does not take \`${key}\`.`);
	}
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

/** Import an example recording; `what` says what the reader imports in its place. */
export function importAudio(fixture, extras = {}) {
	if (typeof fixture !== 'string' || fixture.length === 0) throw new TypeError('An import step needs a fixture id.');
	return step({ kind: 'import', fixture, what: phrase(extras, 'what', 'import') }, extras, ['what']);
}

/**
 * Mix the selected tracks with the Mix & Render dialog's defaults. Turning off
 * `replaceOriginals` keeps the source tracks and adds the mix beside them, the
 * way Audacity's Mix and Render to New Track did.
 */
export function mixRender({ replaceOriginals = true } = {}, extras) {
	if (typeof replaceOriginals !== 'boolean') throw new TypeError('A mix-render step says whether to replace the originals with true or false.');
	return step({ kind: 'mix-render', replaceOriginals }, extras);
}

/** Measure the current selection as the foreground or the background in the Contrast panel. */
export function contrast(role, extras) {
	if (!CONTRAST_ROLES.has(role)) throw new RangeError('A contrast step measures the selection as foreground or background.');
	return step({ kind: 'contrast', role }, extras);
}

/**
 * Build a macro in the Macro manager from the named effects, in order, and run
 * it on the current selection. Effects are named the way the effect picker
 * lists them and keep their default settings.
 */
export function macro({ name, effects }, extras) {
	if (typeof name !== 'string' || name.length === 0) throw new TypeError('A macro step needs the macro name.');
	if (!Array.isArray(effects) || effects.length === 0 || effects.some((effect) => typeof effect !== 'string' || effect.length === 0)) {
		throw new TypeError('A macro step needs the names of the effects it chains.');
	}
	return step({ kind: 'macro', name, effects: Object.freeze([...effects]) }, extras);
}

/** Set the transport's playback speed, play at that speed, then pause. */
export function playAtSpeed(rate, extras) {
	if (typeof rate !== 'number' || !(rate >= 0.5 && rate <= 2) || rate === 1) {
		throw new RangeError('A play-at-speed step needs a rate from 0.5 to 2 other than 1.');
	}
	return step({ kind: 'play-at-speed', rate }, extras);
}

/** Choose a command from the application menu bar, given the labels along its path. */
export function menu(path, extras) {
	return step({ kind: 'menu', path: requireLabelPath(path, 'menu') }, extras);
}

/** Select a time range, as fractions of the most recently imported clip; `where` says which range a reader selects. */
export function selectRange(from, to, extras = {}) {
	requireFraction(from, 'The selection start');
	requireFraction(to, 'The selection end');
	if (to <= from) throw new RangeError('A selection must end after it starts.');
	return step({ kind: 'select-range', from, to, where: phrase(extras, 'where', 'select-range') }, extras, ['where']);
}

/** Place the edit cursor by clicking in the clip; `where` says where a reader clicks. */
export function cursor(fraction, extras = {}) {
	return step({ kind: 'cursor', fraction: requireFraction(fraction, 'The cursor position'), where: phrase(extras, 'where', 'cursor') }, extras, ['where']);
}

/** Select whole clips by their name bars; `which` names each one the way a reader knows it. */
export function selectClips(fixtures, extras = {}) {
	if (!Array.isArray(fixtures) || fixtures.length === 0 || fixtures.some((id) => typeof id !== 'string' || id.length === 0)) {
		throw new TypeError('A select-clips step needs the fixture ids of the clips to select.');
	}
	const which = phrase(extras, 'which', 'select-clips', { list: true });
	if (which.length !== fixtures.length) throw new RangeError('A select-clips step needs one `which` phrase per clip.');
	return step({ kind: 'select-clips', fixtures: Object.freeze([...fixtures]), which }, extras, ['which']);
}

/** Press a toolbar button by its name; tools such as the split tool toggle. */
export function tool(name, extras) {
	if (typeof name !== 'string' || name.length === 0) throw new TypeError('A tool step needs the button name.');
	return step({ kind: 'tool', name }, extras);
}

/**
 * Apply a selection effect from the Effect menu. Settings name dialog fields
 * by their visible label: `{ label, value }` for a number, `{ label, checked }`
 * for a checkbox and `{ label, option }` for a dropdown; an option that names
 * an example, such as a track, also needs `as`, the way a reader knows it. An
 * effect with no settings of its own applies as soon as it is chosen, which
 * `direct` records.
 */
export function effect({ group, name, settings = [], direct = false }, extras) {
	if (typeof group !== 'string' || typeof name !== 'string') throw new TypeError('An effect step needs a submenu and an effect name.');
	if (!Array.isArray(settings)) throw new TypeError('Effect settings must be a list.');
	if (direct && settings.length > 0) throw new RangeError('A directly applied effect has no settings to change.');
	for (const setting of settings) {
		if (typeof setting?.label !== 'string') throw new TypeError('Every effect setting needs a label.');
		const forms = ['value', 'checked', 'option'].filter((key) => key in setting);
		if (forms.length !== 1) throw new TypeError(`Effect setting ${setting.label} must give exactly one of value, checked or option.`);
		if ('option' in setting && EXAMPLE_VALUE.test(setting.option) && typeof setting.as !== 'string') {
			throw new TypeError(`Effect setting ${setting.label} names an example; say what a reader chooses with \`as\`.`);
		}
	}
	return step({ kind: 'effect', group, name, settings: Object.freeze(settings.map((setting) => Object.freeze({ ...setting }))), direct }, extras);
}

/** Capture the Noise Reduction profile from the current selection. */
export function noiseProfile(extras) {
	return step({ kind: 'noise-profile' }, extras);
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

/** Export the project through File → Export audio in the named format; `mode` picks a non-default export mode. */
export function exportAudio({ format, extension, mode = null }, extras) {
	if (typeof format !== 'string' || typeof extension !== 'string') throw new TypeError('An export step needs a format label and a file extension.');
	if (mode !== null && typeof mode !== 'string') throw new TypeError('An export output choice must be its dropdown label.');
	return step({ kind: 'export', format, extension, mode }, extras);
}

/** Save the project to the local project library through File → Save project. */
export function save(extras) {
	return step({ kind: 'save' }, extras);
}

/** Choose a command from a track's own menu in the track header. */
export function trackMenu(path, extras) {
	return step({ kind: 'track-menu', path: requireLabelPath(path, 'track menu') }, extras);
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

/** Add a realtime effect to the most recently added track's effect rack. */
export function rackEffect(name, extras) {
	if (typeof name !== 'string' || name.length === 0) throw new TypeError('A rack-effect step needs the effect name.');
	return step({ kind: 'rack-effect', name }, extras);
}

/** Open the example Audacity project through File → Audacity projects. */
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

/** Drag the most recently imported clip later by its name bar; `where` says where a reader drags theirs. */
export function dragClip(seconds, extras = {}) {
	if (!Number.isInteger(seconds) || seconds <= 0) throw new TypeError('A drag-clip step needs a whole number of seconds to move by.');
	return step({ kind: 'drag-clip', seconds, where: phrase(extras, 'where', 'drag-clip') }, extras, ['where']);
}

/**
 * State what the project should now contain; the browser suite asserts it. An
 * expectation about an example clip's position (`startsAt`, `moved`) needs
 * `that`, the outcome as a reader would see it on their own material.
 */
export function check({
	clips = null, tracks = null, clip = null, startsAt = null, moved = null, track = null, loop = null, muted = null, panel = null,
}, extras = {}) {
	if ([clips, tracks, clip, startsAt, moved, track, loop, muted, panel].every((value) => value === null)) {
		throw new TypeError('A check step must state at least one expectation.');
	}
	if (startsAt !== null && (typeof startsAt.fixture !== 'string' || typeof startsAt.seconds !== 'number')) {
		throw new TypeError('A start-time check names a fixture and a whole number of seconds.');
	}
	if (muted !== null && muted !== 'all' && muted !== 'none') throw new TypeError('A muted check expects all tracks muted or none.');
	if (panel !== null && (typeof panel.id !== 'string' || typeof panel.name !== 'string')) {
		throw new TypeError('A panel check names the workspace panel by id and by the name a reader sees.');
	}
	const that = phrase(extras, 'that', 'check', { required: startsAt !== null || moved !== null });
	return step({
		kind: 'check', clips, tracks, clip, startsAt: startsAt && Object.freeze({ ...startsAt }), moved, track, loop, muted,
		panel: panel && Object.freeze({ ...panel }), that,
	}, extras, ['that']);
}

/** Prose with nothing to replay. */
export function note(text) {
	if (typeof text !== 'string' || text.length === 0) throw new TypeError('A note needs text.');
	return step({ kind: 'note', text });
}

export function isStepKind(kind) {
	return KIND_SET.has(kind);
}

function validateSteps(id, steps, fixtures) {
	if (!Array.isArray(steps) || steps.length === 0) throw new TypeError(`${id} needs steps.`);
	if (steps[0].kind !== 'open') throw new RangeError(`${id} must start by opening the editor.`);
	for (const [index, entry] of steps.entries()) {
		if (!isStepKind(entry?.kind)) throw new RangeError(`${id} step ${String(index + 1)} has unknown kind ${String(entry?.kind)}.`);
		if (entry.kind === 'import' && !(entry.fixture in fixtures)) throw new RangeError(`${id} imports unknown example ${entry.fixture}.`);
		if (entry.kind === 'select-clips' && entry.fixtures.some((fixture) => !(fixture in fixtures))) {
			throw new RangeError(`${id} selects a clip from an unknown example.`);
		}
	}
}

function validateHeading(document, kind) {
	if (!document || typeof document !== 'object') throw new TypeError(`A ${kind} must be an object.`);
	for (const key of ['id', 'title', 'description', 'intro']) {
		if (typeof document[key] !== 'string' || document[key].length === 0) throw new TypeError(`${kind} ${String(document.id)} needs a ${key}.`);
	}
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(document.id)) throw new RangeError(`${kind} id ${document.id} must be a kebab-case slug.`);
}

function validateStringList(document, key, kind) {
	if (!Array.isArray(document[key]) || document[key].some((item) => typeof item !== 'string' || item.length === 0)) {
		throw new TypeError(`${kind} ${document.id} ${key} must be strings.`);
	}
}

/** Throw unless a how-to guide has every field the renderer and the browser suite rely on. */
export function validateGuide(guide, fixtures) {
	validateHeading(guide, 'Guide');
	if (typeof guide.audacity !== 'string' || guide.audacity.length === 0) throw new TypeError(`Guide ${guide.id} needs an audacity counterpart.`);
	validateSteps(`Guide ${guide.id}`, guide.steps, fixtures);
	validateStringList(guide, 'tips', 'Guide');
	return guide;
}

/** Throw unless a tutorial states what it teaches, walks through it, and says where to go next. */
export function validateTutorial(tutorial, fixtures) {
	validateHeading(tutorial, 'Tutorial');
	validateSteps(`Tutorial ${tutorial.id}`, tutorial.steps, fixtures);
	validateStringList(tutorial, 'learn', 'Tutorial');
	validateStringList(tutorial, 'next', 'Tutorial');
	if (!tutorial.steps.some((entry) => entry.kind === 'import')) throw new RangeError(`Tutorial ${tutorial.id} must work on an example recording.`);
	return tutorial;
}

const bold = (text) => `**${text}**`;
const menuPath = (path) => bold(path.join(' → '));

function describeSetting(setting, facet) {
	if ('value' in setting) return `set ${bold(setting.label)} to \`${setting.value}\``;
	if ('option' in setting) {
		const choice = facet === 'howto' && setting.as ? setting.as : bold(setting.option);
		return `choose ${choice} for ${bold(setting.label)}`;
	}
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

function describeClips(entry, facet, fixture) {
	const names = facet === 'howto'
		? entry.which
		: entry.fixtures.map((id) => `\`${fixture(id).file}\``);
	const [first, ...rest] = names;
	if (rest.length === 0) return `Click the name bar of ${first} to select it.`;
	return `Click the name bar of ${first}, then hold Shift and click the name bar of ${listPhrases(rest)}, so ${rest.length === 1 ? 'both' : 'all of them'} are selected.`;
}

function describeCheck(entry, facet, fixture) {
	if (facet === 'howto' && entry.that) return entry.that;
	const parts = [];
	if (entry.clips !== null) parts.push(`${String(entry.clips)} clip${entry.clips === 1 ? '' : 's'}`);
	if (entry.tracks !== null) parts.push(`${String(entry.tracks)} track${entry.tracks === 1 ? '' : 's'}`);
	if (entry.clip !== null) parts.push(`a clip named ${bold(entry.clip)}`);
	if (entry.startsAt !== null) parts.push(`the \`${fixture(entry.startsAt.fixture).file}\` clip starting at ${String(entry.startsAt.seconds)} s`);
	if (entry.moved !== null) parts.push('the clip starting later than 0 s');
	if (entry.track !== null) parts.push(`a track named ${bold(entry.track)}`);
	if (entry.loop !== null) parts.push(`the ${bold('Loop selection')} button lit`);
	if (entry.muted !== null) parts.push(entry.muted === 'all' ? `every track’s ${bold('Mute')} button lit` : 'no track muted');
	if (entry.panel !== null) parts.push(`the ${bold(entry.panel.name)} panel open`);
	return `The project now shows ${listPhrases(parts)}.`;
}

/**
 * The imperative sentence a step turns into, in Markdown. `fixture` resolves an
 * example id to its `{ file, description }`; `facet` chooses whether example
 * material is named (`tutorial`) or described the way a reader's own would be
 * (`howto`).
 */
export function describeStep(entry, { fixture, facet = 'howto' }) {
	if (typeof fixture !== 'function') throw new TypeError('The example resolver is required.');
	if (!FACETS.has(facet)) throw new RangeError(`Unknown describe facet ${String(facet)}.`);
	const howto = facet === 'howto';
	switch (entry.kind) {
		case 'open':
			return 'Open Soundscaper. A new, empty project is ready as soon as the editor loads.';
		case 'import': {
			const what = howto ? entry.what : `\`${fixture(entry.fixture).file}\` — ${fixture(entry.fixture).description}`;
			return `Choose ${menuPath(['File', 'Import audio'])} and pick ${what}. The file lands as a clip on its own track.`;
		}
		case 'menu':
			return `Choose ${menuPath(entry.path)}.`;
		case 'mix-render': {
			const originals = entry.replaceOriginals
				? `leave ${bold('Mix down')}, ${bold('Render effects')} and ${bold('Replace originals')} checked`
				: `leave ${bold('Mix down')} and ${bold('Render effects')} checked, turn off ${bold('Replace originals')}`;
			return `Choose ${menuPath(['Tracks', 'Mix & Render'])}. In the ${bold('Mix & Render')} dialog, ${originals}, choose ${bold('Stereo')} for ${bold('Mix down to')}, then press ${bold('Mix & Render')}.`;
		}
		case 'contrast': {
			const button = entry.role === 'foreground' ? 'Measure foreground' : 'Measure background';
			const report = entry.role === 'foreground'
				? ' The panel reports the foreground level, the background level and the difference between them.'
				: ' The panel keeps the selection’s level as the background.';
			return `In the ${bold('Contrast')} panel, press ${bold(button)}.${report}`;
		}
		case 'macro': {
			const chain = listPhrases(entry.effects.map((effect) => bold(effect)));
			return `Choose ${menuPath(['Tools', 'Macro manager'])} and press ${bold('New macro')}. Type \`${entry.name}\` into ${bold('Macro name')}. Press ${bold('Add effect')} and choose ${chain}, pressing ${bold('Add effect')} again for each one. Press ${bold('Run macro')}; the dialog reports that the macro was applied. Press ${bold('Close')}.`;
		}
		case 'play-at-speed':
			return `Press ${bold('Play options')} beside the Play button, set ${bold('Playback speed')} to \`${String(entry.rate)}×\`, and press Escape to close the options. The Play button now reads ${bold('Play at speed')}; press it to listen, then press ${bold('Pause play at speed')}.`;
		case 'select-range':
			return howto
				? `Drag in the ruler above the clip to select ${entry.where}.`
				: `Drag in the ruler above the clip, from ${describePoint(entry.from)} to ${describePoint(entry.to)}, to select ${entry.where}.`;
		case 'cursor':
			return `Click the waveform ${howto ? entry.where : describePosition(entry.fraction)} to put the cursor there.`;
		case 'select-clips':
			return describeClips(entry, facet, fixture);
		case 'tool':
			return `Press the ${bold(entry.name)} button in the toolbar.`;
		case 'effect': {
			const path = menuPath(['Effect', entry.group, entry.name]);
			if (entry.direct) return `Choose ${path}. The effect applies to the selection straight away.`;
			const settings = entry.settings.length > 0
				? ` In the ${bold(entry.name)} dialog, ${listPhrases(entry.settings.map((setting) => describeSetting(setting, facet)))}, then`
				: ` In the ${bold(entry.name)} dialog,`;
			return `Choose ${path}.${settings} press ${bold('Apply to selection')}.`;
		}
		case 'noise-profile':
			return `Choose ${menuPath(['Effect', 'Noise removal and repair', 'Noise Reduction'])} and press ${bold('Get noise profile')}. The status line reports that the profile is ready. Press ${bold('Close')} to leave the dialog for now.`;
		case 'nyquist': {
			const fields = entry.fields.length > 0
				? ` In the ${bold(entry.name)} dialog, ${listPhrases(entry.fields.map((field) => `set ${bold(field.label)} to \`${field.value}\``))}, then`
				: ` In the ${bold(entry.name)} dialog,`;
			const report = entry.menu === 'Analyze' ? ` The dialog reports what it found; press ${bold('Close')} to dismiss it.` : '';
			return `Choose ${menuPath([entry.menu, 'Nyquist', entry.name])}.${fields} press ${bold('Apply')}.${report}`;
		}
		case 'analyze':
			return `Choose ${menuPath(['Analyze', entry.name])}. The ${bold(entry.name)} panel opens.`;
		case 'export': {
			const mode = entry.mode ? ` set ${bold('Output')} to ${bold(entry.mode)},` : '';
			return `Choose ${menuPath(['File', 'Export audio'])}, set ${bold('Format')} to ${bold(entry.format)},${mode} and press ${bold('Export')}. The file downloads as soon as the render finishes, and its link stays in the dialog.`;
		}
		case 'save':
			return `Choose ${menuPath(['File', 'Save project'])}. The save indicator in the status bar shows the project is saved.`;
		case 'track-menu':
			return `Open the track's menu from the ${bold('Track menu')} button in its header and choose ${menuPath(entry.path)}.`;
		case 'track-button':
			return `Press ${bold(entry.name)} in the track's header.`;
		case 'add-track':
			return `Press ${bold('Add track')} above the track list and choose ${bold(entry.type)}.`;
		case 'play':
			return `Press ${bold('Play')} to listen, then ${bold('Stop')}.`;
		case 'generate': {
			const fields = entry.fields.length > 0
				? ` In the ${bold(entry.name)} dialog, ${listPhrases(entry.fields.map((field) => `set ${bold(field.label)} to \`${field.value}\``))}, then`
				: ` In the ${bold(entry.name)} dialog,`;
			return `Choose ${menuPath(['Generate', entry.name])}.${fields} press ${bold('Generate')}.`;
		}
		case 'marker':
			return `With the Markers panel open (${menuPath(['View', 'Panels', 'Markers'])} shows it), press ${bold('Add marker at playhead')}. Press Enter on the new marker, type \`${entry.name}\` and press Enter again to name it.`;
		case 'rack-effect':
			return `Press ${bold('Effects')} in the track's header to open the Effects panel, press ${bold('Effects')} in the track's rack and choose ${bold(entry.name)}. Its settings window opens; press ${bold('Close')} when you are done with it.`;
		case 'open-audacity-project':
			return `Choose ${menuPath(['File', 'Audacity projects', 'Open Audacity project (.aup3, .aup4)'])} and pick the project. Its tracks and clips appear as they were in Audacity.`;
		case 'export-project':
			return `Choose ${menuPath(['File', 'Export project file (.sscape)'])}. The whole project downloads as one \`.sscape\` file.`;
		case 'open-project-file':
			return `Choose ${menuPath(['File', 'Open Scape project file (.sscape)'])} and pick the file. On a computer that does not have the project yet it opens directly; here, where the library already holds it, Soundscaper offers ${bold('Open as read-only copy')} — press it.`;
		case 'resample':
			return `Open the clip's menu from the ${bold('Clip menu')} button on its name bar and choose ${bold('Clip properties')}. Press ${bold('Resample')}, set the rate to \`${String(entry.rate)}\` and press ${bold('Resample')} again.`;
		case 'drag-clip':
			return howto
				? `Drag the clip by its name bar ${entry.where}.`
				: `Drag the clip by its name bar about ${String(entry.seconds)} second${entry.seconds === 1 ? '' : 's'} to the right.`;
		case 'check':
			return describeCheck(entry, facet, fixture);
		case 'note':
			return entry.text;
		default:
			throw new RangeError(`Unknown guide step kind ${String(entry.kind)}.`);
	}
}

export { STEP_KINDS };
