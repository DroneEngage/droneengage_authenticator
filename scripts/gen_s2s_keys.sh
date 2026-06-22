#!/bin/bash

# Generates an Ed25519 key pair used for Server-to-Server (S2S) authentication.
#
# Usage:
#   ./scripts/gen_s2s_keys.sh <server_id>
#
# Example:
#   ./scripts/gen_s2s_keys.sh AndruavLap
#
# Output (written to current directory, which is git-ignored):
#   <server_id>_private.pem   - PRIVATE key. Keep secret. Required by the server
#                               that CONNECTS out (comm servers, child relay servers).
#   <server_id>_public.pem    - PUBLIC key. Required by servers that ACCEPT peers
#                               (auth server, parent/super relay servers).
#
# Distribution:
#   - Copy <server_id>_private.pem to the server's ssl directory as s2s_ed25519_private.pem
#   - Copy <server_id>_public.pem to the accepting server's ssl directory with the
#     same name, and add it to the accepting server's s2s_trusted_server_keys config mapping.
#
# Re-running overwrites existing keys (and invalidates already-distributed keys).

set -e

if [ -z "$1" ]; then
    echo "Error: comm_server_id argument is required"
    echo "Usage: $0 <server_id>"
    echo "Example: $0 AndruavLap"
    exit 1
fi

SERVER_ID="$1"
OUT_DIR="$(pwd)"
PRIVATE_FILE="$OUT_DIR/${SERVER_ID}_private.pem"
PUBLIC_FILE="$OUT_DIR/${SERVER_ID}_public.pem"

mkdir -p "$OUT_DIR"

# Generate Ed25519 key pair using OpenSSL
openssl genpkey -algorithm Ed25519 -outform PEM -out "$PRIVATE_FILE"
openssl pkey -in "$PRIVATE_FILE" -pubout -outform PEM -out "$PUBLIC_FILE"

# Set restrictive permissions on private key
chmod 600 "$PRIVATE_FILE"

echo "S2S Ed25519 key pair generated for server '$SERVER_ID':"
echo "  private : $PRIVATE_FILE"
echo "  public  : $PUBLIC_FILE"
echo ""
echo "Distribution:"
echo "  1. Copy $PRIVATE_FILE to the server's ./ssl/ as s2s_ed25519_private.pem"
echo "  2. Copy $PUBLIC_FILE to the accepting server's ./ssl/ directory"
echo "  3. Add the public key to the accepting server's s2s_trusted_server_keys config:"
echo "     \"s2s_trusted_server_keys\": { \"$SERVER_ID\": \"./ssl/${SERVER_ID}_public.pem\" }"
