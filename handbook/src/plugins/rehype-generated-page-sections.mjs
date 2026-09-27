/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	HANDBOOK_SOURCE_LOCALE,
	handbookLocaleForPath,
} from '../../../scripts/lib/handbook-locales.mjs';

const CONTENT_MARKER = 'src/content/docs/';
const TEST_SECTION_ID = 'what-the-packaged-test-checks';
const PURPOSE_SECTION_IDS = Object.freeze({
	model: 'purpose-and-use-case',
	guide: 'what-this-guide-is-for',
	tutorial: 'what-this-tutorial-is-for',
});
const TEST_SPECS = Object.freeze([
	'tests/browser/soundscaper-guides.spec.js',
	'tests/browser/soundscaper-tutorials.spec.js',
]);

// Session translations produced by gpt-6-luna through a Codex subagent. They
// are used only while an older translated generated page awaits regeneration;
// a current translation already carries the heading in its Markdown.
const PURPOSE_TITLES = Object.freeze({
	ar: Object.freeze({ model: 'الغرض وحالة الاستخدام', guide: 'الغرض من هذا الدليل', tutorial: 'الغرض من هذا الدرس التطبيقي' }),
	cs: Object.freeze({ model: 'Účel a případ použití', guide: 'K čemu slouží tato příručka', tutorial: 'K čemu slouží tento návod' }),
	de: Object.freeze({ model: 'Zweck und Anwendungsfall', guide: 'Wozu dieser Leitfaden dient', tutorial: 'Wozu dieses Tutorial dient' }),
	el: Object.freeze({ model: 'Σκοπός και περίπτωση χρήσης', guide: 'Σε τι χρησιμεύει αυτός ο οδηγός', tutorial: 'Σε τι χρησιμεύει αυτό το εκπαιδευτικό σεμινάριο' }),
	en: Object.freeze({ model: 'Purpose and use case', guide: 'What this guide is for', tutorial: 'What this tutorial is for' }),
	'en-GB': Object.freeze({ model: 'Purpose and use case', guide: 'What this guide is for', tutorial: 'What this tutorial is for' }),
	es: Object.freeze({ model: 'Propósito y caso de uso', guide: 'Para qué sirve esta guía', tutorial: 'Para qué sirve este tutorial' }),
	fa: Object.freeze({ model: 'هدف و مورد استفاده', guide: 'این راهنما برای چیست', tutorial: 'این آموزش برای چیست' }),
	fi: Object.freeze({ model: 'Tarkoitus ja käyttötapaus', guide: 'Tämän oppaan tarkoitus', tutorial: 'Tämän tutoriaalin tarkoitus' }),
	fr: Object.freeze({ model: 'Objectif et cas d’utilisation', guide: 'À quoi sert ce guide', tutorial: 'À quoi sert ce tutoriel' }),
	gl: Object.freeze({ model: 'Propósito e caso de uso', guide: 'Para que serve esta guía', tutorial: 'Para que serve este titorial' }),
	he: Object.freeze({ model: 'מטרה ומקרה שימוש', guide: 'מה מטרת המדריך הזה', tutorial: 'מה מטרת המדריך המעשי הזה' }),
	hi: Object.freeze({ model: 'उद्देश्य और उपयोग', guide: 'इस गाइड का उद्देश्य', tutorial: 'इस ट्यूटोरियल का उद्देश्य' }),
	hy: Object.freeze({ model: 'Նպատակ և օգտագործման դեպք', guide: 'Ինչի համար է այս ուղեցույցը', tutorial: 'Ինչի համար է այս ուսուցողական ձեռնարկը' }),
	id: Object.freeze({ model: 'Tujuan dan kegunaan', guide: 'Tujuan panduan ini', tutorial: 'Tujuan tutorial ini' }),
	it: Object.freeze({ model: 'Scopo e caso d’uso', guide: 'A cosa serve questa guida', tutorial: 'A cosa serve questo tutorial' }),
	ja: Object.freeze({ model: '目的とユースケース', guide: 'このガイドの目的', tutorial: 'このチュートリアルの目的' }),
	ko: Object.freeze({ model: '목적 및 사용 사례', guide: '이 가이드의 목적', tutorial: '이 튜토리얼의 목적' }),
	nl: Object.freeze({ model: 'Doel en gebruikssituatie', guide: 'Waar deze gids voor dient', tutorial: 'Waar deze tutorial voor dient' }),
	pl: Object.freeze({ model: 'Cel i przypadek użycia', guide: 'Do czego służy ten przewodnik', tutorial: 'Do czego służy ten samouczek' }),
	'pt-BR': Object.freeze({ model: 'Finalidade e caso de uso', guide: 'Para que serve este guia', tutorial: 'Para que serve este tutorial' }),
	'pt-PT': Object.freeze({ model: 'Finalidade e caso de utilização', guide: 'Para que serve este guia', tutorial: 'Para que serve este tutorial' }),
	ro: Object.freeze({ model: 'Scop și caz de utilizare', guide: 'La ce folosește acest ghid', tutorial: 'La ce folosește acest tutorial' }),
	ru: Object.freeze({ model: 'Назначение и сценарий использования', guide: 'Для чего нужно это руководство', tutorial: 'Для чего нужен этот обучающий материал' }),
	tr: Object.freeze({ model: 'Amaç ve kullanım senaryosu', guide: 'Bu kılavuz ne işe yarar', tutorial: 'Bu öğretici ne işe yarar' }),
	uk: Object.freeze({ model: 'Призначення та сценарій використання', guide: 'Для чого потрібен цей посібник', tutorial: 'Для чого потрібен цей навчальний посібник' }),
	vi: Object.freeze({ model: 'Mục đích và trường hợp sử dụng', guide: 'Mục đích của hướng dẫn này', tutorial: 'Mục đích của bài hướng dẫn này' }),
	'zh-CN': Object.freeze({ model: '目的和使用场景', guide: '本指南的用途', tutorial: '本教程的用途' }),
	'zh-TW': Object.freeze({ model: '目的與使用情境', guide: '本指南的用途', tutorial: '本教學的用途' }),
});

