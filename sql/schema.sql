-- Swipr + Quality on SQL Server. GENERATED from the real PostgreSQL catalog (tools/gen-mssql-schema.cjs); idempotent.
-- Run by the DBA (or by the app with AUTO_INIT_DB=true) — statements are separated by lines that contain only GO.
-- Conventions: EVERY text column carries the same BINARY collation (PostgreSQL compares text case-sensitively, and two columns with
-- different collations cannot be compared in SQL Server at all); keys are NVARCHAR(450) so they can be indexed, the rest NVARCHAR(MAX); JSON documents are NVARCHAR(MAX) with ISJSON checks; timestamps are DATETIME2(6) in UTC; epoch-ms columns stay BIGINT.
SET NOCOUNT ON;
GO
IF OBJECT_ID(N'dbo._migrations', N'U') IS NULL
CREATE TABLE dbo.[_migrations] (
  [name] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [done_at] BIGINT NULL,
  CONSTRAINT [pk__migrations] PRIMARY KEY ([name])
);
GO
IF OBJECT_ID(N'dbo.attendance', N'U') IS NULL
CREATE TABLE dbo.[attendance] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [user_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [kind] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [ts] BIGINT NOT NULL,
  [brand] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [branch] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [department] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT [pk_attendance] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'attendance_user_idx' AND object_id = OBJECT_ID(N'dbo.attendance'))
