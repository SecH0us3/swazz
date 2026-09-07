#!/usr/bin/env bash
# Copyright (c) 2026 Swazz Authors
# This file is part of Swazz
# Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
# See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details
#
# Development-only Swazz Enterprise license keypair.
#
# Source this file from local dev / E2E scripts:  . scripts/dev-license-keys.sh
#
# The private half below is public — it is committed here and in
# packages/edge/src/services/license.ts (DEFAULT_DEV_LICENSE_PRIVKEY_HEX) — so
# anyone can mint a license with it. That is why released binaries never trust
# it: swazz-engine embeds no public key in source, and release builds link in
# the production key via
#   -ldflags "-X swazz-engine/internal/license.DefaultPublicKeyHex=<hex>"
#
# Exporting SWAZZ_LICENSE_PUBKEY here is what lets a locally built engine verify
# locally issued dev licenses. It never affects released artifacts.

SWAZZ_DEV_LICENSE_PUBKEY_HEX="0407b9eb6ca30fa7b7ef1f3b3b27d1aa6683b6c49cbb6b756561cfacc0597bef"
SWAZZ_DEV_LICENSE_PRIVKEY_HEX="302e020100300506032b657004220420b52bfb4e1736b2d3026e64fc4273b3703d1c3c993d6661a40b6f0c144678bef6"
export SWAZZ_DEV_LICENSE_PUBKEY_HEX SWAZZ_DEV_LICENSE_PRIVKEY_HEX

# Respect an explicitly provided key (e.g. when testing against a real license).
export SWAZZ_LICENSE_PUBKEY="${SWAZZ_LICENSE_PUBKEY:-$SWAZZ_DEV_LICENSE_PUBKEY_HEX}"
