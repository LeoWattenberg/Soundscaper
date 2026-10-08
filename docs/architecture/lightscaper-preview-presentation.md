<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Photo preview presentation ownership

This contract and its numeric budgets are recorded before implementation. The
View menu owns separate, initially disabled thumbnail and loupe choices. Import,
opening the library and selecting a photo do not enable either choice. The
existing library session owns one lazy preview scheduler and original access;
presentation receives only a photo ID, tier, shared pixel descriptor, output
length and digest, and an original-free raw preview Blob.

| Boundary | Hard bound |
| --- | --- |
| Visible page | 64 scalar photo IDs and thumbnail targets |
| Thumbnail backing | At most 1 MiB per target and 64 MiB per page |
| Loupe backing | One fit-screen target, at most 16 MiB |
| Compare backing | Exactly two fit-screen targets, at most 16 MiB each and 32 MiB combined; ordinary targets detach |
| Settled presentation | At most 80 MiB of declared RGBA canvas backing |
| Presentation demand | One requested body/read/paint at a time; no queued bodies |
| Body staging | One at most 16 MiB Blob and one at most 16 MiB owned read buffer |
| Accounted presentation phase | At most 112 MiB of backing, Blob and owned pixels |

These are compound phase budgets, not a whole-application or RSS claim. With
80 MiB of settled surfaces retained, the existing original decode phase adds
192 MiB of JavaScript working buffers: 272 MiB combined, or 336 MiB when counting
a separate retained original Blob backing of at most 64 MiB. The preparation
callback adds at most 160 MiB, giving 240 MiB combined, or 304 MiB with that
separate original Blob backing. Native decoder, canvas compositor and GPU
allocations remain separate. Serial demand and a joined presentation barrier
prevent multiplying the working sets across page or view generations.

Compare is an explicit profile of that same serial owner. Its two surfaces plus
one staged 16 MiB body and one 16 MiB owned buffer total at most 64 MiB in the
presentation phase, within the existing 112 MiB ceiling. It admits no thumbnail
targets and does not raise ordinary target limits. Registrations distinguish
ordinary and Compare profiles before React layout effects run; mixed active
registrations are refused. Null callbacks from retired profiles cannot detach
a new profile's target with the same photo ID. Cleanup tries every surface and
joins a held native stage even when a clear fails; bounded diagnostics retain
that failure independently of cancellation.

The shared body owner admits the closed descriptor, current processing profile,
geometry, genuine Blob size and declared output length before reading. It reads
one fixed ArrayBuffer, independently verifies the output SHA-256, invokes the
consumer and wipes the buffer in finally, including a read that completes after
cancellation. Incremental JavaScript SHA-256 reads borrowed spans of that buffer;
it does not call WebCrypto, slice the Blob or copy a payload-sized digest input,
and yields a real timer task between 1 MiB batches so cancellation can interrupt
verification.
Canvas uses an
ImageData view over the same fixed buffer. The 112 MiB claim is qualified only
after Chromium, Firefox and WebKit confirm that ImageData aliases this view.

The shared pixel descriptor remains depth and gamut agnostic. This first canvas
route explicitly admits unorm8 encoded sRGB and refuses other valid profiles
before body or canvas allocation. It does not silently convert a future profile
or introduce a persisted eight-bit schema. Pixels are already oriented, tightly
packed, top-left RGBA with straight alpha. Presentation performs no original
decode, EXIF transformation, resize, device-pixel-ratio backing expansion,
encoded image URL creation or catalog mutation.

The pinned WebKit context omits both alpha and color-space attributes. Missing
attributes alone do not qualify it: a fresh zero-size scratch context must ignore
an internally owned colorSpace option getter, identifying the legacy dictionary
route. This classification is an inference checked by native pixel goldens. The
[HTML Canvas standard](https://html.spec.whatwg.org/multipage/canvas.html#canvasrenderingcontext2dsettings)
defines the default color space as sRGB. A real 1×1 native clear and transparent-alpha readback on
the target additionally rejects an already opaque context. Pinned WebKit also
ignores alpha:false, so native qualification checks actual opacity rather than
assuming that requesting this option created an opaque context. Both probe surfaces
return to zero in finally; its four-byte backing and four-byte read buffer are
fixed overhead separate from the payload phase budget. Explicit unsupported
attributes, or a context that consumes colorSpace while omitting its declaration,
are refused. No probe converts the authenticated pixels.

Canvas dimensions begin at zero. Replacement clears the previous backing before
allocating its successor; detaching a target, changing page/factory/view and
unmount clear it to zero. A narrow controller owns scalar target registration,
one active request and the generation barrier. It cancels immediately and joins
late body staging before the next generation requests a body. React stores only
scalar progress/errors; it never retains a body, frame or ImageData. Delivery
releases the immutable Blob reference after painting, while owned read pixels
are wiped. Consumer failure follows the same cleanup path.
Operation and close promises are registered before invoking read ports or scalar
observers, so synchronous reentrant close still joins the owned work. Native
signal getters keep cancellation independent from caller-owned signal accessors.

The existing session remains the sole resource owner. Its factory transition
must join the previous session's scheduler close before allowing a new owner's
first preview request, because cancelling a scheduler observer can settle before
the underlying native job drains. Session close joins the scheduler before
closing catalog and media resources. The React presentation layer does not
create another session, persist previews as originals or alter original custody.

Native tests check asymmetric oriented opaque pixels and exact alpha values.
Canvas premultiplication can quantize partially transparent RGB on readback;
those checks permit a stated small RGB tolerance and never use canvas readback
to authenticate the authoritative raw output digest. They also qualify buffer
aliasing, release, stale-generation refusal and opt-in reachability. Root-owned
menu/session integration supplies the eventual user workflow; this foundation
alone makes no capability claim and requires no manual **Update AI assets** run.
