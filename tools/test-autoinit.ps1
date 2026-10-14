# LOCAL TEST: a login that may create databases (dbcreator) but has no other rights, used to prove AUTO_INIT_DB creates the database + schema.
$cn = New-Object System.Data.SqlClient.SqlConnection 'Server=localhost,1433;Integrated Security=True;TrustServerCertificate=True'
$cn.Open()
function Run($s) { $c = $cn.CreateCommand(); $c.CommandText = $s; [void]$c.ExecuteNonQuery() }
Run "IF DB_ID(N'swipr_sql_autoinit') IS NOT NULL BEGIN ALTER DATABASE swipr_sql_autoinit SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE swipr_sql_autoinit; END"
Run "IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'swipr_autoinit_login') CREATE LOGIN swipr_autoinit_login WITH PASSWORD = N'Aut0Init-Test-Pw-9', CHECK_POLICY = OFF"
Run "ALTER SERVER ROLE dbcreator ADD MEMBER swipr_autoinit_login"
$cn.Close()
"ready"