function relativePath(file) {
	const path = String(file?.path ?? file?.history?.at(-1) ?? '').replaceAll('\\', '/');
	const index = path.lastIndexOf(CONTENT_MARKER);
	return index < 0 ? '' : path.slice(index + CONTENT_MARKER.length);
}

function sourcePath(path) {
	const segments = path.split('/');
	if (handbookLocaleForPath(path) !== HANDBOOK_SOURCE_LOCALE) segments.shift();
	return segments.join('/');
}

function generatedPageKind(path, tree) {
	if (/^reference\/local-models\/[^/]+\.md$/u.test(path) && !path.endsWith('/index.md')) return 'model';
	if (/^guides\/[^/]+\/[^/]+\.md$/u.test(path) && !path.endsWith('/index.md')) return 'guide';
	if (/^tutorials\/[^/]+\.md$/u.test(path) && !path.endsWith('/index.md')) return 'tutorial';
	return tree.children.some((node) => node?.type === 'element'
		&& node.tagName === 'h2'
		&& node.properties?.id === TEST_SECTION_ID) ? 'model' : null;
}

function heading(title, id) {
	return {
		type: 'element',
		tagName: 'h2',
		properties: { id },
		children: [{ type: 'text', value: title }],
	};
}

function addPurposeHeading(tree, kind, locale) {
	const id = PURPOSE_SECTION_IDS[kind];
	if (tree.children.some((node) => node?.type === 'element'
		&& node.tagName === 'h2'
		&& node.properties?.id === id)) return;
	const paragraph = tree.children.findIndex((node) => node?.type === 'element' && node.tagName === 'p');
	if (paragraph < 0) return;
	const title = PURPOSE_TITLES[locale]?.[kind] ?? PURPOSE_TITLES.en[kind];
	tree.children.splice(paragraph, 0, heading(title, id));
}

function textOf(node) {
	if (node?.type === 'text') return node.value ?? '';
	return (node?.children ?? []).map(textOf).join('');
}

function containsDetails(node) {
	if (node?.type === 'element' && node.tagName === 'details') return true;
	if (node?.type === 'raw' && /<details(?:\s|>)/iu.test(node.value ?? '')) return true;
	return (node?.children ?? []).some(containsDetails);
}

function isTestHeading(children, index) {
	const headingNode = children[index];
	if (headingNode?.type !== 'element' || headingNode.tagName !== 'h2') return false;
	if (headingNode.properties?.id === TEST_SECTION_ID) return true;
	let section = '';
	for (let cursor = index + 1; cursor < children.length; cursor += 1) {
		if (children[cursor]?.type === 'element' && children[cursor].tagName === 'h2') break;
		if (children[cursor]?.type === 'element' && children[cursor].tagName === 'details') continue;
		section += textOf(children[cursor]);
	}
	return TEST_SPECS.some((spec) => section.includes(spec));
}

function collapseTestSections(tree) {
	// Current generated pages already carry their disclosure as raw HTML when
	// this plugin runs in Astro. Leave the whole tree alone so a test-spec path
	// inside that disclosure cannot make the preceding linked heading look like
	// an old provenance section.
	if (containsDetails(tree)) return;
	for (let index = 0; index < tree.children.length; index += 1) {
		if (!isTestHeading(tree.children, index)) continue;
		let end = index + 1;
		while (end < tree.children.length
			&& !(tree.children[end]?.type === 'element' && tree.children[end].tagName === 'h2')) end += 1;
		const oldHeading = tree.children[index];
		const details = {
			type: 'element',
			tagName: 'details',
			properties: oldHeading.properties?.id ? { id: oldHeading.properties.id } : {},
			children: [{
				type: 'element',
				tagName: 'summary',
				properties: {},
				children: oldHeading.children,
			}, ...tree.children.slice(index + 1, end)],
		};
		tree.children.splice(index, end - index, details);
	}
}

/** Keeps older translated generated pages aligned with the current presentation. */
export default function rehypeGeneratedPageSections() {
	return (tree, file) => {
		const path = relativePath(file);
		const kind = generatedPageKind(sourcePath(path), tree);
		if (kind) addPurposeHeading(tree, kind, handbookLocaleForPath(path));
		collapseTestSections(tree);
	};
}
