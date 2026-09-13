#!/usr/bin/env bash
# Loads backend/app/db_init.sql onto a Supabase (or any PostGIS) Postgres DB.
#
# Usage:
#   DATABASE_URL="postgresql://postgres.xxxx:password@aws-0-region.pooler.supabase.com:5432/postgres" \
#     ./scripts/load_schema.sh
#
# Or pass the URL as the first argument instead of an env var:
#   ./scripts/load_schema.sh "postgresql://postgres.xxxx:password@aws-0-region.pooler.supabase.com:5432/postgres"
#
# NOTE: use the plain `postgresql://` string here (no `+psycopg`) — that
# dialect suffix is only meaningful to SQLAlchemy, psql doesn't understand it.
# Re-running this script is safe; db_init.sql uses IF NOT EXISTS / ON CONFLICT
# DO NOTHING throughout.

set -euo pipefail

DB_URL="${1:-${DATABASE_URL:-}}"

if [[ -z "$DB_URL" ]]; then
  echo "Error: no database URL provided." >&2
  echo "Set DATABASE_URL or pass it as the first argument. See script header for usage." >&2
  exit 1
fi

if [[ "$DB_URL" == *"+psycopg"* ]]; then
  echo "Note: stripping '+psycopg' from the URL — psql needs a plain postgresql:// scheme." >&2
  DB_URL="${DB_URL/postgresql+psycopg:\/\//postgresql://}"
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is not installed. Install the postgresql-client package and retry." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/../backend/app/db_init.sql"

if [[ ! -f "$SQL_FILE" ]]; then
  echo "Error: could not find db_init.sql at $SQL_FILE" >&2
  exit 1
fi

echo "Checking existing tables..."
psql "$DB_URL" -c "\dt" || {
  echo "Error: could not connect to the database. Check the connection string (use the Supabase Session pooler, not the direct connection)." >&2
  exit 1
}

echo
echo "Loading schema from $SQL_FILE ..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_FILE"

echo
echo "Done. Verifying tables:"
psql "$DB_URL" -c "\dt"
echo
echo "Row counts:"
psql "$DB_URL" -c "SELECT 'hazards' AS table, count(*) FROM hazards
                    UNION ALL SELECT 'scenarios', count(*) FROM scenarios
                    UNION ALL SELECT 'layers', count(*) FROM layers
                    UNION ALL SELECT 'hazard_features', count(*) FROM hazard_features;"
