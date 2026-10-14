# LOCAL TEST ONLY: (re)creates the swipr_sql database on the developer's own SQL Server (Windows authentication) and
# the app login used by the tests. Production is set up by the IT team from docs/DEPLOY-IT.md, not by this script.
#   powershell -File tools\local-sqlserver-setup.ps1 -Password '<choose one>' [-Recreate]
param([Parameter(Mandatory = $true)][string]$Password, [switch]$Recreate, [string]$DbName = 'swipr_sql', [string]$Login = 'swipr_sql_app')
$ErrorActionPreference = 'Stop'
$cn = New-Object System.Data.SqlClient.SqlConnection 'Server=localhost,1433;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=10'
$cn.Open()
function Run($sql) { $c = $cn.CreateCommand(); $c.CommandText = $sql; $c.CommandTimeout = 120; [void]$c.ExecuteNonQuery() }
if ($Recreate) {
  Run "IF DB_ID(N'$DbName') IS NOT NULL BEGIN ALTER DATABASE [$DbName] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$DbName]; END"
}
Run "IF DB_ID(N'$DbName') IS NULL CREATE DATABASE [$DbName]"
Run "IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$Login') CREATE LOGIN [$Login] WITH PASSWORD = N'$Password', CHECK_POLICY = OFF"
Run "ALTER LOGIN [$Login] WITH PASSWORD = N'$Password'"
Run "USE [$DbName]; IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$Login') CREATE USER [$Login] FOR LOGIN [$Login]; ALTER ROLE db_owner ADD MEMBER [$Login]"
$cn.Close()
"ready: database $DbName, login $Login"
