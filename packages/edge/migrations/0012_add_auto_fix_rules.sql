ALTER TABLE projects ADD COLUMN auto_fix_rules TEXT DEFAULT '["swazz/bola-idor", "swazz/network-error", "swazz/null-pointer-exception", "swazz/timeout"]';
