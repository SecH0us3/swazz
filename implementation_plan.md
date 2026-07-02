# Implementation Plan: Task 87 (Project Invitations & RBAC)

## 1. Schema & Database Migrations
- **Permissions Config:** Define a static configuration in code containing all available permissions (e.g., `get:/api/projects/:id/users`) and their human-readable descriptions (e.g., "View project members").
- **Database Tables:**
  - `roles`: `id`, `project_id` (NULL for defaults like Owner/Editor/Viewer), `name`, `is_default`, `created_at`.
  - `role_permissions`: `role_id`, `permission_key`.
  - `role_inheritance`: `parent_role_id`, `child_role_id`.
  - `project_members`: `project_id`, `user_id`.
  - `project_member_roles`: `project_id`, `user_id`, `role_id` (allows a user to have multiple roles).
  - `project_invitations`: `id`, `project_id`, `email`, `username`, `target_role_ids` (JSON or junction table), `status` (Pending, Accepted, Expired, Revoked), `token`, `expires_at`.

## 2. Edge Coordinator Backend (RBAC & API)
- **RBAC Middleware:** 
  - Intercept API requests to `/api/projects/:id/*`.
  - Identify the current user and fetch their assigned roles for the project.
  - Recursively expand roles to find all inherited roles (up to a maximum inheritance depth of 3).
  - Resolve all permissions for the expanded role set.
  - Assert that the current `METHOD:/route` exists in the resolved permissions set.
- **API Endpoints:**
  - `GET /api/projects/:id/members`: List users and their assigned roles.
  - `POST /api/projects/:id/invitations`: Create a project invitation by email or username.
  - `GET /api/projects/:id/roles`: List all default and project-specific custom roles.
  - `POST /api/projects/:id/roles`: Create a custom role (assign permissions, include child roles).
  - `PUT /api/projects/:id/roles/:role_id`: Edit a custom role (default roles reject edits).
  - `POST /api/projects/invitations/accept`: Endpoint to accept an invitation token.

## 3. Web Frontend (React UI)
- **Members Tab:** Add a "Members & Roles" section inside Project Settings.
- **Users List:** Display a table/list of current project users and their assigned roles.
- **Roles List & Management:**
  - Display default roles (read-only UI).
  - Interface to create/edit custom roles.
  - Checkbox grid or list to select permissions (showing the human-readable description for each).
  - Dropdown to select child roles for inheritance (validation to ensure we don't break the depth limit or create cycles).
- **Invitations:** Modal to invite a user via username or email, selecting their roles.

## 4. Documentation Updates
- **ROADMAP.md**: Update to reflect progress.
- **README.md / docs**: Create/update documentation detailing the RBAC system, the permission definition config, the depth-limit rules for role inheritance, and API changes.
