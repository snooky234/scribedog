# CMake toolchain file for the bundled whisper.cpp build (whisper-rs-sys).
#
# Why this exists: whisper-rs-sys builds whisper.cpp with GGML_NATIVE=ON, i.e.
# -march=native — optimized for whatever CPU ran the compiler. That is fine for
# a local `tauri dev` build, but release installers are built on GitHub Actions
# runners, so the shipped binary ends up tuned for the runner's CPU and can fall
# back to slow scalar GEMM kernels on the user's machine (reported ~4x slower
# transcription than a locally built ScribeDog).
#
# The fix is to stop tuning for the build host and instead compile a fixed SIMD
# baseline that every target machine is guaranteed to support: AVX2 + FMA +
# F16C, i.e. Intel Haswell (2013) / AMD Excavator (2015) and newer. That covers
# effectively the whole install base while keeping the vectorized matrix
# kernels that make transcription fast.
#
# Note: ggml's GGML_CPU_ALL_VARIANTS (compile several backends, pick the best at
# runtime) would be the nicer option, but it requires GGML_BACKEND_DL, which
# needs shared libraries — and whisper-rs-sys hardcodes BUILD_SHARED_LIBS=OFF
# and links ggml statically. Revisit if whisper-rs gains a feature flag for it.
#
# Wired up via CMAKE_TOOLCHAIN_FILE in .cargo/config.toml.

set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_AVX ON CACHE BOOL "" FORCE)
set(GGML_AVX2 ON CACHE BOOL "" FORCE)
set(GGML_FMA ON CACHE BOOL "" FORCE)
set(GGML_F16C ON CACHE BOOL "" FORCE)

# Restore the MSVC optimization flags that the `cmake` crate strips.
#
# whisper-rs-sys always builds `--config Release`, but the `cmake` crate
# *overwrites* CMAKE_<LANG>_FLAGS_<CONFIG> with a flag set it derives from `cc`
# instead of appending to it — and for MSVC that set carries no optimization
# flag at all (` -nologo -MD -Brepro -W0`). Which config gets clobbered depends
# on the Cargo profile:
#
#   cargo build            -> whisper-rs-sys also sets CMAKE_BUILD_TYPE=
#                             RelWithDebInfo, so the damage lands on a config
#                             that is never built; Release keeps /O2 /Ob2 /DNDEBUG
#   cargo build --release  -> the damage lands on Release itself, i.e. ggml is
#                             compiled with MSVC's default /Od and without NDEBUG
#
# Measured effect: transcription took ~7.1 s in the release build vs. ~1.55 s in
# the debug build for the same audio. Toolchain files are processed after the
# -D cache entries are seeded, so a FORCE'd set here wins over the crate's.
#
# Guarded on the MSVC-shaped flag string rather than on `MSVC`, which is not yet
# defined the first time a toolchain file is read; the /O2 check keeps repeated
# inclusions idempotent and makes this inert if the crate ever stops clobbering.
if(CMAKE_C_FLAGS_RELEASE MATCHES "nologo" AND NOT CMAKE_C_FLAGS_RELEASE MATCHES "[/-]O[12x]")
    message(STATUS "whisper-toolchain: re-adding /O2 /Ob2 /DNDEBUG to the Release config")
    set(CMAKE_C_FLAGS_RELEASE "${CMAKE_C_FLAGS_RELEASE} /O2 /Ob2 /DNDEBUG" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /O2 /Ob2 /DNDEBUG" CACHE STRING "" FORCE)
endif()
