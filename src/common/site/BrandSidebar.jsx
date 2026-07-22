import { useEffect, useMemo, useState } from 'react';

import { bundledCopyForLocale } from '../i18n/catalogs.js';
import { localeLanguage } from '../i18n/locale.js';
import { DEFAULT_LOCALE_TAGS, getLocaleDescriptor, ROUTE_LOCALES } from '../i18n/locales.js';
import { productLocalePath, productProfile } from '../products.js';

const TRANSLATIONS_BASE_URL = import.meta.env.PUBLIC_TRANSLATIONS_BASE_URL
	|| 'https://translations.soundscaper.org/runtime/translations/audacity/4/';

export default function BrandSidebar({ locale, productId = 'soundscaper' }) {
	const profile = productProfile(productId);
	const localeDescriptor = getLocaleDescriptor(locale);
	if (!localeDescriptor) throw new Error(`Unknown editor locale: ${locale}`);
	const chromeLocale = localeLanguage(localeDescriptor.locale) === 'de' ? 'de' : 'en';
	const catalog = bundledCopyForLocale(localeDescriptor.locale);
	const copy = sidebarCopy(catalog);
	const [collapsed, setCollapsed] = useState(() => storedCollapsed(productId));
	const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
	const [workspace, setWorkspace] = useState({ activeId: profile.defaultWorkspace, workspaces: [] });
	const [eligibleNames, setEligibleNames] = useState(new Map());
	const localeOptions = useMemo(() => {
		const localeTags = new Set([...DEFAULT_LOCALE_TAGS, localeDescriptor.locale, ...eligibleNames.keys()]);
		return ROUTE_LOCALES
			.filter(({ locale: routeLocale }) => localeTags.has(routeLocale))
			.map((descriptor) => ({ ...descriptor, name: eligibleNames.get(descriptor.locale) || descriptor.nativeName }))
			.sort((left, right) => left.name.localeCompare(right.name, localeDescriptor.locale));
	}, [eligibleNames, localeDescriptor.locale]);

	useEffect(() => {
		const handleWorkspaceState = (event) => {
			if (event.detail?.productId && event.detail.productId !== productId) return;
			const workspaces = Array.isArray(event.detail?.workspaces)
				? event.detail.workspaces.filter(({ id, name }) => typeof id === 'string' && id && typeof name === 'string' && name)
				: [];
			setWorkspace({ activeId: event.detail?.activeId || profile.defaultWorkspace, workspaces });
		};
		window.addEventListener('scape:workspace-state', handleWorkspaceState);
		window.addEventListener('soundscaper:workspace-state', handleWorkspaceState);
		window.dispatchEvent(new CustomEvent('scape:workspace-ready', { detail: { productId } }));
		return () => {
			window.removeEventListener('scape:workspace-state', handleWorkspaceState);
			window.removeEventListener('soundscaper:workspace-state', handleWorkspaceState);
		};
	}, [productId, profile.defaultWorkspace]);

	useEffect(() => {
		const controller = new AbortController();
		const timeout = window.setTimeout(() => controller.abort(), 5_000);
		fetch(`${TRANSLATIONS_BASE_URL.replace(/\/+$/u, '')}/latest.json`, { cache: 'no-store', signal: controller.signal })
			.then((response) => {
				if (!response.ok) throw new Error(`Translation manifest request failed (${response.status})`);
				return response.json();
			})
			.then((manifest) => {
				const routeLocaleTags = new Set(ROUTE_LOCALES.map(({ locale: routeLocale }) => routeLocale));
				const locales = manifest && typeof manifest.locales === 'object' && !Array.isArray(manifest.locales) ? manifest.locales : {};
				const names = new Map();
				for (const [tag, descriptor] of Object.entries(locales)) {
					if (!routeLocaleTags.has(tag) || !descriptor || typeof descriptor !== 'object' || descriptor.eligible !== true) continue;
					if (typeof descriptor.name === 'string' && descriptor.name.trim()) names.set(tag, descriptor.name.trim());
				}
				setEligibleNames(names);
			})
			.catch(() => {})
			.finally(() => window.clearTimeout(timeout));
		return () => {
			window.clearTimeout(timeout);
			controller.abort();
		};
	}, []);

	const toggleCollapsed = () => {
		const next = !collapsed;
		setCollapsed(next);
		try { localStorage.setItem(`${productId}_sidebar_collapsed`, String(next)); } catch {}
	};
	const toggleTheme = () => {
		const next = theme === 'dark' ? 'light' : 'dark';
		setTheme(next);
		document.documentElement.dataset.theme = next;
		document.documentElement.style.colorScheme = next;
		try { localStorage.setItem(`${productId}_theme`, next); } catch {}
	};
	const selectWorkspace = (event) => {
		window.dispatchEvent(new CustomEvent('scape:workspace-request', {
			detail: { productId, workspaceId: event.target.value },
		}));
	};
	const selectLocale = (event) => {
		if (ROUTE_LOCALES.some(({ locale: routeLocale }) => routeLocale === event.target.value)) {
			window.location.assign(productLocalePath(productId, event.target.value));
		}
	};
	const workspaces = workspace.workspaces.length ? workspace.workspaces : defaultWorkspaces(productId, copy);

	return (
		<aside className="site-sidebar" data-sidebar data-product={productId} data-locale={localeDescriptor.locale} data-collapsed={String(collapsed)} aria-label={copy.label}>
			<a className="brand" href={productLocalePath(productId, locale)} aria-label={profile.name}>
				<img className="logo-light logo-wide" src="/logo/logo-schwarz.svg" alt="kw.media" width="230" height="91" />
				<img className="logo-dark logo-wide" src="/logo/logo-weiß.svg" alt="kw.media" width="230" height="91" />
				<img className="logo-light logo-small" src="/logo/logo-klein-schwarz.svg" alt="" width="48" height="48" />
				<img className="logo-dark logo-small" src="/logo/logo-klein-weiß.svg" alt="" width="48" height="48" />
				<strong>{profile.name}</strong>
			</a>
			<button className="sidebar-collapse" type="button" data-sidebar-collapse aria-label={collapsed ? copy.expand : copy.collapse} aria-expanded={String(!collapsed)} onClick={toggleCollapsed}>
				<span aria-hidden="true">‹</span>
			</button>
			<div className="sidebar-content" data-sidebar-content>
				<nav className="sidebar-nav" aria-label={copy.label}>
					<a className="sidebar-link is-active" href={productLocalePath(productId, locale)} aria-current="page">{productId === 'framescaper' ? profile.name : copy.editor}</a>
					<a className="sidebar-link" href={`https://kw.media/${chromeLocale}/tools/`}>{copy.tools}</a>
					<a className="sidebar-link" href={`https://kw.media/${chromeLocale}/audacity/`}>{copy.guides}</a>
					<a className="sidebar-link" href={`https://kw.media/${chromeLocale}/legal/`}>{copy.legal}</a>
					<a className="sidebar-link" href="https://github.com/LeoWattenberg/Soundscaper" target="_blank" rel="noreferrer">{copy.github}</a>
				</nav>
				<section className="sidebar-settings" aria-labelledby="sidebar-settings-title">
					<h2 id="sidebar-settings-title">{copy.settings}</h2>
					<label className="sidebar-workspace">
						<span>{copy.workspace}</span>
						<select data-workspace-select aria-label={copy.workspace} value={workspace.activeId} disabled={!workspace.workspaces.length} onChange={selectWorkspace}>
							{workspaces.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
						</select>
					</label>
					<div className="sidebar-actions">
						<button className="theme-toggle" type="button" data-theme-toggle aria-label={copy.theme} aria-pressed={String(theme === 'dark')} onClick={toggleTheme}>
							<span className="theme-toggle-track" aria-hidden="true"><span className="theme-toggle-thumb"></span></span>
							<span data-theme-label>{theme === 'dark' ? copy.dark : copy.light}</span>
						</button>
						<label className="language-picker">
							<span>{copy.language}</span>
							<select data-locale-select aria-label={copy.language} value={localeDescriptor.locale} onChange={selectLocale}>
								{localeOptions.map(({ locale: optionLocale, name }) => <option key={optionLocale} value={optionLocale}>{name}</option>)}
							</select>
						</label>
					</div>
				</section>
			</div>
		</aside>
	);
}

function storedCollapsed(productId) {
	try {
		return (localStorage.getItem(`${productId}_sidebar_collapsed`) || localStorage.getItem('soundscaper_sidebar_collapsed')) === 'true';
	} catch {
		return false;
	}
}

function defaultWorkspaces(productId, copy) {
	return productId === 'framescaper'
		? [{ id: 'video-editor', name: copy.workspaceVideo }]
		: [
			{ id: 'modern', name: copy.workspaceModern },
			{ id: 'music', name: copy.workspaceMusic },
			{ id: 'classic', name: copy.workspaceClassic },
		];
}

function sidebarCopy(catalog) {
	return {
		label: catalog.sidebarNavigation,
		editor: catalog.audioEditorLink,
		tools: catalog.moreToolsLink,
		guides: catalog.audacityGuidesLink,
		legal: catalog.legalLink,
		github: catalog.githubProjectLink,
		theme: catalog.themeToggle,
		light: catalog.lightTheme,
		dark: catalog.darkTheme,
		collapse: catalog.collapseNavigation,
		expand: catalog.expandNavigation,
		language: catalog.languageLabel,
		workspace: catalog.workspace,
		workspaceModern: catalog.workspaceModern,
		workspaceMusic: catalog.workspaceMusic,
		workspaceClassic: catalog.workspaceClassic,
		workspaceVideo: catalog.workspaceVideo,
		settings: catalog.sidebarSettings,
	};
}
