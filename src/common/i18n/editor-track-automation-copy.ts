/* SPDX-License-Identifier: AGPL-3.0-only */

const ENGLISH = Object.freeze({
	automation: 'automation',
	addAutomation: 'Add automation',
	automationParameter: 'Automation parameter',
	automationMode: 'Automation mode',
	automationRead: 'Read',
	automationTrim: 'Trim',
	automationTouch: 'Touch',
	automationLatch: 'Latch',
	automationWrite: 'Write',
	automationInsertPoint: 'Insert automation point',
	automationCurveMenu: 'Automation curve',
	automationDeleteLane: 'Delete automation lane',
	automationSegmentHold: 'Hold',
	automationSegmentLinear: 'Linear',
	automationSegmentEased: 'Eased',
	automationSegmentBezier: 'Bézier',
	automationFirstBezierControl: 'first Bézier control',
	automationSecondBezierControl: 'second Bézier control',
});

const GERMAN = Object.freeze({
	automation: 'Automation',
	addAutomation: 'Automation hinzufügen',
	automationParameter: 'Automationsparameter',
	automationMode: 'Automationsmodus',
	automationRead: 'Lesen',
	automationTrim: 'Trimmen',
	automationTouch: 'Berühren',
	automationLatch: 'Einrasten',
	automationWrite: 'Schreiben',
	automationInsertPoint: 'Automationspunkt einfügen',
	automationCurveMenu: 'Automationskurve',
	automationDeleteLane: 'Automationsspur löschen',
	automationSegmentHold: 'Halten',
	automationSegmentLinear: 'Linear',
	automationSegmentEased: 'Geglättet',
	automationSegmentBezier: 'Bézier',
	automationFirstBezierControl: 'erster Bézier-Anfasser',
	automationSecondBezierControl: 'zweiter Bézier-Anfasser',
});


export const TRACK_AUTOMATION_COPY_BY_LOCALE = Object.freeze({ en: ENGLISH, de: GERMAN });
