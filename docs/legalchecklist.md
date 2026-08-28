The repository has no independently authenticated legal approval yet. Its licensing matrix is an evidence register—not legal clearance—and stable 1.0 is still blocked by human licensing/patent decisions and web notice delivery. See [production-licensing-policy.md](/home/splowatt/git/Soundscaper/docs/production-licensing-policy.md:3) and [production-licensing-matrix.json](/home/splowatt/git/Soundscaper/config/production-licensing-matrix.json:833).

Use each checkbox as a written decision recording: approve/reject, exact artifacts, products, distribution channels, territories, commercial status, conditions, reviewer, and date.

## Stable 1.0 legal checklist

### Release-wide

- [x] Confirm which legal entity or individual distributes Soundscaper and Framescaper.
-- At the moment, it's kw.media with legal information at https://kw.media/impressum/
- [x] Confirm launch territories and channels: Cloudflare web app/assets, direct desktop downloads, package-manager-assisted installs, and any stores.
-- Global, cloudflare web app and electron downloads. No stores.
- [x] Approve AGPL-3.0-only as the application license, including network-source obligations and distribution of complete corresponding source.
- [x] Approve the GPL-to-AGPL compatibility position used for Audacity adaptations, StaffPad, JUCE’s AGPL arm, FFmpeg, and other GPL components.
- [x] Confirm contributor and asset ownership is sufficient to license every repository-owned portion.
- [x] Approve the aggregate third-party notice as legally sufficient, not merely version-correct.
- [x] Approve how licenses, notices, preferred source, modification notices, and relinking instructions are delivered on each distribution surface.
- [x] Perform the policy’s separate export-control/sanctions review for native software, cryptography, codecs, and downloadable AI models.
- [x] Decide whether release requires Terms of Use/EULA, warranty disclosures, acceptable-use terms, DMCA/contact procedures, or user-content representations. None is presently represented as a product legal artifact.
-- The EULA are just the AGPL.

### Web notice blocker

- [ ] Approve the content and placement of a stable web legal-notices route linked from both products.
- [ ] Approve delivery of matching notices with every separately versioned runtime/model asset.
- [ ] Do not clear the gate until that route actually exists; this is an engineering blocker, not something legal can waive. The current blocker is recorded at [production-licensing-matrix.json](/home/splowatt/git/Soundscaper/config/production-licensing-matrix.json:857).

### Audacity, MuseScore, and adapted material

- [x] Approve the GPLv3 treatment, attribution, modification notices, and source delivery for Audacity-derived effects, waveform rendering, AUP4 behavior/fixtures, translations, and StaffPad.
- [x] Approve use of Audacity-created AUP4 fixtures and compressed/derived interoperability data.
- [x] Approve the Audacity trademark disclaimer and confirm product copy does not imply affiliation or endorsement.
- [x] Approve use of the Audacity design-system packages based on package-level MIT declarations even though upstream supplies no LICENSE file.
- [x] Approve the same treatment for `MusescoreIcon.ttf` and its WOFF2 derivative, which lack separate font-license metadata.
- [x] Approve the GPL-3.0-only MuseScore icon-code inventory adaptation.

These issues are documented in [THIRD_PARTY_LICENSES.md](/home/splowatt/git/Soundscaper/THIRD_PARTY_LICENSES.md:3), including the missing standalone design-system/font license evidence at [line 545](/home/splowatt/git/Soundscaper/THIRD_PARTY_LICENSES.md:545).

### Current desktop codec distribution

- [x] Approve copyright-license compliance and corresponding-source delivery for the seven shipped WebAssembly providers: FLAC, Ogg Opus, Ogg Vorbis, WavPack, mpg123 MP2/MP3 decode, LAME MP3 encode, and TwoLAME MP2 encode.
- [x] Approve the LGPL replacement/relinking posture for mpg123, LAME, and TwoLAME.
- [x] For every launch territory, decide the patent position for those seven formats. The repository expressly makes no clearance or non-infringement claim.
- [x] Review Electron’s alternate Chromium `libffmpeg` and decide whether exact-byte verification and upstream’s “omit proprietary codecs” intent are adequate without a complete codec inventory.
- [x] Review the exact Media Foundation and AudioToolbox MP3/AAC tuples and decide whether platform-provided execution changes any patent or licensing requirement.
- [x] Review user-installed FFmpeg use—including WinGet/Homebrew installation—and decide whether enabling H.264/AAC MP4, VP9/Opus WebM, MP3, MP2, and other admitted operations is acceptable even though Soundscaper does not redistribute FFmpeg.
- [x] Approve the user-facing disclosure that an explicitly selected FFmpeg executable runs with the user account’s ordinary filesystem and network authority.

