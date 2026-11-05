-- swagger_cache is keyed per user ("user:<id>|<url>") since the fix for cross-tenant
-- spec leaks. Rows keyed by a bare URL are never read again; drop them. Their specs/parsed and
-- specs/raw R2 objects are not reachable from D1 any more and can be removed out of band.
DELETE FROM swagger_cache WHERE url NOT LIKE 'user:%';
