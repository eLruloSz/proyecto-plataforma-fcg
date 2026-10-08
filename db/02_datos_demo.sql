-- ============================================================================
-- DATOS DE PRUEBA — solo para desarrollo
-- Usuarios: coordinacion@fcg.cl / Demo1234!   y   direccion@fcg.cl / Demo1234!
-- Los nombres de liceos son los reales (información pública); los contactos
-- son inventados para no cargar datos personales en un entorno de prueba.
-- ============================================================================

INSERT INTO usuarios (email, password_hash, nombre_completo, firma) VALUES
  ('coordinacion@fcg.cl', '$2a$10$wvGsZNdVlFOX5OxYPh3DRet6Ojuu.Sv9Irn83Ur2MAneU/dyO2mre',
   'Coordinación de Selección', E'Coordinación de Selección\nFundación Carmen Goudie'),
  ('direccion@fcg.cl', '$2a$10$wvGsZNdVlFOX5OxYPh3DRet6Ojuu.Sv9Irn83Ur2MAneU/dyO2mre',
   'Dirección', E'Dirección\nFundación Carmen Goudie');

INSERT INTO procesos (id, nombre, anio, estado, sufijo_id) VALUES
  ('c0000000-0000-0000-0000-000000002026', 'Beca Carmen Goudie 2026', 2026, 'ACTIVO', 'a');

INSERT INTO etapas (proceso_id, orden, nombre, descripcion, estado) VALUES
  ('c0000000-0000-0000-0000-000000002026', 1, 'Invitación a establecimientos', 'Presentación a liceos, solicitud de nóminas y definición de invitados', 'ACTIVA'),
  ('c0000000-0000-0000-0000-000000002026', 2, 'Presentación de la beca', 'Encuentro online con los invitados (3 fechas)', 'PENDIENTE'),
  ('c0000000-0000-0000-0000-000000002026', 3, 'Preselección N°1', 'Cuestionario, documentos y ranking: 60 a entrevista', 'PENDIENTE'),
  ('c0000000-0000-0000-0000-000000002026', 4, 'Preselección N°2', 'Entrevistas presenciales: 20 finalistas', 'PENDIENTE'),
  ('c0000000-0000-0000-0000-000000002026', 5, 'Selección de becarios', 'Entrevistas con comité y decisión final', 'PENDIENTE');

INSERT INTO liceos (codigo, nombre, comuna) VALUES
  ('01', 'Colegio Parroquial de Andacollo', 'Andacollo'),
  ('02', 'Liceo Pedro Regalado Videla', 'Andacollo'),
  ('03', 'Colegio de Artes Claudio Arrau', 'Coquimbo'),
  ('04', 'Colegio Pablo Neruda', 'Coquimbo'),
  ('05', 'Instituto de Ad. y Com. Estado de Israel IAC', 'Coquimbo'),
  ('06', 'INSUCO', 'Coquimbo'),
  ('07', 'Liceo Carmen Rodríguez - Tongoy', 'Coquimbo'),
  ('08', 'Liceo de Cs y Hum. S.J. M. E. de Balaguer', 'Coquimbo'),
  ('09', 'Liceo Diego Portales', 'Coquimbo'),
  ('10', 'Liceo Fernando Binvignat', 'Coquimbo'),
  ('11', 'Liceo Industrial José Tomás de Urmeneta', 'Coquimbo'),
  ('12', 'Colegio Pedro Pablo Muñoz', 'La Higuera'),
  ('13', 'Colegio Gabriel González Videla', 'La Serena'),
  ('14', 'Colegio José Manuel Balmaceda', 'La Serena'),
  ('15', 'Colegio José Miguel Carrera', 'La Serena'),
  ('16', 'Colegio Nuestra Señora de Andacollo', 'La Serena'),
  ('17', 'Colegio Pedro Aguirre Cerda', 'La Serena'),
  ('18', 'Colegio San Francisco Coll', 'La Serena'),
  ('19', 'Liceo Gabriela Mistral', 'La Serena'),
  ('20', 'Liceo Gregorio Cordovez', 'La Serena'),
  ('21', 'Liceo Ignacio Carrera Pinto', 'La Serena'),
  ('22', 'Liceo Industrial Salesianos San Ramón', 'La Serena'),
  ('23', 'Liceo Jorge Alessandri Rodríguez', 'La Serena'),
  ('24', 'Liceo Técnico Marta Brunet', 'La Serena'),
  ('25', 'Liceo TP Educador J.B. de La Salle', 'La Serena'),
  ('26', 'Liceo Mistraliano', 'Paihuano'),
  ('27', 'Liceo Carlos Roberto Mondaca', 'Vicuña'),
  ('28', 'Colegio Edmundo Vidal Cárdenas', 'Vicuña');