The required separation between copyright and patent review is stated at [production-licensing-policy.md](/home/splowatt/git/Soundscaper/docs/production-licensing-policy.md:169).

### Native audio and plug-in hosting

- [x] Approve selecting JUCE 9.0.1 under AGPL-3.0-only rather than its commercial license.
- [x] Approve the CoreAudio, WASAPI, PipeWire-header, and runtime ALSA system-library positions.
- [x] Approve ASIO SDK use under GPL-3.0-only and separately approve any “ASIO” name, trademark, or logo usage.
- [x] Approve per-platform hosting rules for VST3, CLAP, Audio Units, LV2, and OpenFX.
- [x] Confirm third-party plug-ins remain user-installed and are never redistributed.
- [x] Decide how incompatible plug-in EULAs, scanning, quarantine, vendor windows, crash isolation, and user consent are handled and disclosed.
-- not a legal problem. What users do with the software once they've downloaded it isn't for us to care about.
- [x] Approve the notice/source package delivered with each target-native helper.
- [x] Designate an independently controlled reviewer/signing authority for native-readiness attestations.
-- not necessary, the only contributor (me) is approving it. Remove the trust key nonsense.

The last item is a literal blocker: both trust-key lists are empty in [native-isolation-review-policy.json](/home/splowatt/git/Soundscaper/config/milestone-5-native-isolation-review-policy.json:3) and [package-release-authentication-policy.json](/home/splowatt/git/Soundscaper/config/milestone-5-package-release-authentication-policy.json:3).

### Framescaper native media: exact review scopes

Each tuple is intentionally a separate legal row; approval of one must not authorize another.

- [x] Hardware codec services: NVENC, Quick Sync, VideoToolbox, and VAAPI—per codec and territory.
- [x] Decode: H.264/MP4; H.264/MOV.
-- conditional approval if webcodecs/OS/ffmpeg are doing the decoding
- [x] Decode: HEVC/MP4; HEVC/MOV—including every relevant HEVC patent pool.
-- conditional approval if webcodecs/OS/ffmpeg are doing the decoding
- [x] Decode: VP9/WebM.
- [x] Decode: AV1/MP4; AV1/WebM—including the AOM patent-license posture.
- [x] Decode: ProRes/MOV, including format/trademark considerations.
-- conditional approval if webcodecs/OS/ffmpeg are doing the decoding
- [x] Decode: DNxHR/MXF, including format and patent considerations.
-- conditional approval if webcodecs/OS/ffmpeg are doing the decoding
- [x] Decode image sequences: PNG, TIFF, and OpenEXR.
- [x] Encode: H.264/MP4 through libx264.
-- conditional approval if webcodecs/OS/ffmpeg are doing the encoding
- [x] Encode: VP9/WebM through libvpx.
- [x] Encode: HEVC Main10/HDR10 MP4 and Main10/SDR MP4.
-- conditional approval if webcodecs/OS/ffmpeg are doing the encoding
- [x] Encode: ProRes Proxy, ProRes 422 HQ, and ProRes 4444 in MOV.
-- conditional approval if webcodecs/OS/ffmpeg are doing the encoding
- [x] Encode: DNxHR HQX/MXF.
-- conditional approval if webcodecs/OS/ffmpeg are doing the encoding
- [x] Encode: FFV1/Matroska.
- [x] Encode image sequences: PNG, TIFF, and OpenEXR.
- [x] Approve the common FFmpeg 9.0.1 GPL/corresponding-source/notice posture covering whichever tuples survive review.
-- approved if we don't ship FFmpeg ourselves (having users download it from winget/third party sources is fine)

All these rows remain blocked. Legal approval cannot substitute for the missing implementation, payload, interoperability, signing, and five-target evidence.

### Local AI models

For every approved model, sign off on four separate questions: code/weights licenses, training-data provenance, model-card/use restrictions, and versioned notices/hashes.

