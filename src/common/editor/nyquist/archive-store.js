/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseNyquistPluginHeader } from './plugin-parser.js';
import { NYQUIST_MAX_SOURCE_BYTES } from './protocol.js';

export const NYQUIST_ARCHIVE_ID = 'audacityteam-nyquist-plugins-ed168a19631ec48d0029dfb5c17d16c339a174c1';
const STORAGE_KEY = 'soundscaper-nyquist-archive-plugins-v1';
const MAX_ARCHIVE_FILE_BYTES = Math.min(NYQUIST_MAX_SOURCE_BYTES, 512 * 1024);

function validateArchiveFileName(fileName) {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.ny$/u.test(fileName)) {
		throw new Error('Invalid Nyquist archive file name.');
	}
}

function announceInstalledChange() {
	if (typeof globalThis.dispatchEvent === 'function') {
		globalThis.dispatchEvent(new Event('soundscaper-nyquist-archive-changed'));
	}
}

function parsedInstalledPlugin(record) {
	if (!record || typeof record.source !== 'string' || record.archiveId !== NYQUIST_ARCHIVE_ID
		|| record.id !== `nyquist:archive:${record.fileName}`) return null;
	try {
		validateArchiveFileName(record.fileName);
		if (new TextEncoder().encode(record.source).byteLength > MAX_ARCHIVE_FILE_BYTES) return null;
		const parsed = parseNyquistPluginHeader(record.source);
		if (!['process', 'generate', 'analyze'].includes(parsed.role) || parsed.isTool
			|| parsed.controls.some((control) => !['number', 'choice', 'string', 'text'].includes(control.kind))) return null;
		return Object.freeze({
			...parsed,
			name: typeof record.catalogTitle === 'string' && record.catalogTitle.trim() && record.catalogTitle.length <= 160
				? record.catalogTitle : parsed.name,
			description: typeof record.catalogDescription === 'string' && record.catalogDescription.length <= 700
				? record.catalogDescription : '',
			id: record.id,
			fileName: record.fileName,
			category: parsed.role === 'process' ? 'legacy' : parsed.role,
			archiveId: NYQUIST_ARCHIVE_ID,
		});
	} catch {
		return null;
	}
}

export function createNyquistArchiveStore(storage) {
	let records = [];
	let plugins = [];
	const reload = () => {
		try {
			const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
			records = Array.isArray(saved) ? saved.filter((record) => parsedInstalledPlugin(record)) : [];
		} catch {
			records = [];
		}
		plugins = records.map(parsedInstalledPlugin);
	};
	reload();
	return {
		storage,
		reload,
		list: () => [...plugins],
		source: (id) => records.find((record) => record.id === id)?.source ?? null,
		install(record) {
			const plugin = parsedInstalledPlugin(record);
			if (!plugin) throw new Error('This Nyquist plug-in needs features unavailable in the browser.');
			if (!storage) throw new Error('Browser storage is unavailable for Nyquist plug-ins.');
			const next = [...records.filter((saved) => saved.id !== record.id), {
				...record, name: plugin.name, role: plugin.role, spectral: plugin.spectral,
			}];
			storage?.setItem(STORAGE_KEY, JSON.stringify(next));
			records = next;
			plugins = [...plugins.filter((saved) => saved.id !== record.id), plugin];
			announceInstalledChange();
			return plugin;
		},
		remove(id) {
			const next = records.filter((record) => record.id !== id);
			storage?.setItem(STORAGE_KEY, JSON.stringify(next));
			records = next;
			plugins = plugins.filter((plugin) => plugin.id !== id);
			announceInstalledChange();
		},
		updateCatalogMetadata(artifacts) {
			const metadata = new Map(artifacts.map((artifact) => [artifact.fileName, artifact]));
			const next = records.map((record) => {
				const artifact = metadata.get(record.fileName);
				return artifact && (record.catalogTitle !== artifact.title || record.catalogDescription !== artifact.description)
					? { ...record, catalogTitle: artifact.title, catalogDescription: artifact.description, name: artifact.title }
					: record;
			});
			if (next.every((record, index) => record === records[index])) return;
			storage?.setItem(STORAGE_KEY, JSON.stringify(next));
			records = next;
			plugins = records.map(parsedInstalledPlugin);
			announceInstalledChange();
		},
	};
}

function browserStorage() {
	if (typeof process !== 'undefined' && process.versions?.node) return null;
	try { return globalThis.localStorage; } catch { return null; }
}

export const nyquistArchiveStore = createNyquistArchiveStore(browserStorage());
if (typeof globalThis.addEventListener === 'function') {
	globalThis.addEventListener('storage', (event) => {
		if (event.key === STORAGE_KEY) nyquistArchiveStore.reload();
	});
}
