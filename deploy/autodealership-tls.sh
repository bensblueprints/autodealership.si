#!/bin/sh
set -eu
root=/var/www/autodealership-si
mkdir -p "$root/.well-known/acme-challenge"
token=$(openssl rand -hex 16)
testfile="$root/.well-known/acme-challenge/$token"
trap 'rm -f "$testfile"' EXIT
printf %s "$token" > "$testfile"
for domain in autodealership.si demo.autodealership.si; do
  result=$(curl -fsSL --max-time 12 "http://$domain/.well-known/acme-challenge/$token") || exit 0
  [ "$result" = "$token" ] || exit 0
done
certbot --nginx --non-interactive --redirect --cert-name autodealership.si -d autodealership.si -d demo.autodealership.si
systemctl disable --now autodealership-tls.timer
