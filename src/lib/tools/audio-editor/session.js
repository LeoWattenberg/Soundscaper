import { createClipboardDescriptor } from './commands.js';
import { AUDIO_EDITOR_HISTORY_LIMIT } from './history.js';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-v4.js';
import { collectHistorySourceIds } from './retention.js';

export const AUDIO_EDITOR_SESSION_SCHEMA_VERSION = 1;
export const AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION = 1;

/**
 * @typedef {Object} AudioEditorSessionTab
 * @property {string} projectId
 * @property {Object} history
 * @property {boolean} readOnly
 * @property {string|null} readOnlyReason
 * @property {string|null} lockMethod
 * @property {boolean} dirty
 * @property {Object} metadata
 */

/**
 * Structured-clone-safe session snapshot. Source reference counts are derived
 * from tab histories and the clipboard, never trusted when restoring state.
 * @typedef {Object} AudioEditorSessionSnapshot
 * @property {1} schemaVersion
 * @property {string|null} activeProjectId
 * @property {AudioEditorSessionTab[]} tabs
 * @property {Object|null} clipboard
 * @property {Record<string, number>} sourceReferenceCounts
 * @property {boolean} disposed
 */

function clone(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function nonEmptyString(value, name) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function positiveInteger(value, name) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return value;
}

function nonNegativeInteger(value, name) {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return value;
}

function validateProject(project, name = 'project') {
	if (!project || typeof project !== 'object') throw new TypeError(`A ${name} is required.`);
	positiveInteger(project.schemaVersion, `${name}.schemaVersion`);
	nonEmptyString(project.id, `${name}.id`);
	nonEmptyString(project.title, `${name}.title`);
	if (!Array.isArray(project.sources) || !Array.isArray(project.clips) || !Array.isArray(project.tracks)) {
		throw new TypeError(`${name} sources, clips, and tracks must be arrays.`);
	}
	return project;
}

function normalizeProject(project, name = 'project') {
	return clone(validateProject(project, name));
}

function createHistory(project, history) {
	if (!history) {
		return {
			limit: AUDIO_EDITOR_HISTORY_LIMIT,
			present: normalizeProject(project),
			undoStack: [],
			redoStack: [],
		};
	}
	if (!history || typeof history !== 'object') throw new TypeError('Project history is required.');
	positiveInteger(history.limit, 'history.limit');
	if (!Array.isArray(history.undoStack) || !Array.isArray(history.redoStack)) {
		throw new TypeError('Project history stacks must be arrays.');
	}
	const normalized = clone(history);
	const present = validateProject(normalized.present, 'history.present');
	if (present.id !== project.id) throw new RangeError('Project history must belong to the open project.');
	const normalizeEntry = (entry, name) => {
		if (!entry || typeof entry !== 'object') throw new TypeError(`${name} must be a history entry.`);
		const snapshot = validateProject(entry.project, `${name}.project`);
		if (snapshot.id !== project.id) throw new RangeError(`${name} belongs to another project.`);
		return entry;
	};
	return {
		...normalized,
		limit: normalized.limit,
		present,
		undoStack: normalized.undoStack.map((entry, index) => normalizeEntry(entry, `history.undoStack[${index}]`)),
		redoStack: normalized.redoStack.map((entry, index) => normalizeEntry(entry, `history.redoStack[${index}]`)),
	};
}

function sourceIdsFromDescriptor(descriptor) {
	const ids = new Set();
	for (const track of descriptor?.tracks || []) {
		for (const clip of track?.clips || []) {
			if (typeof clip?.sourceId === 'string' && clip.sourceId) ids.add(clip.sourceId);
		}
	}
	return [...ids].sort();
}

