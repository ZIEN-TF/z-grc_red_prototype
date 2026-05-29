# Firmware analyzer image for Z-GRC RED.
# Build once on the server:
#   docker build -t zgrc-binwalk:latest -f docker/firmware-analyzer.Dockerfile docker
#
# Provides binwalk + common extraction backends. Runs read-only, no network
# (the app invokes it with --network=none --read-only data mounts).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      binwalk \
      p7zip-full \
      unzip \
      tar \
      gzip \
      bzip2 \
      xz-utils \
      zstd \
      cpio \
      squashfs-tools \
      e2fsprogs \
      mtd-utils \
      coreutils \
      findutils \
      grep \
      file \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /out
# Default command is overridden per-invocation by the app.
CMD ["binwalk", "--help"]
