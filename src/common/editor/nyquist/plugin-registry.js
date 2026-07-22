import { parseNyquistPlugin } from "./plugin-parser.js";
import { NYQUIST_BUNDLED_PLUGIN_CATALOG } from "./plugins/catalog.js";

function freezeControl(control) {
	return Object.freeze({
		...control,
		options: Object.freeze(control.options.map((option) => Object.freeze({ ...option }))),
	});
}

function freezePlugin(plugin) {
	return Object.freeze({
		...plugin,
		declaredTypes: Object.freeze([...plugin.declaredTypes]),
		debugFlags: Object.freeze([...plugin.debugFlags]),
		preview: Object.freeze([...plugin.preview]),
		controls: Object.freeze(plugin.controls.map(freezeControl)),
	});
}

export const NYQUIST_BUNDLED_PLUGINS = Object.freeze(
	NYQUIST_BUNDLED_PLUGIN_CATALOG.map(freezePlugin),
);

const PLUGINS_BY_ID = new Map(
	NYQUIST_BUNDLED_PLUGINS.map((plugin) => [plugin.id, plugin]),
);

export function getNyquistPlugin(id) {
	return PLUGINS_BY_ID.get(String(id ?? "")) ?? null;
}

export function listNyquistPlugins(filters = {}) {
	const { category = null, role = null, spectral = null } = filters;
	return NYQUIST_BUNDLED_PLUGINS.filter((plugin) => (
		(category === null || plugin.category === category)
		&& (role === null || plugin.role === role)
		&& (spectral === null || plugin.spectral === Boolean(spectral))
	));
}

function resolvePlugin(idOrPlugin) {
	const id = typeof idOrPlugin === "object" && idOrPlugin !== null
		? idOrPlugin.id
		: idOrPlugin;
	const plugin = getNyquistPlugin(id);
	if (!plugin) {
		throw new RangeError(`Unknown bundled Nyquist plug-in: ${String(id ?? "")}`);
	}
	return plugin;
}

async function readNodeFileUrl(sourceUrl) {
	const nodeFsSpecifier = "node:fs/promises";
	const { readFile } = await import(/* @vite-ignore */ nodeFsSpecifier);
	return readFile(new URL(sourceUrl), "utf8");
}

export async function loadNyquistPluginSource(idOrPlugin, options = {}) {
	const plugin = resolvePlugin(idOrPlugin);
	const url = new URL(plugin.sourceUrl);
	if (typeof options.readFile === "function") {
		return options.readFile(url, "utf8");
	}
	if (url.protocol === "file:" && typeof process !== "undefined" && process.versions?.node) {
		return readNodeFileUrl(plugin.sourceUrl);
	}

	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	if (typeof fetchImpl !== "function") {
		throw new Error(`No source loader is available for ${plugin.fileName}`);
	}
	const response = await fetchImpl(plugin.sourceUrl, options.signal ? { signal: options.signal } : undefined);
	if (!response.ok) {
		throw new Error(`Unable to load ${plugin.fileName}: HTTP ${response.status}`);
	}
	return response.text();
}

export async function loadNyquistPlugin(idOrPlugin, options = {}) {
	const plugin = resolvePlugin(idOrPlugin);
	const source = await loadNyquistPluginSource(plugin, options);
	return Object.freeze({
		...plugin,
		...parseNyquistPlugin(source),
	});
}