function validateClipboardDescriptor(descriptor) {
	if (!descriptor || typeof descriptor !== 'object') throw new TypeError('An audio editor clipboard descriptor is required.');
	if (![1, 2].includes(descriptor.schemaVersion)) {
		throw new RangeError(`Unsupported clipboard schema version: ${descriptor.schemaVersion}.`);
	}
	positiveInteger(descriptor.sampleRate, 'clipboard.sampleRate');
	positiveInteger(descriptor.durationFrames, 'clipboard.durationFrames');
	if (!Array.isArray(descriptor.tracks)) throw new TypeError('clipboard.tracks must be an array.');
	const laneGroups = new Map();
	const avLinks = new Map();
	for (const [trackIndex, track] of descriptor.tracks.entries()) {
		nonEmptyString(track?.sourceTrackId, `clipboard.tracks[${trackIndex}].sourceTrackId`);
		if (!Array.isArray(track.clips)) throw new TypeError(`clipboard.tracks[${trackIndex}].clips must be an array.`);
		const sourceTrackType = descriptor.schemaVersion === 2 ? track.sourceTrackType : 'audio';
		if (!['audio', 'video'].includes(sourceTrackType)) {
			throw new RangeError(`clipboard.tracks[${trackIndex}].sourceTrackType must be audio or video.`);
		}
		if (descriptor.schemaVersion === 2 && track.sourceLaneGroupId != null) {
			const laneGroupId = nonEmptyString(track.sourceLaneGroupId, `clipboard.tracks[${trackIndex}].sourceLaneGroupId`);
			const entries = laneGroups.get(laneGroupId) || [];
			entries.push({ index: trackIndex, type: sourceTrackType });
			laneGroups.set(laneGroupId, entries);
		}
		for (const [clipIndex, clip] of track.clips.entries()) {
			nonEmptyString(clip?.key, `clipboard.tracks[${trackIndex}].clips[${clipIndex}].key`);
			nonEmptyString(clip?.sourceId, `clipboard.tracks[${trackIndex}].clips[${clipIndex}].sourceId`);
			nonNegativeInteger(clip.offsetFrame, `clipboard.tracks[${trackIndex}].clips[${clipIndex}].offsetFrame`);
			nonNegativeInteger(clip.sourceStartFrame, `clipboard.tracks[${trackIndex}].clips[${clipIndex}].sourceStartFrame`);
			positiveInteger(clip.durationFrames, `clipboard.tracks[${trackIndex}].clips[${clipIndex}].durationFrames`);
			if (descriptor.schemaVersion === 2) {
				if (!['audio', 'video'].includes(clip.kind)) {
					throw new RangeError(`clipboard.tracks[${trackIndex}].clips[${clipIndex}].kind must be audio or video.`);
				}
				if (clip.kind !== sourceTrackType) {
					throw new RangeError(`clipboard.tracks[${trackIndex}] cannot contain a ${clip.kind} clip.`);
				}
				if (clip.groupId != null) {
					nonEmptyString(clip.groupId, `clipboard.tracks[${trackIndex}].clips[${clipIndex}].groupId`);
				}
				if (clip.avLinkId != null) {
					const avLinkId = nonEmptyString(clip.avLinkId, `clipboard.tracks[${trackIndex}].clips[${clipIndex}].avLinkId`);
					const linked = avLinks.get(avLinkId) || [];
					linked.push({
						kind: clip.kind,
						offsetFrame: clip.offsetFrame,
						durationFrames: clip.durationFrames,
						laneGroupId: track.sourceLaneGroupId || null,
					});
					avLinks.set(avLinkId, linked);
				}
			}
		}
	}
	for (const [laneGroupId, tracks] of laneGroups) {
		if (
			tracks.length !== 2
			|| tracks[0].type !== 'video'
			|| tracks[1].type !== 'audio'
			|| tracks[1].index !== tracks[0].index + 1
		) {
			throw new RangeError(`Clipboard media lane group ${laneGroupId} must contain one adjacent video/audio track pair.`);
		}
	}
	for (const [avLinkId, linked] of avLinks) {
		if (
			linked.length !== 2
			|| linked[0].kind !== 'video'
			|| linked[1].kind !== 'audio'
			|| linked[0].offsetFrame !== linked[1].offsetFrame
			|| linked[0].durationFrames !== linked[1].durationFrames
			|| !linked[0].laneGroupId
			|| linked[0].laneGroupId !== linked[1].laneGroupId
		) {
			throw new RangeError(`Clipboard A/V link ${avLinkId} must contain one aligned video/audio pair.`);
		}
	}
	return clone(descriptor);
}