CREATE INDEX [attendance_user_idx] ON dbo.[attendance] ([user_id], [ts] DESC);
GO
IF OBJECT_ID(N'dbo.attendance_daily', N'U') IS NULL
CREATE TABLE dbo.[attendance_daily] (
  [user_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [date] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [scheduled_start] BIGINT NULL,
  [scheduled_end] BIGINT NULL,
  [arrival_ts] BIGINT NULL,
  [departure_ts] BIGINT NULL,
  [offset_min] INT NULL,
  [early_leave_min] INT NULL,
  [punch_count] INT NOT NULL DEFAULT 0,
  [status] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [day_type] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [computed_at] BIGINT NOT NULL,
  [reviewed_by] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [reviewed_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [reviewed_at] BIGINT NULL,
  [review_action] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT [pk_attendance_daily] PRIMARY KEY ([user_id], [date])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'attendance_daily_date_idx' AND object_id = OBJECT_ID(N'dbo.attendance_daily'))
CREATE INDEX [attendance_daily_date_idx] ON dbo.[attendance_daily] ([date]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'attendance_daily_status_idx' AND object_id = OBJECT_ID(N'dbo.attendance_daily'))
CREATE INDEX [attendance_daily_status_idx] ON dbo.[attendance_daily] ([status]);
GO
IF OBJECT_ID(N'dbo.attendance_suppressed', N'U') IS NULL
CREATE TABLE dbo.[attendance_suppressed] (
  [user_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [ts] BIGINT NOT NULL,
  CONSTRAINT [pk_attendance_suppressed] PRIMARY KEY ([user_id], [ts])
);
GO
IF OBJECT_ID(N'dbo.audit_log', N'U') IS NULL
CREATE TABLE dbo.[audit_log] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [ts] BIGINT NOT NULL,
  [actor_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [actor_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [action] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [entity_type] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [entity_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [summary] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [details] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT [ck_audit_log_details_json] CHECK (ISJSON([details]) = 1),
  CONSTRAINT [pk_audit_log] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'audit_log_ts_idx' AND object_id = OBJECT_ID(N'dbo.audit_log'))
CREATE INDEX [audit_log_ts_idx] ON dbo.[audit_log] ([ts] DESC);
GO
IF OBJECT_ID(N'dbo.break_freezes', N'U') IS NULL
CREATE TABLE dbo.[break_freezes] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [scope_type] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [scope_key] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [starts_at] BIGINT NOT NULL,
  [ends_at] BIGINT NOT NULL,
  [reason] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [created_by_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [created_by_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [created_at] BIGINT NOT NULL,
  CONSTRAINT [pk_break_freezes] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'break_freezes_scope_idx' AND object_id = OBJECT_ID(N'dbo.break_freezes'))
CREATE INDEX [break_freezes_scope_idx] ON dbo.[break_freezes] ([scope_type], [scope_key], [ends_at]);
GO
IF OBJECT_ID(N'dbo.breaks', N'U') IS NULL
CREATE TABLE dbo.[breaks] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [user_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [started_at] BIGINT NOT NULL,
  [ended_at] BIGINT NULL,
  [ended_by_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [ended_by_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [ended_by_role] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [source] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL DEFAULT N'swipr',
  [xontel_session_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NULL,
  [xontel_status] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [xontel_hold] BIT NOT NULL DEFAULT 0,
  CONSTRAINT [pk_breaks] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'breaks_one_active_idx' AND object_id = OBJECT_ID(N'dbo.breaks'))
CREATE UNIQUE INDEX [breaks_one_active_idx] ON dbo.[breaks] ([user_id]) WHERE ended_at IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'breaks_user_idx' AND object_id = OBJECT_ID(N'dbo.breaks'))
CREATE INDEX [breaks_user_idx] ON dbo.[breaks] ([user_id], [started_at] DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'breaks_xontel_session_idx' AND object_id = OBJECT_ID(N'dbo.breaks'))
CREATE INDEX [breaks_xontel_session_idx] ON dbo.[breaks] ([xontel_session_id]) WHERE xontel_session_id IS NOT NULL;
GO
IF OBJECT_ID(N'dbo.call_logs', N'U') IS NULL
CREATE TABLE dbo.[call_logs] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [started_at] BIGINT NOT NULL,
  [answered_at] BIGINT NULL,
  [ended_at] BIGINT NULL,
  [duration_sec] INT NOT NULL DEFAULT 0,
  [caller_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [caller_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [callee_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [callee_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [status] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [ring_delivered] BIT NOT NULL DEFAULT 0,
  [push_sent] BIT NOT NULL DEFAULT 0,
  [ended_by] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT [pk_call_logs] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'call_logs_callee_idx' AND object_id = OBJECT_ID(N'dbo.call_logs'))
CREATE INDEX [call_logs_callee_idx] ON dbo.[call_logs] ([callee_id]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'call_logs_caller_idx' AND object_id = OBJECT_ID(N'dbo.call_logs'))
CREATE INDEX [call_logs_caller_idx] ON dbo.[call_logs] ([caller_id]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'call_logs_started_idx' AND object_id = OBJECT_ID(N'dbo.call_logs'))
CREATE INDEX [call_logs_started_idx] ON dbo.[call_logs] ([started_at] DESC);
GO
IF OBJECT_ID(N'dbo.call_recordings', N'U') IS NULL
CREATE TABLE dbo.[call_recordings] (
  [call_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [mime] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [bytes] INT NOT NULL,
  [created_at] BIGINT NOT NULL,
  [audio] VARBINARY(MAX) NOT NULL,
  CONSTRAINT [pk_call_recordings] PRIMARY KEY ([call_id])
);
GO
IF OBJECT_ID(N'dbo.evaluations', N'U') IS NULL
CREATE TABLE dbo.[evaluations] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [employee_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [data] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [created_at] BIGINT NOT NULL,
  CONSTRAINT [ck_evaluations_data_json] CHECK (ISJSON([data]) = 1),
  CONSTRAINT [pk_evaluations] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'evaluations_employee_idx' AND object_id = OBJECT_ID(N'dbo.evaluations'))
CREATE INDEX [evaluations_employee_idx] ON dbo.[evaluations] ([employee_id], [created_at] DESC);
GO
IF OBJECT_ID(N'dbo.fcm_tokens', N'U') IS NULL
CREATE TABLE dbo.[fcm_tokens] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [user_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [token] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [created_at] BIGINT NOT NULL,
  CONSTRAINT [pk_fcm_tokens] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'fcm_tokens_token_key' AND object_id = OBJECT_ID(N'dbo.fcm_tokens'))
CREATE UNIQUE INDEX [fcm_tokens_token_key] ON dbo.[fcm_tokens] ([token]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'fcm_tokens_user_idx' AND object_id = OBJECT_ID(N'dbo.fcm_tokens'))
CREATE INDEX [fcm_tokens_user_idx] ON dbo.[fcm_tokens] ([user_id]);
GO
IF OBJECT_ID(N'dbo.kpi_targets', N'U') IS NULL
CREATE TABLE dbo.[kpi_targets] (
  [key] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [value] FLOAT NOT NULL,
  [updated_by] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [updated_at] BIGINT NOT NULL,
  CONSTRAINT [pk_kpi_targets] PRIMARY KEY ([key])
);
GO
IF OBJECT_ID(N'dbo.leave_requests', N'U') IS NULL
CREATE TABLE dbo.[leave_requests] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [data] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [created_at] BIGINT NULL,
  CONSTRAINT [ck_leave_requests_data_json] CHECK (ISJSON([data]) = 1),
  CONSTRAINT [pk_leave_requests] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.notifications', N'U') IS NULL
CREATE TABLE dbo.[notifications] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [user_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [type] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [title] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [body] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [created_at] BIGINT NULL,
  [read_at] BIGINT NULL,
  CONSTRAINT [pk_notifications] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'notifications_user_idx' AND object_id = OBJECT_ID(N'dbo.notifications'))
CREATE INDEX [notifications_user_idx] ON dbo.[notifications] ([user_id], [created_at] DESC);
GO
IF OBJECT_ID(N'dbo.overtime_sessions', N'U') IS NULL
CREATE TABLE dbo.[overtime_sessions] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [user_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [started_at] BIGINT NOT NULL,
  [started_by_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [started_by_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [ended_at] BIGINT NULL,
  [ended_by_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [ended_by_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [ended_by_role] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT [pk_overtime_sessions] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'overtime_sessions_one_active_idx' AND object_id = OBJECT_ID(N'dbo.overtime_sessions'))
CREATE UNIQUE INDEX [overtime_sessions_one_active_idx] ON dbo.[overtime_sessions] ([user_id]) WHERE ended_at IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'overtime_sessions_user_idx' AND object_id = OBJECT_ID(N'dbo.overtime_sessions'))
CREATE INDEX [overtime_sessions_user_idx] ON dbo.[overtime_sessions] ([user_id], [started_at] DESC);
GO
IF OBJECT_ID(N'dbo.public_holidays', N'U') IS NULL
CREATE TABLE dbo.[public_holidays] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [data] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT [ck_public_holidays_data_json] CHECK (ISJSON([data]) = 1),
  CONSTRAINT [pk_public_holidays] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.push_subscriptions', N'U') IS NULL
CREATE TABLE dbo.[push_subscriptions] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [user_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [endpoint] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [keys] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [created_at] BIGINT NOT NULL,
  CONSTRAINT [ck_push_subscriptions_keys_json] CHECK (ISJSON([keys]) = 1),
  CONSTRAINT [pk_push_subscriptions] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'push_subscriptions_endpoint_key' AND object_id = OBJECT_ID(N'dbo.push_subscriptions'))
CREATE UNIQUE INDEX [push_subscriptions_endpoint_key] ON dbo.[push_subscriptions] ([endpoint]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'push_subscriptions_user_idx' AND object_id = OBJECT_ID(N'dbo.push_subscriptions'))
CREATE INDEX [push_subscriptions_user_idx] ON dbo.[push_subscriptions] ([user_id]);
GO
IF OBJECT_ID(N'dbo.qa_accuracy_cases', N'U') IS NULL
CREATE TABLE dbo.[qa_accuracy_cases] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [qa_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [tl_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [evaluation_id] INT NULL,
  [title] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [description] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [severity] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL DEFAULT N'medium',
  [qa_share] FLOAT NULL DEFAULT 1.0,
  [status] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL DEFAULT N'open',
  [qa_comment] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [supervisor_note] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [created_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  [resolved_at] DATETIME2(6) NULL,
  CONSTRAINT [pk_qa_accuracy_cases] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_attendance_records_legacy', N'U') IS NULL
CREATE TABLE dbo.[qa_attendance_records_legacy] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [date] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [check_in_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  [check_out_at] DATETIME2(6) NULL,
  CONSTRAINT [pk_qa_attendance_records_legacy] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_audit_logs', N'U') IS NULL
CREATE TABLE dbo.[qa_audit_logs] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [user_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [action_type] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [section] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [details] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [ip_address] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [user_agent] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [status] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [created_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [pk_qa_audit_logs] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_coaching_requests', N'U') IS NULL
CREATE TABLE dbo.[qa_coaching_requests] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [evaluation_id] INT NOT NULL,
  [tl_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [agent_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [customer_phone] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [call_type] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [error_description] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [tl_comment] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [status] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL DEFAULT N'Pending Employee Approval',
  [created_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  [agent_approved_at] DATETIME2(6) NULL,
  [session_started_at] DATETIME2(6) NULL,
  [completed_at] DATETIME2(6) NULL,
  [cc_supervisor_note] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT [pk_qa_coaching_requests] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_coaching_sessions', N'U') IS NULL
CREATE TABLE dbo.[qa_coaching_sessions] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [agent_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [tl_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [weaknesses] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [notes] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [plan] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [status] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL DEFAULT N'open',
  [created_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [pk_qa_coaching_sessions] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_escalation_logs', N'U') IS NULL
CREATE TABLE dbo.[qa_escalation_logs] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [evaluation_id] INT NULL,
  [user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [role] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [action] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [comment] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [old_score] FLOAT NULL,
  [new_score] FLOAT NULL,
  [created_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  [cc_supervisor_note] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT [pk_qa_escalation_logs] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_evaluation_drafts', N'U') IS NULL
CREATE TABLE dbo.[qa_evaluation_drafts] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [owner_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [agent_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [brand] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [call_type] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [title] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [data] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [status] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL DEFAULT N'draft',
  [created_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  [completed_at] DATETIME2(6) NULL,
  CONSTRAINT [ck_qa_evaluation_drafts_data_json] CHECK (ISJSON([data]) = 1),
  CONSTRAINT [pk_qa_evaluation_drafts] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_evaluation_edits', N'U') IS NULL
CREATE TABLE dbo.[qa_evaluation_edits] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [evaluation_id] INT NOT NULL,
  [editor_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [editor_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [changes] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [created_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [ck_qa_evaluation_edits_changes_json] CHECK (ISJSON([changes]) = 1),
  CONSTRAINT [pk_qa_evaluation_edits] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_evaluations', N'U') IS NULL
CREATE TABLE dbo.[qa_evaluations] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [date] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [agent_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [qa_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [brand] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [call_type] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [final_score] FLOAT NULL,
  [status] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL DEFAULT N'Pending Review',
  [critical_failure] INT NULL DEFAULT 0,
  [data] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [is_wow] INT NULL DEFAULT 0,
  [agent_escalation_status] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [agent_escalation_reason] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [agent_escalation_response] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [agent_escalation_at] DATETIME2(6) NULL,
  [last_edited_at] DATETIME2(6) NULL,
  [last_edited_by] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [created_at] DATETIME2(6) NULL,
  [client_key] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT [ck_qa_evaluations_data_json] CHECK (ISJSON([data]) = 1),
  CONSTRAINT [pk_qa_evaluations] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'qa_evaluations_client_key_uq' AND object_id = OBJECT_ID(N'dbo.qa_evaluations'))
CREATE UNIQUE INDEX [qa_evaluations_client_key_uq] ON dbo.[qa_evaluations] ([client_key]) WHERE client_key IS NOT NULL;
GO
IF OBJECT_ID(N'dbo.qa_form_config', N'U') IS NULL
CREATE TABLE dbo.[qa_form_config] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [label] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [field_type] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [options] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [section] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [required] INT NULL DEFAULT 1,
  [call_type] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT [pk_qa_form_config] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_form_settings', N'U') IS NULL
CREATE TABLE dbo.[qa_form_settings] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [field_type] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [label_en] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [label_ar] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [value] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [is_active] INT NULL DEFAULT 1,
  [sort_order] INT NULL DEFAULT 0,
  [created_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [pk_qa_form_settings] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_former_staff', N'U') IS NULL
CREATE TABLE dbo.[qa_former_staff] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [qa_user_id] INT NOT NULL,
  [display_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [username] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [role] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [department] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [tl_user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [cc_supervisor_user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [allowed_departments] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [allowed_brands] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT [pk_qa_former_staff] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'qa_former_staff_qa_user_id_key' AND object_id = OBJECT_ID(N'dbo.qa_former_staff'))
CREATE UNIQUE INDEX [qa_former_staff_qa_user_id_key] ON dbo.[qa_former_staff] ([qa_user_id]);
GO
IF OBJECT_ID(N'dbo.qa_kpi_config', N'U') IS NULL
CREATE TABLE dbo.[qa_kpi_config] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [calls_target] INT NULL DEFAULT 910,
  [duration_hours_per_day] FLOAT NULL DEFAULT 8,
  [duration_days_per_month] INT NULL DEFAULT 26,
  [escalation_sla_hours] INT NULL DEFAULT 24,
  [weight_calls] FLOAT NULL DEFAULT 0.4,
  [weight_duration] FLOAT NULL DEFAULT 0.1,
  [weight_tasks] FLOAT NULL DEFAULT 0.2,
  [weight_accuracy] FLOAT NULL DEFAULT 0.3,
  [updated_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  [calls_per_attended_day] INT NULL DEFAULT 35,
  CONSTRAINT [pk_qa_kpi_config] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_kpi_day_overrides', N'U') IS NULL
CREATE TABLE dbo.[qa_kpi_day_overrides] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [qa_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [date] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [override_count] INT NOT NULL,
  [note] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [set_by_user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [set_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [pk_qa_kpi_day_overrides] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_notifications', N'U') IS NULL
CREATE TABLE dbo.[qa_notifications] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [title] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [message] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [evaluation_id] INT NULL,
  [is_read] INT NULL DEFAULT 0,
  [created_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [pk_qa_notifications] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_tl_kpi_config', N'U') IS NULL
CREATE TABLE dbo.[qa_tl_kpi_config] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [coaching_target] INT NULL DEFAULT 20,
  [escalation_sla_hours] INT NULL DEFAULT 24,
  [weight_coaching] FLOAT NULL DEFAULT 0.6,
  [weight_sla] FLOAT NULL DEFAULT 0.4,
  [updated_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [pk_qa_tl_kpi_config] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_user_leaves', N'U') IS NULL
CREATE TABLE dbo.[qa_user_leaves] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [leave_date] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [leave_type] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [note] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [approved_by] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [created_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [pk_qa_user_leaves] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_user_map', N'U') IS NULL
CREATE TABLE dbo.[qa_user_map] (
  [qa_user_id] INT NOT NULL,
  [user_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [match_kind] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [created_at] BIGINT NOT NULL,
  CONSTRAINT [pk_qa_user_map] PRIMARY KEY ([qa_user_id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'qa_user_map_user_idx' AND object_id = OBJECT_ID(N'dbo.qa_user_map'))
CREATE INDEX [qa_user_map_user_idx] ON dbo.[qa_user_map] ([user_id]);
GO
IF OBJECT_ID(N'dbo.qa_user_profile', N'U') IS NULL
CREATE TABLE dbo.[qa_user_profile] (
  [user_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [qa_role] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [qa_status] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [qa_department] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [tl_user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [cc_supervisor_user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [allowed_departments] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [allowed_brands] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT [pk_qa_user_profile] PRIMARY KEY ([user_id])
);
GO
IF OBJECT_ID(N'dbo.qa_user_sessions', N'U') IS NULL
CREATE TABLE dbo.[qa_user_sessions] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [login_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  [last_seen_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  [logout_at] DATETIME2(6) NULL,
  [duration_seconds] INT NULL DEFAULT 0,
  CONSTRAINT [pk_qa_user_sessions] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_xontel_agent_map', N'U') IS NULL
CREATE TABLE dbo.[qa_xontel_agent_map] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [user_id] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [xontel_agent_id] INT NULL,
  [xontel_agent_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [confirmed_by] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [updated_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [pk_qa_xontel_agent_map] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.qa_xontel_settings', N'U') IS NULL
CREATE TABLE dbo.[qa_xontel_settings] (
  [id] INT IDENTITY(1,1) NOT NULL,
  [setting_key] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [setting_value] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [updated_by] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [updated_at] DATETIME2(6) NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [pk_qa_xontel_settings] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.schedules', N'U') IS NULL
CREATE TABLE dbo.[schedules] (
  [user_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [date] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [data] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT [ck_schedules_data_json] CHECK (ISJSON([data]) = 1),
  CONSTRAINT [pk_schedules] PRIMARY KEY ([user_id], [date])
);
GO
IF OBJECT_ID(N'dbo.shift_templates', N'U') IS NULL
CREATE TABLE dbo.[shift_templates] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [data] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT [ck_shift_templates_data_json] CHECK (ISJSON([data]) = 1),
  CONSTRAINT [pk_shift_templates] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.sick_documents', N'U') IS NULL
CREATE TABLE dbo.[sick_documents] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [user_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [date] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [filename] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [mime] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [bytes] INT NOT NULL,
  [note] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [created_at] BIGINT NOT NULL,
  [data] VARBINARY(MAX) NOT NULL,
  CONSTRAINT [pk_sick_documents] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sick_documents_date_idx' AND object_id = OBJECT_ID(N'dbo.sick_documents'))
CREATE INDEX [sick_documents_date_idx] ON dbo.[sick_documents] ([date]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sick_documents_user_idx' AND object_id = OBJECT_ID(N'dbo.sick_documents'))
CREATE INDEX [sick_documents_user_idx] ON dbo.[sick_documents] ([user_id], [date]);
GO
IF OBJECT_ID(N'dbo.swap_requests', N'U') IS NULL
CREATE TABLE dbo.[swap_requests] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [data] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT [ck_swap_requests_data_json] CHECK (ISJSON([data]) = 1),
  CONSTRAINT [pk_swap_requests] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.sync_state', N'U') IS NULL
CREATE TABLE dbo.[sync_state] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [last_sync_at] BIGINT NULL,
  [last_punch_ts] BIGINT NULL,
  [detail] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT [ck_sync_state_detail_json] CHECK (ISJSON([detail]) = 1),
  CONSTRAINT [pk_sync_state] PRIMARY KEY ([id])
);
GO
IF OBJECT_ID(N'dbo.users', N'U') IS NULL
CREATE TABLE dbo.[users] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [data] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [username] AS (JSON_VALUE([data], '$.username') COLLATE Latin1_General_100_BIN2),
  CONSTRAINT [ck_users_data_json] CHECK (ISJSON([data]) = 1),
  CONSTRAINT [pk_users] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'users_username_idx' AND object_id = OBJECT_ID(N'dbo.users'))
CREATE UNIQUE INDEX [users_username_idx] ON dbo.[users] ([username]);
GO
IF OBJECT_ID(N'dbo.xontel_agent_map', N'U') IS NULL
CREATE TABLE dbo.[xontel_agent_map] (
  [user_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [xontel_agent_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [xontel_agent_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [confirmed_by] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [updated_at] BIGINT NOT NULL,
  CONSTRAINT [pk_xontel_agent_map] PRIMARY KEY ([user_id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'xontel_agent_map_agent_idx' AND object_id = OBJECT_ID(N'dbo.xontel_agent_map'))
CREATE UNIQUE INDEX [xontel_agent_map_agent_idx] ON dbo.[xontel_agent_map] ([xontel_agent_id]);
GO
IF OBJECT_ID(N'dbo.xontel_callbacks', N'U') IS NULL
CREATE TABLE dbo.[xontel_callbacks] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [call_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NULL,
  [xontel_agent_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [caller] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [outcome] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [at_ts] BIGINT NOT NULL,
  [raw] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [fetched_at] BIGINT NOT NULL,
  CONSTRAINT [ck_xontel_callbacks_raw_json] CHECK (ISJSON([raw]) = 1),
  CONSTRAINT [pk_xontel_callbacks] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'xontel_callbacks_at_idx' AND object_id = OBJECT_ID(N'dbo.xontel_callbacks'))
CREATE INDEX [xontel_callbacks_at_idx] ON dbo.[xontel_callbacks] ([at_ts]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'xontel_callbacks_call_idx' AND object_id = OBJECT_ID(N'dbo.xontel_callbacks'))
CREATE INDEX [xontel_callbacks_call_idx] ON dbo.[xontel_callbacks] ([call_id]);
GO
IF OBJECT_ID(N'dbo.xontel_calls', N'U') IS NULL
CREATE TABLE dbo.[xontel_calls] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [xontel_agent_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NULL,
  [agent_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [start_ts] BIGINT NOT NULL,
  [duration_sec] INT NOT NULL DEFAULT 0,
  [talk_sec] INT NOT NULL DEFAULT 0,
  [direction] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [status] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [caller_number] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [queue] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [recording_url] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [fetched_at] BIGINT NOT NULL,
  CONSTRAINT [pk_xontel_calls] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'xontel_calls_agent_idx' AND object_id = OBJECT_ID(N'dbo.xontel_calls'))
CREATE INDEX [xontel_calls_agent_idx] ON dbo.[xontel_calls] ([xontel_agent_id], [start_ts]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'xontel_calls_start_idx' AND object_id = OBJECT_ID(N'dbo.xontel_calls'))
CREATE INDEX [xontel_calls_start_idx] ON dbo.[xontel_calls] ([start_ts]);
GO
IF OBJECT_ID(N'dbo.xontel_missed_calls', N'U') IS NULL
CREATE TABLE dbo.[xontel_missed_calls] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [uniqueid] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [caller] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [queue] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [status] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [missed_ts] BIGINT NOT NULL,
  [assignee] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [assigned_ts] BIGINT NULL,
  [closed] BIT NOT NULL DEFAULT 0,
  [raw] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [fetched_at] BIGINT NOT NULL,
  CONSTRAINT [ck_xontel_missed_calls_raw_json] CHECK (ISJSON([raw]) = 1),
  CONSTRAINT [pk_xontel_missed_calls] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'xontel_missed_calls_ts_idx' AND object_id = OBJECT_ID(N'dbo.xontel_missed_calls'))
CREATE INDEX [xontel_missed_calls_ts_idx] ON dbo.[xontel_missed_calls] ([missed_ts]);
GO
IF OBJECT_ID(N'dbo.xontel_sessions', N'U') IS NULL
CREATE TABLE dbo.[xontel_sessions] (
  [id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [xontel_agent_id] NVARCHAR(450) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [xontel_agent_name] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [status] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [start_ts] BIGINT NOT NULL,
  [end_ts] BIGINT NULL,
  [duration_sec] INT NULL,
  [raw] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  [fetched_at] BIGINT NOT NULL,
  CONSTRAINT [ck_xontel_sessions_raw_json] CHECK (ISJSON([raw]) = 1),
  CONSTRAINT [pk_xontel_sessions] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'xontel_sessions_agent_idx' AND object_id = OBJECT_ID(N'dbo.xontel_sessions'))
CREATE INDEX [xontel_sessions_agent_idx] ON dbo.[xontel_sessions] ([xontel_agent_id], [start_ts]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'xontel_sessions_start_idx' AND object_id = OBJECT_ID(N'dbo.xontel_sessions'))
CREATE INDEX [xontel_sessions_start_idx] ON dbo.[xontel_sessions] ([start_ts]);
GO
-- fn_digits(x): x with everything but the digits 0-9 removed. The Quality module matches customer phone numbers by their last
-- eight digits (PostgreSQL: regexp_replace(x, '[^0-9]', '', 'g')); the app's SQL translator maps that call to this function.
CREATE OR ALTER FUNCTION dbo.[fn_digits](@s NVARCHAR(MAX)) RETURNS NVARCHAR(MAX) AS
BEGIN
  IF @s IS NULL RETURN NULL;
  DECLARE @i INT = PATINDEX('%[^0-9]%' COLLATE Latin1_General_100_BIN2, @s);
  WHILE @i > 0
  BEGIN
    SET @s = STUFF(@s, @i, 1, N'');
    SET @i = PATINDEX('%[^0-9]%' COLLATE Latin1_General_100_BIN2, @s);
  END
  RETURN @s;
END;
GO
-- Quality's view of its people: Swipr users that have a Quality profile, plus former staff (no Swipr account, kept for history).
CREATE OR ALTER VIEW dbo.[qa_users] AS
SELECT u.[id] AS [id],
       JSON_VALUE(u.[data], '$.name') AS [display_name],
       JSON_VALUE(u.[data], '$.username') AS [username],
       CAST(NULL AS NVARCHAR(MAX)) AS [password],
       p.[qa_role] AS [role],
       p.[qa_department] AS [department],
       p.[tl_user_id] AS [tl_id],
       p.[qa_status] AS [status],
       p.[allowed_departments] AS [allowed_departments],
       p.[allowed_brands] AS [allowed_brands],
       p.[cc_supervisor_user_id] AS [cc_supervisor_id]
FROM dbo.[users] u JOIN dbo.[qa_user_profile] p ON p.[user_id] = u.[id]
UNION ALL
SELECT f.[id], f.[display_name], f.[username], CAST(NULL AS NVARCHAR(MAX)), f.[role], f.[department], f.[tl_user_id], N'inactive',
       f.[allowed_departments], f.[allowed_brands], f.[cc_supervisor_user_id]
FROM dbo.[qa_former_staff] f;
GO
-- Quality attendance: Swipr's punch table is the record. Per person and Kuwait day: the first IN and the last OUT within 18h
-- (so night shifts count); days with no punches fall back to the legacy rows QA recorded itself.
CREATE OR ALTER VIEW dbo.[qa_attendance_records] AS
WITH p AS (
  SELECT a.[user_id], a.[kind], a.[ts],
         CONVERT(NVARCHAR(10), CAST(DATEADD(MILLISECOND, a.[ts] % 1000, DATEADD(SECOND, a.[ts] / 1000, CAST('1970-01-01' AS DATETIME2(3)))) AT TIME ZONE 'UTC' AT TIME ZONE 'Arab Standard Time' AS DATETIME2(3)), 23) COLLATE Latin1_General_100_BIN2 AS [day]
  FROM dbo.[attendance] a
  WHERE a.[user_id] IN (SELECT [user_id] FROM dbo.[qa_user_profile])
), d AS (
  SELECT [user_id], [day] AS [date], MIN(CASE WHEN [kind] = 'IN' THEN [ts] END) AS [first_in]
  FROM p GROUP BY [user_id], [day]
)
SELECT ABS(CHECKSUM(d.[user_id] + d.[date])) AS [id], d.[user_id], d.[date],
       CAST(DATEADD(MILLISECOND, d.[first_in] % 1000, DATEADD(SECOND, d.[first_in] / 1000, CAST('1970-01-01' AS DATETIME2(6)))) AT TIME ZONE 'UTC' AT TIME ZONE 'Arab Standard Time' AS DATETIME2(6)) AS [check_in_at],
       (SELECT CAST(DATEADD(MILLISECOND, MAX(o.[ts]) % 1000, DATEADD(SECOND, MAX(o.[ts]) / 1000, CAST('1970-01-01' AS DATETIME2(6)))) AT TIME ZONE 'UTC' AT TIME ZONE 'Arab Standard Time' AS DATETIME2(6))
          FROM dbo.[attendance] o
         WHERE o.[user_id] = d.[user_id] AND o.[kind] = 'OUT' AND o.[ts] > d.[first_in] AND o.[ts] < d.[first_in] + 18 * 3600 * 1000) AS [check_out_at]
FROM d WHERE d.[first_in] IS NOT NULL
UNION ALL
SELECT l.[id], l.[user_id], l.[date], l.[check_in_at], l.[check_out_at]
FROM dbo.[qa_attendance_records_legacy] l
WHERE NOT EXISTS (SELECT 1 FROM d WHERE d.[user_id] = l.[user_id] AND d.[date] = l.[date] AND d.[first_in] IS NOT NULL);
GO
