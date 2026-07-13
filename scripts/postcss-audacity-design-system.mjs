import postcss from 'postcss';

const DESIGN_SYSTEM_DIST = '/node_modules/@dilsonspickles/components/dist/';
const EDITOR_ROOT = '#kw-audio-editor-design-system';
const PORTAL_ROOT = 'body.kw-audio-editor-design-system-mounted';
const PORTAL_SELECTOR = /\.(?:dropdown__(?:menu|option|separator)|tooltip(?:__content|__arrow)?)(?:--[\w-]+)?(?![\w-])/;
const KEYFRAMES = /^(?:-\w+-)?keyframes$/i;

const DARK_DROPDOWN_OVERRIDES = `
html[data-theme="dark"] ${PORTAL_ROOT} .dropdown__menu {
	--dropdown-menu-bg: #202126 !important;
	--dropdown-border: #4b4d55 !important;
	--dropdown-menu-shadow: 0 10px 30px rgb(0 0 0 / 55%) !important;
	--dropdown-text: #f2f2f3 !important;
	--dropdown-option-hover-bg: #34363d !important;
}
`;

const DARK_TOOLTIP_OVERRIDES = `
html[data-theme="dark"] ${PORTAL_ROOT} .tooltip__content {
	background-color: #202126;
	border-color: #4b4d55;
	color: #f2f2f3;
}

html[data-theme="dark"] ${PORTAL_ROOT} .tooltip__arrow path {
	fill: #202126;
	stroke: #4b4d55;
}
`;

/**
 * Prefix the Audacity design-system package without affecting the rest of the
 * site. Dropdown and Tooltip render into document.body, so their portal-only
 * selectors use a body sentinel managed by the React island instead.
 */
export default function scopeAudacityDesignSystemCss() {
	return {
		postcssPlugin: 'kw-scope-audacity-design-system',
		Once(root) {
			if (!isDesignSystemCss(root.source?.input?.file)) {
				return;
			}

			let hasDropdownPortal = false;
			let hasTooltipPortal = false;

			root.walkRules((rule) => {
				if (isInsideKeyframes(rule)) {
					return;
				}

				rule.selector = splitSelectorList(rule.selector)
					.map((selector) => {
						if (PORTAL_SELECTOR.test(selector)) {
							hasDropdownPortal ||= selector.includes('.dropdown__');
							hasTooltipPortal ||= selector.includes('.tooltip');
							return prefixSelector(selector, PORTAL_ROOT);
						}

						const rewritten = selector.replace(/:root\b/g, EDITOR_ROOT);
						return rewritten.includes(EDITOR_ROOT)
							? rewritten
							: prefixSelector(rewritten, EDITOR_ROOT);
					})
					.join(',\n');
			});

			if (hasDropdownPortal) {
				appendCss(root, DARK_DROPDOWN_OVERRIDES);
			}
			if (hasTooltipPortal) {
				appendCss(root, DARK_TOOLTIP_OVERRIDES);
			}
		},
	};
}

function appendCss(root, css) {
	const parsed = postcss.parse(css, { from: root.source?.input?.file });
	root.append(parsed.nodes);
}

scopeAudacityDesignSystemCss.postcss = true;

function isDesignSystemCss(file) {
	return typeof file === 'string'
		&& file.replaceAll('\\', '/').includes(DESIGN_SYSTEM_DIST);
}

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