/**
 * Attach immutable source metadata to a normal clipboard descriptor so it can
 * be materialized by a different project without depending on the origin tab.
 */
export function createAudioEditorSessionClipboard(project, options = {}) {
	const normalizedProject = normalizeProject(project);
	const audioTrackIds = normalizedProject.tracks
		.filter((track) => track.type !== 'label' && Array.isArray(track.clipIds))
		.map((track) => track.id);
	const descriptor = validateClipboardDescriptor(options.descriptor || createClipboardDescriptor(normalizedProject, {
		startFrame: options.startFrame,
		endFrame: options.endFrame,
		trackIds: options.trackIds || audioTrackIds,
	}));
	const sourceIds = sourceIdsFromDescriptor(descriptor);
	const sourceById = new Map(normalizedProject.sources.map((source) => [source.id, source]));
	const sources = sourceIds.map((sourceId) => {
		const source = sourceById.get(sourceId);
		if (!source) throw new ReferenceError(`Clipboard source ${sourceId} is missing from project ${project.id}.`);
		return clone(source);
	});
	return {
		schemaVersion: AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION,
		originProjectId: normalizedProject.id,
		descriptor,
		sources,
	};
}

function normalizeSessionClipboard(value) {
	if (!value || typeof value !== 'object') throw new TypeError('A session clipboard is required.');
	if (value.schemaVersion !== AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported session clipboard schema version: ${value.schemaVersion}.`);
	}
	nonEmptyString(value.originProjectId, 'session clipboard originProjectId');
	const descriptor = validateClipboardDescriptor(value.descriptor);
	if (!Array.isArray(value.sources)) throw new TypeError('Session clipboard sources must be an array.');
	const sourceIds = sourceIdsFromDescriptor(descriptor);
	const sourceById = new Map();
	for (const source of value.sources) {
		if (!source || typeof source !== 'object') throw new TypeError('Session clipboard source metadata is required.');
		const sourceId = nonEmptyString(source.id, 'session clipboard source ID');
		if (sourceById.has(sourceId)) throw new RangeError(`Duplicate session clipboard source ID: ${sourceId}.`);
		sourceById.set(sourceId, clone(source));
	}
	const sources = sourceIds.map((sourceId) => {
		const source = sourceById.get(sourceId);
		if (!source) throw new ReferenceError(`Session clipboard source metadata is missing for ${sourceId}.`);
		return source;
	});
	return {
		schemaVersion: AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION,
		originProjectId: value.originProjectId,
		descriptor,
		sources,
	};
}

function normalizeTab(value) {
	if (!value || typeof value !== 'object') throw new TypeError('A project tab is required.');
	const project = validateProject(value.history?.present || value.project, 'tab project');
	if (value.projectId != null && value.projectId !== project.id) {
		throw new RangeError('Project tab ID does not match its project history.');
	}
	const history = createHistory(project, value.history);
	const normalizedProject = history.present;
	const readOnly = Boolean(value.readOnly);
	return {
		projectId: normalizedProject.id,
		history,
		sourceIds: collectHistorySourceIds(history),
		readOnly,
		readOnlyReason: readOnly ? String(value.readOnlyReason || 'read-only') : null,
		lockMethod: value.lockMethod == null ? null : String(value.lockMethod),
		dirty: Boolean(value.dirty),
		metadata: clone(value.metadata || {}),
	};
}

function countsFor(tabs, clipboard) {
	const counts = new Map();
	const add = (sourceId) => counts.set(sourceId, (counts.get(sourceId) || 0) + 1);
	for (const tab of tabs) {
		for (const sourceId of tab.sourceIds || collectHistorySourceIds(tab.history)) add(sourceId);
	}
	for (const sourceId of sourceIdsFromDescriptor(clipboard?.descriptor)) add(sourceId);
	return counts;
}

function countsObject(counts) {
	return Object.fromEntries([...counts].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function releasedBetween(before, after) {
	return [...before]
		.filter(([sourceId, count]) => count > 0 && !after.has(sourceId))
		.map(([sourceId]) => sourceId)
		.sort();
}

/**
 * In-memory multi-project session coordinator. Persistence, source deletion,
 * locks, rendering and UI remain integration concerns supplied by callers.
 */
export function createAudioEditorSessionController(options = {}) {
	let tabs = [];
	let activeProjectId = null;
	let clipboard = null;
	let disposed = false;
	let snapshotCache = null;
	const listeners = new Set();
	const onSourcesReleased = typeof options.onSourcesReleased === 'function' ? options.onSourcesReleased : null;

	if (options.snapshot) restoreSnapshot(options.snapshot);
	for (const entry of options.projects || []) {
		const project = entry?.project || entry;
		openProject(project, entry?.project ? entry : {});
	}

	function ensureUsable() {
		if (disposed) throw new Error('The audio editor session is disposed.');
	}

	function requireTab(projectId = activeProjectId) {
		ensureUsable();
		const tab = tabs.find((candidate) => candidate.projectId === projectId);
		if (!tab) throw new ReferenceError(`Project ${projectId} is not open in this session.`);
		return tab;
	}

	function requireWritableTab(projectId = activeProjectId) {
		const tab = requireTab(projectId);
		if (tab.readOnly) throw new Error(`Project ${projectId} is read-only${tab.readOnlyReason ? `: ${tab.readOnlyReason}` : ''}.`);
		return tab;
	}

	function invalidate() {
		snapshotCache = null;
	}

	function publish() {
		invalidate();
		const snapshot = getSnapshot();
		for (const listener of [...listeners]) listener(snapshot);
	}

	function finishMutation(beforeCounts, reason, result = {}) {
		const afterCounts = countsFor(tabs, clipboard);
		const releasedSourceIds = releasedBetween(beforeCounts, afterCounts);
		publish();
		if (releasedSourceIds.length) onSourcesReleased?.([...releasedSourceIds], {
			reason,
			referenceCounts: countsObject(afterCounts),
		});
		return { ...result, releasedSourceIds };
	}

	function openProject(project, openOptions = {}) {
		ensureUsable();
		const candidateProject = validateProject(project);
		const existing = tabs.find((tab) => tab.projectId === candidateProject.id);
		if (existing) {
			const activated = openOptions.activate !== false && activeProjectId !== existing.projectId;
			if (activated) {
				activeProjectId = existing.projectId;
				publish();
			}
			return { projectId: existing.projectId, opened: false, activated, releasedSourceIds: [] };
		}
		const schemaVersion = Number(candidateProject.schemaVersion);
		const newerSchema = Number.isFinite(schemaVersion) && schemaVersion > AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION;
		const tab = normalizeTab({
			project: candidateProject,
			history: openOptions.history,
			readOnly: openOptions.readOnly || newerSchema,
			readOnlyReason: openOptions.readOnlyReason || (newerSchema ? 'newer-schema' : null),
			lockMethod: openOptions.lockMethod,
			dirty: openOptions.dirty,
			metadata: openOptions.metadata,
		});
		tabs.push(tab);
		const activated = openOptions.activate !== false || !activeProjectId;
		if (activated) activeProjectId = tab.projectId;
		publish();
		return { projectId: tab.projectId, opened: true, activated, releasedSourceIds: [] };
	}

	function switchProject(projectId) {
		const tab = requireTab(projectId);
		if (activeProjectId === tab.projectId) return false;
		activeProjectId = tab.projectId;
		publish();
		return true;
	}

	function updateProject(projectId, update, updateOptions = {}) {
		const tab = requireWritableTab(projectId);
		const beforeCounts = countsFor(tabs, clipboard);
		const previous = tab.history.present;
		const candidate = typeof update === 'function' ? update(clone(previous)) : update;
		const next = normalizeProject(candidate, 'updated project');
		if (next.id !== tab.projectId) throw new RangeError('An open project cannot change its stable ID.');
		if (next.schemaVersion !== previous.schemaVersion) throw new RangeError('Project updates cannot change schema version.');
		if (updateOptions.recordHistory === false) {
			tab.history = { ...tab.history, present: next };
		} else {
			const command = clone(updateOptions.command || { type: 'session/project-update' });
			tab.history = {
				...tab.history,
				present: next,
				undoStack: [...tab.history.undoStack, { project: previous, command }].slice(-tab.history.limit),
				redoStack: [],
			};
		}
		tab.sourceIds = collectHistorySourceIds(tab.history);
		tab.dirty = updateOptions.dirty !== false;
		return finishMutation(beforeCounts, 'project-update', { project: clone(next) });
	}

	function updateProjectHistory(projectId, history, updateOptions = {}) {
		const tab = requireWritableTab(projectId);
		const beforeCounts = countsFor(tabs, clipboard);
		const nextHistory = createHistory(tab.history.present, history);
		if (nextHistory.present.schemaVersion !== tab.history.present.schemaVersion) {
			throw new RangeError('Project history updates cannot change schema version.');
		}
		tab.history = nextHistory;
		tab.sourceIds = collectHistorySourceIds(nextHistory);
		tab.dirty = updateOptions.dirty !== false;
		return finishMutation(beforeCounts, 'history-update', { history: clone(tab.history) });
	}

	function renameProject(projectId, title, renameOptions = {}) {
		const normalizedTitle = nonEmptyString(String(title || '').trim(), 'project title');
		const now = renameOptions.now ?? new Date();
		const date = now instanceof Date ? now : new Date(now);
		if (Number.isNaN(date.getTime())) throw new TypeError('A valid rename timestamp is required.');
		const timestamp = date.toISOString();
		return updateProject(projectId, (project) => ({
			...project,
			title: normalizedTitle,
			revision: Number.isSafeInteger(project.revision) ? project.revision + 1 : project.revision,
			updatedAt: timestamp,
		}), {
			command: { type: 'project/rename', title: normalizedTitle },
			dirty: renameOptions.dirty !== false,
		});
	}

	function setProjectReadOnly(projectId, value = {}) {
		const tab = requireTab(projectId);
		const readOnly = typeof value === 'boolean' ? value : Boolean(value.readOnly);
		tab.readOnly = readOnly;
		tab.readOnlyReason = readOnly ? String(value.reason || tab.readOnlyReason || 'read-only') : null;
		if (typeof value === 'object' && Object.hasOwn(value, 'lockMethod')) {
			tab.lockMethod = value.lockMethod == null ? null : String(value.lockMethod);
		}
		publish();
		return readOnly;
	}

	function updateProjectMetadata(projectId, update, metadataOptions = {}) {
		const tab = requireTab(projectId);
		const candidate = typeof update === 'function' ? update(clone(tab.metadata)) : update;
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError('Project tab metadata must be an object.');
		}
		tab.metadata = metadataOptions.replace ? clone(candidate) : { ...tab.metadata, ...clone(candidate) };
		publish();
		return clone(tab.metadata);
	}

	function markProjectSaved(projectId) {
		const tab = requireTab(projectId);
		if (!tab.dirty) return false;
		tab.dirty = false;
		publish();
		return true;
	}

	function closeProject(projectId, closeOptions = {}) {
		const tab = requireTab(projectId);
		if (tab.dirty && !closeOptions.force) {
			return { closed: false, reason: 'dirty', releasedSourceIds: [] };
		}
		const beforeCounts = countsFor(tabs, clipboard);
		const index = tabs.indexOf(tab);
		tabs.splice(index, 1);
		if (activeProjectId === projectId) {
			activeProjectId = tabs.length ? tabs[Math.min(index, tabs.length - 1)].projectId : null;
		}
		return finishMutation(beforeCounts, 'project-close', { closed: true, reason: null, activeProjectId });
	}

	function copySelection(projectId, copyOptions = {}) {
		const tab = requireTab(projectId);
		return setClipboard(createAudioEditorSessionClipboard(tab.history.present, copyOptions));
	}

	function setClipboard(value, clipboardOptions = {}) {
		ensureUsable();
		const beforeCounts = countsFor(tabs, clipboard);
		let next;
		if (value?.descriptor && value?.sources) {
			next = normalizeSessionClipboard(value);
		} else {
			const originProjectId = clipboardOptions.originProjectId || activeProjectId;
			const tab = requireTab(originProjectId);
			next = createAudioEditorSessionClipboard(tab.history.present, { descriptor: value });
		}
		clipboard = next;
		return finishMutation(beforeCounts, 'clipboard-set', { clipboard: clone(clipboard) });
	}

	function clearClipboard() {
		ensureUsable();
		if (!clipboard) return { cleared: false, releasedSourceIds: [] };
		const beforeCounts = countsFor(tabs, clipboard);
		clipboard = null;
		return finishMutation(beforeCounts, 'clipboard-clear', { cleared: true });
	}

	function clipboardForProject(projectId = activeProjectId) {
		const tab = requireTab(projectId);
		if (!clipboard) return null;
		const descriptor = clipboard.descriptor;
		return {
			...clone(clipboard),
			compatibleSampleRate: descriptor.sampleRate === tab.history.present.sampleRate,
			requiresSampleRateConversion: descriptor.sampleRate !== tab.history.present.sampleRate,
		};
	}

	function getProject(projectId = activeProjectId) {
		return clone(requireTab(projectId).history.present);
	}

	function getProjectHistory(projectId = activeProjectId) {
		return clone(requireTab(projectId).history);
	}

	function getSourceReferenceCounts() {
		ensureUsable();
		return countsObject(countsFor(tabs, clipboard));
	}

	function getSnapshot() {
		if (snapshotCache) return snapshotCache;
		snapshotCache = {
			schemaVersion: AUDIO_EDITOR_SESSION_SCHEMA_VERSION,
			activeProjectId,
			tabs: tabs.map((tab) => ({
				projectId: tab.projectId,
				title: tab.history.present.title,
				revision: tab.history.present.revision,
				history: clone(tab.history),
				readOnly: tab.readOnly,
				readOnlyReason: tab.readOnlyReason,
				lockMethod: tab.lockMethod,
				dirty: tab.dirty,
				metadata: clone(tab.metadata),
			})),
			clipboard: clone(clipboard),
			sourceReferenceCounts: countsObject(countsFor(tabs, clipboard)),
			disposed,
		};
		return snapshotCache;
	}

	function serialize() {
		return clone(getSnapshot());
	}

	function subscribe(listener) {
		ensureUsable();
		if (typeof listener !== 'function') throw new TypeError('A session listener is required.');
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	function restoreSnapshot(snapshot) {
		if (!snapshot || typeof snapshot !== 'object') throw new TypeError('A saved session snapshot is required.');
		if (snapshot.schemaVersion !== AUDIO_EDITOR_SESSION_SCHEMA_VERSION) {
			throw new RangeError(`Unsupported audio editor session schema version: ${snapshot.schemaVersion}.`);
		}
		if (!Array.isArray(snapshot.tabs)) throw new TypeError('Session snapshot tabs must be an array.');
		const restoredTabs = snapshot.tabs.map(normalizeTab);
		const projectIds = restoredTabs.map((tab) => tab.projectId);
		if (new Set(projectIds).size !== projectIds.length) throw new RangeError('A project can only have one open tab.');
		if (snapshot.activeProjectId != null && !projectIds.includes(snapshot.activeProjectId)) {
			throw new ReferenceError('The active project is not present in the saved session.');
		}
		tabs = restoredTabs;
		activeProjectId = snapshot.activeProjectId || restoredTabs[0]?.projectId || null;
		clipboard = snapshot.clipboard ? normalizeSessionClipboard(snapshot.clipboard) : null;
		disposed = Boolean(snapshot.disposed);
		invalidate();
	}

	function dispose() {
		if (disposed) return { disposed: true, releasedSourceIds: [] };
		const beforeCounts = countsFor(tabs, clipboard);
		tabs = [];
		clipboard = null;
		activeProjectId = null;
		disposed = true;
		const result = finishMutation(beforeCounts, 'session-dispose', { disposed: true });
		listeners.clear();
		return result;
	}

	return Object.freeze({
		openProject,
		switchProject,
		updateProject,
		updateProjectHistory,
		renameProject,
		setProjectReadOnly,
		updateProjectMetadata,
		markProjectSaved,
		closeProject,
		copySelection,
		setClipboard,
		clearClipboard,
		clipboardForProject,
		getProject,
		getProjectHistory,
		getSourceReferenceCounts,
		getSnapshot,
		serialize,
		subscribe,
		dispose,
	});
}
