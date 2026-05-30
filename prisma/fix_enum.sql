-- Renomeia apenas se os valores antigos ainda existirem
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'UserType' AND e.enumlabel = 'ADMIN_1'
  ) THEN
    ALTER TYPE "UserType" RENAME VALUE 'USER'     TO 'LOJA';
    ALTER TYPE "UserType" RENAME VALUE 'REGIONAL' TO 'GERENTE';
    ALTER TYPE "UserType" RENAME VALUE 'ADMIN_3'  TO 'DIRECAO';
    ALTER TYPE "UserType" RENAME VALUE 'ADMIN_2'  TO 'ADMINISTRATIVO';
    ALTER TYPE "UserType" RENAME VALUE 'ADMIN_1'  TO 'TI';
    RAISE NOTICE 'Enum renomeado com sucesso';
  ELSE
    RAISE NOTICE 'Enum ja esta atualizado, nada foi feito';
  END IF;
END;
$$;
