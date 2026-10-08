const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

/**
 * Las recetas viven en el bucket privado `animal_docs` con la misma ruta que
 * los documentos del animal: `<tenant>/<animal>/tratamiento/<uuid>.<pdf|png|jpg>`.
 */
export function esRutaDocumentoTratamiento(
  ruta: string,
  tenantId: string,
  animalId: string,
): boolean {
  const patron = new RegExp(`^${UUID}/${UUID}/tratamiento/${UUID}\\.(pdf|png|jpg)$`, 'i');
  return patron.test(ruta) && ruta.startsWith(`${tenantId}/${animalId}/`);
}

/**
 * Devuelve el motivo de rechazo o null. Una URL pública heredada solo se
 * acepta si es la misma que ya tenía el tratamiento que se corrige.
 */
export function validarDocumentoTratamiento(input: {
  documento: string | null;
  documentoPrevio: string | null;
  tenantId: string;
  animalId: string;
}): string | null {
  const { documento, documentoPrevio, tenantId, animalId } = input;
  if (!documento || documento === documentoPrevio) return null;
  if (esRutaDocumentoTratamiento(documento, tenantId, animalId)) return null;
  return 'El documento debe subirse al almacenamiento privado de la finca para este animal.';
}
