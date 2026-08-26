const DESIGN_SYSTEM_PATH = '/vendor/audacity-design-system/';
const EDITOR_ROOT = '#kw-audio-editor-design-system';
const PORTAL_ROOT = 'body.kw-audio-editor-design-system-mounted';
const PORTAL_SELECTOR = /\.(?:dropdown__(?:menu|option|separator)|tooltip(?:__content|__arrow)?)(?:--[\w-]+)?(?![\w-])/;
const KEYFRAMES = /^(?:-\w+-)?keyframes$/i;

// Build-time tripwire state: vite.config.mjs compares this exact inventory with
// every vendored stylesheet Vite transformed for the graph.
const scopedDesignSystemFiles = new Set();

export function getScopedDesignSystemFileCount() {
	return scopedDesignSystemFiles.size;
}

export function getScopedDesignSystemFiles() {
	return [...scopedDesignSystemFiles].sort();
}

export function resetScopedDesignSystemFileCount() {
	scopedDesignSystemFiles.clear();
}

export function normalizeDesignSystemCssFile(file) {
	return typeof file === 'string' ? file.split(/[?#]/u, 1)[0].replaceAll('\\', '/') : '';
}

export function isDesignSystemCssFile(file) {
	const normalizedFile = normalizeDesignSystemCssFile(file);
	return normalizedFile.includes(DESIGN_SYSTEM_PATH) && normalizedFile.endsWith('.css');
}

/**
 * Prefix the vendored Audacity design system without affecting the rest of
 * the site. Dropdown and Tooltip render into document.body, so their
 * portal-only selectors use a body sentinel managed by the React island
 * instead. Dark-theme palettes for those portals are app-owned CSS in
 * src/common/editor/ui/audio-editor-design-system/24-portal-dark-theme.css.
 */
export default function scopeAudacityDesignSystemCss() {
	return {
		postcssPlugin: 'kw-scope-audacity-design-system',
		Once(root) {
			const file = normalizeDesignSystemCssFile(root.source?.input?.file);
			if (!isDesignSystemCssFile(file)) {
				return;
			}

			scopedDesignSystemFiles.add(file);

			root.walkRules((rule) => {
				if (isInsideKeyframes(rule)) {
					return;
				}

				rule.selector = splitSelectorList(rule.selector)
					.map((selector) => {
						if (PORTAL_SELECTOR.test(selector)) {
							return prefixSelector(selector, PORTAL_ROOT);
						}

						const rewritten = selector.replace(/:root\b/g, EDITOR_ROOT);
						return rewritten.includes(EDITOR_ROOT)
							? rewritten
							: prefixSelector(rewritten, EDITOR_ROOT);
					})
					.join(',\n');
			});
		},
	};
}

scopeAudacityDesignSystemCss.postcss = true;

function isInsideKeyframes(rule) {
	for (let parent = rule.parent; parent; parent = parent.parent) {
		if (parent.type === 'atrule' && KEYFRAMES.test(parent.name)) {
			return true;
		}
	}
	return false;
}

function prefixSelector(selector, prefix) {
	const trimmed = selector.trim();
	return trimmed.startsWith(prefix) ? trimmed : `${prefix} ${trimmed}`;
}

// PostCSS's list helper splits commas inside :is() and attribute values. This
// small scanner only separates commas at the top level of a selector list.
function splitSelectorList(selectorList) {
	const selectors = [];
	let start = 0;
	let parentheses = 0;
	let brackets = 0;
	let quote = '';
	let escaped = false;

	for (let index = 0; index < selectorList.length; index += 1) {
		const character = selectorList[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === '\\') {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) {
				quote = '';
			}
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === '(') parentheses += 1;
		if (character === ')') parentheses = Math.max(0, parentheses - 1);
		if (character === '[') brackets += 1;
		if (character === ']') brackets = Math.max(0, brackets - 1);

		if (character === ',' && parentheses === 0 && brackets === 0) {
			selectors.push(selectorList.slice(start, index));
			start = index + 1;
		}
	}

	selectors.push(selectorList.slice(start));
	return selectors;
}
