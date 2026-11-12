---
name: Nix runtime compatibility
description: Native-library ABI mismatches during one-off tooling, without adding application dependencies.
---

Installed Nix libraries and the default scripting runtime can belong to different
glibc generations. A library existing on disk does not prove that the default
Python process can load it.

**Why:** A one-off operation using an already installed cryptographic library
failed because its newer libpthread required a glibc ABI absent from Python's
loader. Trying other installed library versions did not resolve the mismatch.

**How to apply:** Check the actual loader/ABI error and align the temporary
process's loader and libc with the library. Verify current installed paths;
do not persist store hashes or add a runtime application dependency just to
complete an operational task. Never expose credentials while diagnosing tooling.