- [x] Ratify the 13 currently recorded as permitted: Silero VAD 6; Parakeet TDT 0.6b v2 and v3; Whisper large-v3-turbo; pyannote segmentation 3.0; 3D-Speaker ERes2Net; DeepFilterNet3; YuNet; D-FINE Nano; SigLIP2; nomic-embed-text v1.5; PP-OCRv4; and U²-Net-P.
- [x] Decide whether the incomplete or unpublished training-data inventories recorded for several “permitted” models are acceptable.
-- they are
- [x] Confirm required CC-BY-4.0 attribution, particularly for Parakeet weights.
- [x] Decide whether Spleeter’s MIT repository license covers its pretrained weights despite the unresolved upstream question.
-- acceptable risk
- [x] Decide whether Demucs weights may be distributed despite upstream never stating weight terms.
-- acceptable risk
- [x] Decide how a repository-produced TransNetV2 ONNX conversion can obtain a clean license traceable to MIT upstream.
-- acceptable risk
- [x] Complete licensing evidence for the pending wav2vec2, TIGER-DnR, PANNs Cnn10, Beat This, TransNetV2, and Qwen3 catalog candidates.
- [ ] Confirm the standing exclusion of the 11 refused model families: CrisperWhisper, MMS forced aligner, NVIDIA Sortformer, NVIDIA Canary 1B, madmom models, BeatNet, Open-Unmix UMxHQ, TEN VAD, Essentia models, BS-RoFormer community checkpoints, and BEATs AudioSet checkpoints.
-- not required for launch
- [x] Approve the EU R2 model-mirroring and offline notice-distribution arrangement.
- [x] Decide whether model-generated transcripts, labels, crops, and editorial text require additional user disclosures or limitations.
-- user problem, not our problem

The per-model decision rule is documented at [production-licensing-policy.md](/home/splowatt/git/Soundscaper/docs/production-licensing-policy.md:415); unresolved/refused records are in [production-licensing-matrix.json](/home/splowatt/git/Soundscaper/config/production-licensing-matrix.json:1702).

### Privacy, recording, and user content

- [x] Approve or replace the broad claim that the product “works entirely locally.” Model downloads, package-manager installs, Web VCR navigation, Cloudflare delivery/logging, and remote-site authentication need explicit treatment. The present claim is at [README.md](/home/splowatt/git/Soundscaper/README.md:32).
- [x] Publish a real privacy policy identifying operator/contact, data categories, device permissions, local storage, server/CDN logs, model downloads, retention, deletion, lawful basis where applicable, and user rights.
-- Published in English and German at `/privacy/en/` and `/privacy/de/`. Cloudflare HTTP log retention must remain disabled; Logpush and Web Analytics must remain unconfigured. Enabling retained logging or analytics requires a lawful-basis and consent review plus a policy update.
- [x] Decide whether analytics remain prohibited and whether Cloudflare operational logs count as collected personal data.
-- analytics are not prohibited per se. Cloudflare logs are personal data.
- [x] Approve camera, microphone, display, tab/system-audio, device-label, recovery-spool, and deletion disclosures.
- [x] Decide what notice or user representation is required for recording calls, meetings, system audio, or people in one-party/all-party-consent jurisdictions.
-- user problem, not ours
- [x] Approve the Web VCR persistent-profile/cookie boundary, clear-data behavior, and disclosure that remote sites receive navigation and interaction.
- [x] Decide whether Web VCR recording needs warnings about third-party terms, copyright, privacy, DRM, paywalls, and unauthorized capture.
-- user problem, not ours
- [x] Confirm local-assistance media never leaves the device and disclose that only model artifacts are downloaded.
- [x] Approve retention behavior for project media, recovery spools, captured intermediates, derivatives, model artifacts, and Web VCR site data.
- [x] Decide whether minors/age restrictions or sensitive-data warnings are required.
-- they are not

The implemented capture and Web VCR facts to review are in [framescaper-capture-privacy.md](/home/splowatt/git/Soundscaper/docs/framescaper-capture-privacy.md:11) and its [Web VCR section](/home/splowatt/git/Soundscaper/docs/framescaper-capture-privacy.md:125).

## Future-only legal gates

These do not authorize current stable functionality, but should stay blocked until separately approved:

- [ ] Reactivating legacy Web FFmpeg: complete source for all 13 enabled libraries plus exact product/territory/codec patent review.
- [ ] Externally authored web effect packages: complete dependency/license inventory, source pins, notices, redistribution, and ABI/sandbox terms.
- [ ] Lightscaper: raw decoder licensing, lens-profile database rights, camera-profile rights, new runtime assets, and HEIC/HEVC patents.
- [ ] Android/Google Play: public privacy policy, accurate Data Safety declaration, store terms, new distribution-surface notices, and deliberate license selection for the generated TWA shell. This is already required by [post-milestone-9-installable-distribution-plan.md](/home/splowatt/git/Soundscaper/docs/post-milestone-9-installable-distribution-plan.md:330).

The first actionable legal packets are therefore: release scope/territories, AGPL/GPL posture, aggregate notices, current codec patents, the 13 “permitted” model records, privacy/recording disclosures, and native/plugin policies. Everything else either depends on those decisions or still lacks engineering evidence that cannot be signed away.
