# Lightscaper output color profiles

Lightscaper's Current PNG export offers sRGB and Display P3 at 8 or 16 bits.
The profile selector belongs to the existing export dialog. Develop's existing
Settings menu also opens **Soft proof…**, a temporary presentation choice for
After. Before continues to show the canonical sRGB Original. Soft proof does
not change a recipe, history, preset, Original, decoder receipt or asset pack.

## Output boundary

The shared Develop working space stays linear sRGB/BT709 D65 for native word
and float inputs. Ordinary byte Develop keeps its existing encoded sRGB byte
route. Selecting P3 PNG8 does not promote that route to floating-point Develop.
Explicit PNG16 keeps its existing byte-Original promotion behavior.

Develop, resizing, output sharpening, graphics and text finish before output
color conversion. The shared scalar converter composes the
[CSS Color 4 sRGB-to-XYZ-D65 and XYZ-D65-to-Display-P3 matrices](https://www.w3.org/TR/css-color/#color-conversion-code).
Both whites are D65. Native signed and above-one samples reach this conversion
without an intermediate sRGB byte clip. Only target-primary samples are clipped,
encoded with the sRGB transfer function, and quantized to the selected depth.
Straight alpha receives no color transform, including hidden RGB at zero alpha.

PNG encoding streams those final codes with one reusable four-code scratch
array. It does not allocate another Float32 image. The existing compression,
rolling storage, output limits, cancellation and joined cleanup contracts remain
in force. The output ledger includes retained source/render backings, optional
watermark resources, output planes and the remaining codec budget.

P3 PNGs declare `cICP [12, 13, 0, 1]` before IDAT, as specified by
[PNG Third Edition](https://www.w3.org/TR/png-3/#cICP-chunk). They have no conflicting
sRGB or ICC declaration. Capture metadata declares [Exif 2.32 ColorSpace](https://www.cipa.jp/std/documents/e/DC-X008-Translation-2019-E.pdf)
`65535` (uncalibrated), rather than falsely declaring sRGB. Strip removes descriptive
metadata while retaining the color declaration. The profiled container owner
checks color declaration, depth, order and CRC before either scope can publish.
P3 JPEG requests refuse before opening the Save picker: a matching JPEG ICC
output path has not been implemented.

Output3 explicitly records `schemaVersion: 3`, `profile: 'srgb' | 'display-p3'`
and `bitDepth: 8 | 16` beside the unchanged sizing, sharpening, watermark and
metadata fields. Current presets, batch plans, journals and reviewed recovery
retain the complete output. Permanent unversioned and Output2 readers remain
closed. Existing sRGB entry points preserve their bytes; a historical witness
compares the extracted PNG16 and TIFF kernels against the preceding commit.

## Temporary proof presentation

The selected output profile and depth are applied after the same evaluated
Develop frame. The selected-depth codes determine clipping counts; the canvas
projection is eight bits. A 16-bit value projected into display bin 255 is not
therefore counted as a clipped 16-bit value. Proof is a color-profile/depth
simulation, not a printer, paper, custom ICC or physical-monitor calibration.

Display P3 painting requires a native P3 canvas context, matching ImageData and
actual native readback. A small owned probe checks both exact P3 primary
retention and conversion of sRGB red/green into P3. Declared attributes alone
are insufficient. Unsupported presentation reports unavailable while retaining
the user's selection; sRGB proof remains available. The existing sRGB painter
keeps its closed contract.

After receives a fresh canvas when the selected profile changes. The preceding
presentation pauses and joins before the replacement borrows the Original or
paints. Before retains its separate sRGB target. Proof, fit, overlay and canvas
scratch retire after their consumers join, including cancellation and failures.
The menu dialog retains only scalar state and never grants source authority.

## Qualification scope

Qualification passes 516 selected Lightscaper cases in 72 files, four
English/German Chromium/Firefox RAW workflows, and 17 historical PNG16/TIFF byte
comparisons. All five production product compositions typecheck. The decoder's
30 pinned ABI1/ABI2 source and runtime files remain byte-identical.

Focused Lightscaper tests cover independent color-matrix references, literal P3
primary codes, PNG scanlines and CRCs, metadata truth, historical sRGB bytes,
Current persistence, actual RAW export, temporary presentation and native canvas
capability refusal. Browser qualification uses actual production RAW workers,
Current storage and downloaded PNGs; its observer only reads native custody.

The installed Chromium demonstrates native P3 presentation and P3 PNG decoding.
The installed Firefox returns an sRGB canvas for a P3 request, so P3 proof must
refuse there. Standards-compliant P3 PNG export is independent of that display
capability. These observations do not certify other browser versions, monitors,
HDR display, arbitrary ICC profiles or desktop color management. L7's remaining
GPU, HDR and desktop work and the roadmap's final integration gates remain open.

No assistance runtime source, recipe, dependency closure, archive, signing or
supported target changes. This change does not require **Update AI assets**.