-- Directores y contrapartes inventados. Dos liceos quedan sin email de
-- contraparte a propósito, para ver la advertencia antes de enviar.
INSERT INTO contactos_liceo (liceo_id, tipo, nombre, cargo, email)
SELECT id, 'DIRECTOR', 'Director/a Liceo ' || codigo, 'Director/a', 'direccion' || codigo || '@liceos-demo.cl'
FROM liceos;

INSERT INTO contactos_liceo (liceo_id, tipo, nombre, cargo, email)
SELECT id, 'CONTRAPARTE', 'Contraparte Liceo ' || codigo,
       (ARRAY['Orientadora','Jefa UTP','Asistente Social','Orientador','Trabajadora Social'])[1 + (codigo::int % 5)],
       CASE WHEN codigo IN ('03', '21') THEN NULL ELSE 'contraparte' || codigo || '@liceos-demo.cl' END
FROM liceos;

INSERT INTO participaciones_liceo (proceso_id, liceo_id)
SELECT 'c0000000-0000-0000-0000-000000002026', id FROM liceos;

INSERT INTO eventos (proceso_id, tipo, fecha, enlace) VALUES
  ('c0000000-0000-0000-0000-000000002026', 'ENCUENTRO_ONLINE', '2026-06-16 18:00-04', 'https://teams.microsoft.com/'),
  ('c0000000-0000-0000-0000-000000002026', 'ENCUENTRO_ONLINE', '2026-06-17 18:30-04', 'https://teams.microsoft.com/'),
  ('c0000000-0000-0000-0000-000000002026', 'ENCUENTRO_ONLINE', '2026-06-18 18:30-04', 'https://teams.microsoft.com/');

INSERT INTO plantillas_correo (nombre, proposito, asunto, cuerpo) VALUES
  ('Presentación de la beca a liceos', 'PRESENTACION',
   'Beca Carmen Goudie {{anio}} — Invitación a participar',
   E'Estimado/a {{nombre}}:\n\nJunto con saludar, le escribimos desde la Fundación Carmen Goudie para presentarle el proceso de selección de la Beca Carmen Goudie {{anio}}, dirigido a estudiantes de 3° medio de {{liceo}}.\n\nLe agradeceríamos confirmar si su establecimiento desea participar en el proceso.\n\nSaludos cordiales,\n{{firma}}'),
  ('Solicitud de nómina de notas', 'SOLICITUD_NOTAS',
   'Beca Carmen Goudie {{anio}} — Solicitud de nómina de 3° medio',
   E'Estimado/a {{nombre}}:\n\nAgradecemos la participación de {{liceo}} en el proceso. Le solicitamos completar la planilla adjunta con la totalidad de los estudiantes de 3° medio y sus promedios finales de 1° y 2° medio (una hoja por curso).\n\nSaludos cordiales,\n{{firma}}'),
  ('Aprobación de invitados y datos de contacto', 'SOLICITUD_CONTACTOS',
   'Beca Carmen Goudie {{anio}} — Estudiantes invitados de {{liceo}}',
   E'Estimado/a {{nombre}}:\n\nLe compartimos el listado de estudiantes de {{liceo}} que serán invitados a postular. Le solicitamos validar el listado y enviarnos el correo electrónico y teléfono de cada estudiante.\n\nSaludos cordiales,\n{{firma}}'),
  ('Invitación a postular (estudiantes)', 'INVITACION_ESTUDIANTES',
   '¡Estás invitado/a a postular a la Beca Carmen Goudie {{anio}}!',
   E'Hola {{nombre}}:\n\nPor tus resultados en {{liceo}} has sido invitado/a a postular a la Beca Carmen Goudie {{anio}}. Por favor confirma tu interés y tus datos de contacto.\n\nSaludos,\n{{firma}}'),
  ('Agradecimiento a liceos', 'AGRADECIMIENTO',
   'Beca Carmen Goudie {{anio}} — Agradecimiento',
   E'Estimado/a {{nombre}}:\n\nAgradecemos la colaboración de {{liceo}} en el proceso de selección {{anio}}.\n\nSaludos cordiales,\n{{firma}}');
