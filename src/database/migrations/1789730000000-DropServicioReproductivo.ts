import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Elimina `servicio_reproductivo`, tabla del módulo reproductivo duplicado
 * que ya se retiró del código (src/servicios/). Reintroducía los bugs B1/B2/B4
 * que MOD-03-Reproductivo.md corrige (evento_servicio + evento_diagnostico +
 * estado siempre derivado, ver Patron-Evento-Estado-Alerta.md).
 *
 * Verificado antes de aplicar: sin ninguna FK entrante desde otra tabla, y las
 * 3 filas existentes eran datos de prueba manual de un solo animal (una con
 * tipo_servicio='Transferencia de Embriones', valor que el flujo real rechaza).
 */
export class DropServicioReproductivo1789730000000
  implements MigrationInterface
{
  name = 'DropServicioReproductivo1789730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.servicio_reproductivo;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No reversible con datos: la tabla pertenecía a un módulo ya retirado del
    // código (src/servicios/), sin consumidores. No se reconstruye vacía porque
    // nada en el sistema actual la usa — el flujo real vive en
    // evento_servicio/evento_diagnostico (src/reproductivo/).
  }
}
