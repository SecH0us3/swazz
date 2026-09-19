-- Add email_verified flag to users table
ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;
