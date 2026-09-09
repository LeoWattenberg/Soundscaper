const DESIGN_SYSTEM_PATH = '/vendor/audacity-design-system/';

// Vite checks this inventory against every vendored stylesheet it transformed.
const layeredDesignSystemFiles = new Set();

export function getLayeredDesignSystemFileCount() {
	return layeredDesignSystemFiles.size;
}

export function getLayeredDesignSystemFiles() {
	return [...layeredDesignSystemFiles].sort();
}

export function resetLayeredDesignSystemFileCount() {
	layeredDesignSystemFiles.clear();
}

export function normalizeDesignSystemCssFile(file) {
	return typeof file === 'string' ? file.split(/[?#]/u, 1)[0].replaceAll('\\', '/') : '';
}

export function isDesignSystemCssFile(file) {
	const normalizedFile = normalizeDesignSystemCssFile(file);
	return normalizedFile.includes(DESIGN_SYSTEM_PATH) && normalizedFile.endsWith('.css');
}

/**
 * Design-system selectors are global, including body portals. Keep their base
 * styles below application overrides regardless of lazy-chunk load order;
 * website components own a separate website-* class and token namespace.
 */
export default function layerAudacityDesignSystemCss() {
	return {
		postcssPlugin: 'design-system-layer',
		Once(root, { AtRule }) {
			const file = normalizeDesignSystemCssFile(root.source?.input?.file);
			if (!isDesignSystemCssFile(file)) return;
			layeredDesignSystemFiles.add(file);
			const layer = new AtRule({ name: 'layer', params: 'design-system' });
			layer.append(root.nodes);
			root.append(layer);
		},
	};
}

layerAudacityDesignSystemCss.postcss = true;
