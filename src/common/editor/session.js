/* SPDX-License-Identifier: AGPL-3.0-only */

import { freezeProjectFeatureReportMetadata } from './project-feature-report-metadata.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
import { collectHistorySourceIds } from './retention.js';
import { createProjectActivationReservations, projectHistoryChangedError } from './session-activation.js';
import {
	AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION,
	collectAudioEditorClipboardSourceIds,
	createAudioEditorSessionClipboard,
	normalizeAudioEditorSessionClipboard,
} from './session-clipboard-codec.ts';
import {
	clone,
	createHistory,
	nonEmptyString,
	normalizeProject,
	positiveInteger,
	validateProject,
} from './session-history.js';
export const AUDIO_EDITOR_SESSION_SCHEMA_VERSION = 1;
export { AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION, createAudioEditorSessionClipboard };

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

/**
 * A detached history snapshot paired with a private ownership token. The token
 * is deliberately absent from serialized session state and becomes stale when
 * its tab's history is replaced, closed, or restored as a new tab.
 *
 * @typedef {Object} AudioEditorSessionProjectHistoryCapture
 * @property {Object} history
 * @property {object} token
 */

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
		historyToken: Object.freeze({}),
		sourceIds: collectHistorySourceIds(history),
		readOnly,
		readOnlyReason: readOnly ? String(value.readOnlyReason || 'read-only') : null,
		lockMethod: value.lockMethod == null ? null : String(value.lockMethod),
		dirty: Boolean(value.dirty),
		metadata: freezeProjectFeatureReportMetadata(clone(value.metadata || {})),
	};
}

