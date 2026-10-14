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
