#!/usr/bin/env bash
# Carga las migraciones en un Postgres local limpio y ejecuta las pruebas.
# Cada fichero de pruebas empieza con una base de datos recién creada.
# Uso: PGHOST=/tmp PGPORT=5433 ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
H="${PGHOST:-/tmp}"; P="${PGPORT:-5433}"; U="${PGUSER:-postgres}"; DB="${PGDATABASE:-certi_pruebas}"
q() { psql -h "$H" -p "$P" -U "$U" -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }
preparar() {
  psql -h "$H" -p "$P" -U "$U" -q -d postgres -c "drop database if exists $DB" -c "create database $DB" 2>&1 | grep -v NOTICE || true
  q -f tests/00_auth_simulado.sql
  for m in migrations/*.sql; do q -f "$m"; done
}
FALLOS=0
for t in tests/[1-9]*.sql; do
  preparar
  if out=$(q -f "$t" 2>&1); then
    echo "$out" | grep -E "✓" | sed 's/^.*NOTICE:  /  /'
  else
    echo "✗ $t"; echo "$out" | sed 's/^/    /'; FALLOS=1
  fi
done
[ "$FALLOS" = 0 ] && echo "Todo en verde" || { echo "HAY FALLOS"; exit 1; }
