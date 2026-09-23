-- ═══════════════════════════════════════════════════════════════════════════
--  04 · DOCUMENTOS PARA EL REGISTRO AUTONÓMICO (módulo 5)
--
--  El Registro de certificados de eficiencia energética del Principado de
--  Asturias (trámite RECE0016T01) pide el certificado firmado en PDF, el XML
--  del programa, el justificante de la tasa (modelo 046) y, si el técnico no
--  está inscrito en el registro de técnicos, una declaración responsable.
--  Aquí solo se añaden esos tipos de documento. La app NO presenta nada: el
--  paquete lo sube el técnico a mano en la sede electrónica.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.adjuntos drop constraint adjuntos_tipo_check;
alter table public.adjuntos add constraint adjuntos_tipo_check check (tipo in (
  'fichero_calculo', 'certificado_pdf', 'certificado_xml', 'certificado_firmado',
  'informe_conformidad', 'justificante_tasa', 'declaracion_responsable', 'foto', 'otro'
));
