# Photo library hook lifecycle qualification

Budget recorded before fixtures: each case owns one React test root, at most two
session-factory generations, one active action per generation, and one held
factory or page promise. Pages and import results contain one scalar item; the selected File is
one byte. All deferred work settles before the test restores the fake document.
No timers, storage, image decoding, browser builds or production changes enter
this packet.

The cases exercise factory replacement while a page is pending, suppression of
its late result, cleanup of an owner whose factory resolves after unmount, and
an effect-started action racing the generation-reset microtask. StrictMode also
checks that repeated effect setup creates no owner before a requested action and
that the requested owner closes exactly once. Assertions inspect public hook
state, cancellation and ownership calls rather than private implementation.
