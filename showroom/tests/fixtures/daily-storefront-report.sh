#!/bin/sh
# Run against the disposable two-rooftop HTTP fixture after storefront-reports-http.mjs.
set -eu
pg=${1:?Pass the fixture PostgreSQL container}
app=${2:?Pass the fixture showroom container}
# The second fixture is an independent store until the HTTP isolation checks complete.
second=$(docker exec "$pg" psql -qAt -U showroom -d showroom -c "SELECT database_name FROM public.client_sites WHERE slug='other'")
test "$second" = client_10000000000000000000000000000002
previous=$(docker exec "$pg" psql -qAt -U showroom -d "$second" -c "SELECT to_regclass('storefront_review_reports')")
if test -n "$previous"; then
  runs=$(docker exec "$pg" psql -qAt -U showroom -d "$second" -c "SELECT count(*) FROM storefront_review_reports WHERE daily_date=(now() AT TIME ZONE 'America/New_York')::date")
  test "$runs" = 0 || { echo "Use a fresh daily-report fixture." >&2; exit 1; }
fi
docker exec -i "$pg" psql -q -v ON_ERROR_STOP=1 -U showroom -d "$second" <<'REPORT'
INSERT INTO client_profile(id,settings,etag) VALUES(1,'{"profile":{"siteTemplate":"franchise","driveTimezone":"America/New_York"}}','review-qa')
ON CONFLICT(id) DO UPDATE SET settings=jsonb_set(client_profile.settings,'{profile}','{"siteTemplate":"franchise","driveTimezone":"America/New_York"}');
REPORT
docker restart "$app" >/dev/null
for i in $(seq 1 95); do
  found=$(docker exec "$pg" psql -qAt -U showroom -d "$second" -c "SELECT count(*) FROM public.storefront_review_reports WHERE daily_date=(now() AT TIME ZONE 'America/New_York')::date AND report->>'source'='Daily check' AND report->>'host'='other.qa.test'" 2>/dev/null || true)
  if test "$found" = 1; then break; fi
  sleep 1
done
test "$found" = 1
echo "Verified automatic franchise scan on a separate rooftop after service startup."