function countsFor(tabs, clipboard) {
	const counts = new Map();
	const add = (sourceId) => counts.set(sourceId, (counts.get(sourceId) || 0) + 1);
	for (const tab of tabs) {
		for (const sourceId of tab.sourceIds || collectHistorySourceIds(tab.history)) add(sourceId);
	}
	for (const sourceId of collectAudioEditorClipboardSourceIds(clipboard?.descriptor)) add(sourceId);
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
	const currentSchemaVersion = options.currentSchemaVersion === undefined
		? AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION
		: positiveInteger(options.currentSchemaVersion, 'session current schema version');
	const onSourcesReleased = typeof options.onSourcesReleased === 'function' ? options.onSourcesReleased : null;
	const activationReservations = createProjectActivationReservations(
		(projectId) => tabs.find((candidate) => candidate.projectId === projectId),
	);

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
		activationReservations.publish(listeners, snapshot);
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
		const activates = existing
			? openOptions.activate !== false && activeProjectId !== existing.projectId
			: openOptions.activate !== false || !activeProjectId;
		activationReservations.assertOpen(candidateProject.id, openOptions, activates);
		if (existing) {
			if (openOptions.requireAbsent) throw projectHistoryChangedError();
			if (activates) {
				activeProjectId = existing.projectId;
				publish();
			}
			return { projectId: existing.projectId, opened: false, activated: activates, releasedSourceIds: [] };
		}
		const schemaVersion = Number(candidateProject.schemaVersion);
		const newerSchema = Number.isFinite(schemaVersion) && schemaVersion > currentSchemaVersion;
		const tab = normalizeTab({
			project: candidateProject,
			history: openOptions.history,
			readOnly: openOptions.readOnly || newerSchema,
			readOnlyReason: openOptions.readOnlyReason || (newerSchema ? 'newer-schema' : null),
			lockMethod: openOptions.lockMethod,
			dirty: openOptions.dirty,
			metadata: openOptions.metadata,
		});
		activationReservations.markOpened(tab.projectId, openOptions);
		tabs.push(tab);
		if (activates) activeProjectId = tab.projectId;
		publish();
		return { projectId: tab.projectId, opened: true, activated: activates, releasedSourceIds: [] };
	}

	function switchProject(projectId, switchOptions = {}) {
		activationReservations.assertSwitch(projectId, switchOptions);
		if (Object.hasOwn(switchOptions, 'expectedHistoryToken')) {
			assertProjectHistoryToken(projectId, switchOptions.expectedHistoryToken);
		}
		const tab = requireTab(projectId);
		if (activeProjectId === tab.projectId) return false;
		activeProjectId = tab.projectId;
		publish();
		return true;
	}

	function updateProject(projectId, update, updateOptions = {}) {
		activationReservations.assertMutable(projectId);
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
		tab.historyToken = Object.freeze({});
		tab.sourceIds = collectHistorySourceIds(tab.history);
		tab.dirty = updateOptions.dirty !== false;
		return finishMutation(beforeCounts, 'project-update', { project: clone(next) });
	}

	function updateProjectHistory(projectId, history, updateOptions = {}) {
		activationReservations.assertMutable(projectId);
		const tab = requireWritableTab(projectId);
		const beforeCounts = countsFor(tabs, clipboard);
		const nextHistory = createHistory(tab.history.present, history);
		if (nextHistory.present.schemaVersion !== tab.history.present.schemaVersion) {
			throw new RangeError('Project history updates cannot change schema version.');
		}
		tab.history = nextHistory;
		tab.historyToken = Object.freeze({});
		tab.sourceIds = collectHistorySourceIds(nextHistory);
		tab.dirty = updateOptions.dirty !== false;
		return finishMutation(beforeCounts, 'history-update', { history: clone(tab.history) });
	}

	/** Atomically install an already committed history and its intrinsic read-only tab state. */
	/**
	 * Install a history a reserved controller committed outside the session.
	 *
	 * `readOnly` states what the installed tab becomes. It exists because the one
	 * caller — the proxy attachment gate — used to have only one answer: an
	 * attached document was intrinsically read-only, so installing one and
	 * marking the tab read-only were the same act. They are not any more, and a
	 * tab left read-only after an attachment would be the whole feature's cost
	 * with none of its benefit.
	 */
	function installCommittedProjectHistory(projectId, history, installOptions = {}) {
		activationReservations.assertInstall(projectId, installOptions);
		const tab = requireTab(projectId);
		const beforeCounts = countsFor(tabs, clipboard);
		const nextHistory = createHistory(tab.history.present, history);
		if (nextHistory.present.schemaVersion !== tab.history.present.schemaVersion) {
			throw new RangeError('Committed project history cannot change schema version.');
		}
		const readOnly = Boolean(installOptions.readOnly);
		tab.history = nextHistory;
		tab.historyToken = Object.freeze({});
		tab.sourceIds = collectHistorySourceIds(nextHistory);
		tab.readOnly = readOnly;
		tab.readOnlyReason = readOnly ? String(installOptions.reason || 'intrinsic-read-only') : null;
		tab.dirty = Boolean(installOptions.dirty);
		if (Object.hasOwn(installOptions, 'metadata')) {
			tab.metadata = freezeProjectFeatureReportMetadata(clone(installOptions.metadata || {}));
		}
		return finishMutation(beforeCounts, 'committed-history-install', {
			history: clone(tab.history), project: clone(tab.history.present), readOnly,
		});
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
		activationReservations.assertExclusiveMutable();
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
		activationReservations.assertExclusiveMutable();
		const tab = requireTab(projectId);
		const candidate = typeof update === 'function' ? update(clone(tab.metadata)) : update;
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError('Project tab metadata must be an object.');
		}
		tab.metadata = freezeProjectFeatureReportMetadata(metadataOptions.replace ? clone(candidate) : { ...tab.metadata, ...clone(candidate) });
		publish();
		return freezeProjectFeatureReportMetadata(clone(tab.metadata));
	}

	function markProjectSaved(projectId) {
		activationReservations.assertExclusiveMutable();
		const tab = requireTab(projectId);
		if (!tab.dirty) return false;
		tab.dirty = false;
		publish();
		return true;
	}

	function closeProject(projectId, closeOptions = {}) {
		activationReservations.assertMutable(projectId, activeProjectId === projectId);
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
			next = normalizeAudioEditorSessionClipboard(value);
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

	/**
	 * Captures a detached view without exposing the private tab object.
	 * @returns {AudioEditorSessionProjectHistoryCapture}
	 */
	function captureProjectHistory(projectId = activeProjectId) {
		const tab = requireTab(projectId);
		return Object.freeze({ history: clone(tab.history), token: tab.historyToken });
	}

	/**
	 * Fails closed when asynchronous preparation no longer owns the same private
	 * tab history, without invalidating captures for metadata-only updates.
	 */
	function assertProjectHistoryToken(projectId, token) {
		ensureUsable();
		const tab = tabs.find((candidate) => candidate.projectId === projectId);
		if (!tab || tab.historyToken !== token) throw projectHistoryChangedError();
		return true;
	}

	/** Reserves history ownership until the caller releases after publication. */
	// Metadata-only updates intentionally remain available while one is held.
	function beginProjectActivation(projectId, activationOptions) {
		ensureUsable();
		return activationReservations.begin(projectId, activationOptions);
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
				metadata: freezeProjectFeatureReportMetadata(clone(tab.metadata)),
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
		activationReservations.assertRestorable();
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
		clipboard = snapshot.clipboard ? normalizeAudioEditorSessionClipboard(snapshot.clipboard) : null;
		disposed = Boolean(snapshot.disposed);
		invalidate();
	}

	function dispose() {
		if (disposed) return { disposed: true, releasedSourceIds: [] };
		activationReservations.assertRestorable();
		const beforeCounts = countsFor(tabs, clipboard);
		activationReservations.clear();
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
		installCommittedProjectHistory,
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
		captureProjectHistory,
		assertProjectHistoryToken,
		beginProjectActivation,
		getSourceReferenceCounts,
		getSnapshot,
		serialize,
		subscribe,
		dispose,
	});
}
