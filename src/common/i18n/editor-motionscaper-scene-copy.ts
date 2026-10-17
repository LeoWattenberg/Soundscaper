/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';
import { localeLanguage } from './locale.js';
const ENTRIES = [
	['motionscaperScene', '3D Scene and Quality', '3D-Szene und Qualität'],
	['motionscaperSceneHint', 'Edit base values here; existing keyframes and expressions stay active. The first enabled camera in the Timeline controls the view. Camera and spot-light forward direction is local +Z.', 'Bearbeite hier Grundwerte; vorhandene Schlüsselbilder und Ausdrücke bleiben aktiv. Die erste aktivierte Kamera in der Zeitleiste bestimmt die Ansicht. Die Vorwärtsrichtung von Kamera und Spotlicht ist lokal +Z.'],
	['motionscaperSceneAddCamera', 'Add Camera', 'Kamera hinzufügen'],
	['motionscaperSceneAddLight', 'Add Light', 'Licht hinzufügen'],
	['motionscaperSceneCamera', 'Camera', 'Kamera'],
	['motionscaperSceneLight', 'Light', 'Licht'],
	['motionscaperSceneLightType', 'Light type', 'Lichttyp'],
	['motionscaperSceneLight_ambient', 'Ambient', 'Umgebungslicht'],
	['motionscaperSceneLight_point', 'Point', 'Punktlicht'],
	['motionscaperSceneLight_spot', 'Spot', 'Spotlicht'],
	['motionscaperSceneTransform', 'Scene transform', 'Szenentransformation'],
	['motionscaperSceneIs3D', '3D layer', '3D-Ebene'],
	['motionscaperSceneAnchorX', 'Anchor X', 'Anker X'], ['motionscaperSceneAnchorY', 'Anchor Y', 'Anker Y'], ['motionscaperSceneAnchorZ', 'Anchor Z', 'Anker Z'],
	['motionscaperScenePositionX', 'Position X', 'Position X'], ['motionscaperScenePositionY', 'Position Y', 'Position Y'], ['motionscaperScenePositionZ', 'Position Z', 'Position Z'],
	['motionscaperSceneScaleX', 'Scale X factor', 'Skalierungsfaktor X'], ['motionscaperSceneScaleY', 'Scale Y factor', 'Skalierungsfaktor Y'], ['motionscaperSceneScaleZ', 'Scale Z factor', 'Skalierungsfaktor Z'],
	['motionscaperSceneRotationX', 'Rotation X degrees', 'Drehung X in Grad'], ['motionscaperSceneRotationY', 'Rotation Y degrees', 'Drehung Y in Grad'], ['motionscaperSceneRotationZ', 'Rotation Z degrees', 'Drehung Z in Grad'],
	['motionscaperSceneApplyTransform', 'Apply Scene Transform', 'Szenentransformation anwenden'],
	['motionscaperSceneProjection', 'Projection', 'Projektion'], ['motionscaperSceneProjection_perspective', 'Perspective', 'Perspektivisch'], ['motionscaperSceneProjection_orthographic', 'Orthographic', 'Orthografisch'],
	['motionscaperSceneZoom', 'Camera zoom', 'Kamerazoom'], ['motionscaperSceneNear', 'Near clipping distance', 'Nahbegrenzung'], ['motionscaperSceneFar', 'Far clipping distance', 'Fernbegrenzung'],
	['motionscaperSceneFocusDistance', 'Focus distance', 'Fokusentfernung'], ['motionscaperSceneAperture', 'Aperture diameter', 'Blendendurchmesser'], ['motionscaperSceneApplyCamera', 'Apply Camera', 'Kamera anwenden'],
	['motionscaperSceneIntensity', 'Light intensity', 'Lichtintensität'], ['motionscaperSceneConeAngle', 'Cone angle degrees', 'Kegelwinkel in Grad'], ['motionscaperSceneConeFeather', 'Cone feather', 'Weiche Kegelkante'],
	['motionscaperSceneCastsShadows', 'Cast shadows', 'Schatten werfen'], ['motionscaperSceneApplyLight', 'Apply Light', 'Licht anwenden'],
	['motionscaperSceneMaterial', 'Material', 'Material'], ['motionscaperSceneAcceptsLights', 'Respond to lights', 'Auf Licht reagieren'], ['motionscaperSceneReceivesShadows', 'Receive shadows', 'Schatten empfangen'],
	['motionscaperSceneAmbient', 'Ambient response', 'Umgebungslichtanteil'], ['motionscaperSceneDiffuse', 'Diffuse response', 'Diffuser Anteil'], ['motionscaperSceneSpecular', 'Specular response', 'Glanzlichtanteil'], ['motionscaperSceneShininess', 'Shininess', 'Glanzexponent'],
	['motionscaperSceneApplyMaterial', 'Apply Material', 'Material anwenden'], ['motionscaperSceneQuality', 'Composition render quality', 'Renderqualität der Komposition'],
	['motionscaperSceneMotionBlur', 'Motion blur', 'Bewegungsunschärfe'], ['motionscaperSceneShutterOpen', 'Shutter open offset in frames', 'Verschlussbeginn in Frames'], ['motionscaperSceneShutterClose', 'Shutter close offset in frames', 'Verschlussende in Frames'],
	['motionscaperSceneTemporalSamples', 'Motion samples', 'Bewegungsabtastungen'], ['motionscaperSceneLensOverride', 'Set depth of field quality', 'Tiefenschärfequalität festlegen'], ['motionscaperSceneLensSamples', 'Lens samples', 'Linsenabtastungen'],
	['motionscaperSceneQualityHint', 'Shutter offsets accept exact fractions from −1 to 1 frame. Motion and lens quality each allow 1–64 samples. Depth of field defaults to 16 samples and requires a camera aperture above zero. Preview and export share these settings.', 'Verschlusszeiten erlauben exakte Brüche von −1 bis 1 Frame. Bewegung und Linse erlauben jeweils 1–64 Abtastungen. Tiefenschärfe verwendet standardmäßig 16 Abtastungen und benötigt eine Kamerablende größer null. Vorschau und Export nutzen diese Einstellungen.'],
	['motionscaperSceneApplyQuality', 'Apply Render Quality', 'Renderqualität anwenden'],
] as const;
export const MOTIONSCAPER_SCENE_COPY_BY_LOCALE = Object.freeze({ en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))), de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))) });
export function resolveMotionscaperSceneCopy(locale: string, overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, string>> {
	return resolveEditorCopyScope('motionscaper-scene', localeLanguage(locale) === 'de' ? MOTIONSCAPER_SCENE_COPY_BY_LOCALE.de : MOTIONSCAPER_SCENE_COPY_BY_LOCALE.en, overrides);
}
