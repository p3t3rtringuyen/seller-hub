-- Up Migration
-- Source: db/design/99_partitions.sql (P2-DATA, frozen reference). Verbatim copy; packages/testing/test/platform-db.test.ts keeps them identical.
-- seller-hub data model — 99 initial partitions
-- Creates monthly partitions for every range-partitioned table in seller-hub schemas.
-- Window: facts get 25 months back (24-month Ads v1 date retention + current) to 3 months ahead;
-- operational logs (job runs, raw index, audit, change history) get the current month back to 3 ahead.
-- After this, the maintenance job (`maintenance.partitions`, daily) keeps 3 months ahead and drops
-- partitions past retention; backfill jobs call core.ensure_monthly_partitions for their window first.
-- In P3 each module's migration calls core.ensure_monthly_partitions for its own tables instead of this file.

do $$
declare
  r record;
  back_months integer;
begin
  for r in
    select c.oid::regclass as tbl, n.nspname as schema_name
      from pg_partitioned_table p
      join pg_class c on c.oid = p.partrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('facts', 'ingest', 'ops')
       and not c.relispartition
  loop
    back_months := case when r.schema_name = 'facts' then 25 else 1 end;
    perform core.ensure_monthly_partitions(
      r.tbl,
      (date_trunc('month', now()) - make_interval(months => back_months))::date,
      (date_trunc('month', now()) + interval '3 months')::date);
  end loop;
end $$;
