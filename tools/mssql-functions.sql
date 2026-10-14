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
