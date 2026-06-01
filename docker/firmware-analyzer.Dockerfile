# Firmware analyzer image for Z-GRC RED.
# Build once on the server:
#   docker build -t zgrc-binwalk:latest -f docker/firmware-analyzer.Dockerfile docker
#
# binwalk + a broad extraction toolchain so vendor firmware filesystems
# (squashfs / jffs2 / ubi / cramfs / ext / cpio / nested archives) actually
# unpack — extraction quality directly determines AI grounding quality.
# Runs read-only, no network (the app invokes it with --network=none).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      binwalk \
      # generic archive/compression backends
      p7zip-full unzip unar tar gzip bzip2 xz-utils zstd lz4 lzop cpio cabextract \
      # filesystem extractors
      squashfs-tools e2fsprogs mtd-utils sleuthkit \
      # misc analysis tools
      device-tree-compiler binutils file ca-certificates coreutils findutils grep \
      # build deps for sasquatch + pip extractors
      python3 python3-pip git wget build-essential \
      zlib1g-dev liblzo2-dev liblzma-dev liblzo2-2 \
    && rm -rf /var/lib/apt/lists/*

# JFFS2 / UBI(FS) extractors used by binwalk (and standalone). Best-effort.
RUN pip3 install --no-cache-dir --break-system-packages \
      jefferson ubi_reader python-lzo cstruct || true

# sasquatch — patched unsquashfs that handles non-standard vendor squashfs
# (very common in IoT firmware). Best-effort: if the build fails the image
# still works with standard unsquashfs from squashfs-tools.
RUN git clone --depth 1 https://github.com/devttys0/sasquatch /tmp/sasquatch \
      && cd /tmp/sasquatch && (./build.sh || true) \
      && rm -rf /tmp/sasquatch \
    ; true

WORKDIR /out
# Default command is overridden per-invocation by the app.
CMD ["binwalk", "--help"]
