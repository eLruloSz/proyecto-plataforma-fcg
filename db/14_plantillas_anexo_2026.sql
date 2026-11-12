-- ============================================================================
-- Migración 14 — Plantillas de correo del proceso real (Anexo 2 "Comunicaciones 2026")
--
--  * plantillas_correo.etapa_orden: etapa del proceso a la que pertenece la
--    plantilla (1 = Invitación … 5 = Selección). Al avisar resultados desde una
--    etapa, el sistema sugiere primero la plantilla de esa etapa. NULL = sirve
--    para cualquier etapa (las plantillas genéricas anteriores).
--  * Carga los textos que la fundación usó en 2026, adaptados con variables
--    ({{nombre}}, {{liceo}}, {{anio}}, {{firma}}, {{lista_estudiantes}},
--    {{estudiantes}}). Las fechas quedan como [fecha] para completarlas antes
--    de enviar. El nombre termina en (contrapartes), (directivos) o
--    (postulantes): al usarla, el correo parte dirigido a ese grupo.
--  * Cambio respecto de 2026: los contactos de los invitados ya no se piden a
--    la contraparte en una tabla; la contraparte reenvía a los invitados un
--    formulario (Microsoft Forms) donde dejan sus datos y si aceptan postular.
--  * Solo agrega las plantillas que no existan con el mismo nombre.
--
-- Base nueva: Docker la ejecuta sola después de 01 a 13.
-- Base existente:
--   docker exec -i becas-db psql -U becas -d becas < db/14_plantillas_anexo_2026.sql
-- ============================================================================

BEGIN;

ALTER TABLE plantillas_correo ADD COLUMN IF NOT EXISTS etapa_orden SMALLINT
  CHECK (etapa_orden IS NULL OR etapa_orden BETWEEN 1 AND 20);

INSERT INTO plantillas_correo (etapa_orden, nombre, proposito, asunto, cuerpo)
SELECT * FROM (VALUES

-- ---------------------------------------------------------------- Etapa 1
(1::smallint, 'Inicio del proceso y solicitud de nómina (contrapartes)', 'SOLICITUD_NOTAS',
 'Inicio proceso de postulación {{anio}} — Beca Carmen Goudie',
 E'Estimado/a {{nombre}}:\n\nEs un gusto saludarle nuevamente. Espero que esté teniendo un excelente inicio de año escolar {{anio}}.\n\nA través del presente, le informo que hoy estamos dando inicio formal al proceso de postulación {{anio}} a la Beca Carmen Goudie.\n\nAl igual que el año pasado, le solicitamos por favor nos pueda enviar una nómina de todos sus estudiantes de tercero medio, indicando el promedio final de cada estudiante tanto en primero medio como en segundo medio. Adjunto un formato en Excel para que lo utilicen como referencia.\n\nLa fecha límite propuesta para el envío de esta nómina es el día [fecha].\n\nA partir de esta nómina coordinaremos con ustedes una instancia durante [periodo] para entregar las invitaciones a las/os estudiantes que cumplan con el requisito de excelencia académica.\n\nEn archivo adjunto le comparto una presentación de la beca, donde se indican los requisitos de postulación, los beneficios ofrecidos y las fechas importantes del proceso. Esta información es para conocimiento de los directivos, no para difusión (más adelante entregaremos información a los estudiantes).\n\nQuedo atento/a a cualquier duda o comentario.\n\nMuchas gracias de antemano por su colaboración.\n\nSaludos cordiales,\n{{firma}}'),

(1::smallint, 'Invitados y formulario de contacto (contrapartes)', 'INVITACION_ESTUDIANTES',
 'Beca Carmen Goudie {{anio}} — Estudiantes de {{liceo}} invitados a postular',
 E'Estimado/a {{nombre}}:\n\nEs un gusto saludarle nuevamente.\n\nA través del presente, le comunico que los siguientes estudiantes de {{liceo}}, en virtud de ocupar las primeras posiciones de notas en el ranking de su generación, han sido seleccionados como invitados a postular a la Beca Carmen Goudie {{anio}}:\n\n{{lista_estudiantes}}\n\nEn primer lugar, quisiéramos consultarle si tiene alguna observación o comentario sobre este listado.\n\nEn segundo lugar, le pedimos por favor reenviar a estos estudiantes el siguiente formulario, donde cada uno debe indicar si desea participar del proceso y dejar su correo electrónico y teléfono:\n\n[enlace al formulario]\n\nLa reunión de presentación de la beca se realizará en una instancia online fuera del horario de clases, abierta también a las apoderadas/os. Le informaremos oportunamente la fecha, en caso de que usted u otro representante de su establecimiento quisiera participar.\n\nLe agradezco por su colaboración. Quedo atento/a a sus consultas y comentarios.\n\nSaludos cordiales,\n{{firma}}'),

(1::smallint, 'Etapa 1: elige la fecha del encuentro online (postulantes)', 'AVISO_RESULTADO',
 'Beca Carmen Goudie {{anio}} — Encuentro online de presentación',
 E'Hola {{nombre}}:\n\nAgradecemos tu interés en participar del proceso de postulación a la Beca Carmen Goudie {{anio}}.\n\nEl próximo paso consiste en que participes de un Encuentro Online donde explicaremos más detalles sobre la beca y sobre el proceso de postulación.\n\nTendremos 3 opciones de fechas, de las cuales debes escoger y participar en solo una. Por favor, escoge la fecha en que participarás en el siguiente enlace:\n\n[enlace al formulario de fechas]\n\nTe pedimos que estés atenta/o a tu correo, pues ese será el canal oficial de comunicación durante el proceso.\n\n¡Te esperamos!\n\n{{firma}}'),

-- ---------------------------------------------------------------- Etapa 2
(2::smallint, 'Presentación realizada y fechas importantes (contrapartes)', 'OTRO',
 'Beca Carmen Goudie {{anio}} — Presentación a estudiantes y fechas importantes',
 E'Estimado/a {{nombre}}:\n\nJunto con saludarle, adjunto la presentación realizada a los estudiantes, en la cual se presentaron los beneficios estatales para la educación superior, las características generales de la Beca Carmen Goudie y los pasos del proceso de postulación.\n\nEl día [fecha] enviaremos a cada estudiante vía correo electrónico el enlace del formulario de postulación. La fecha límite para completarlo y enviarlo es el día [fecha].\n\nCualquier duda o comentario, por favor no dude en contactarnos.\n\nSaludos cordiales,\n{{firma}}'),

(2::smallint, 'Instrucciones de postulación (postulantes)', 'AVISO_RESULTADO',
 'Instrucciones de postulación — Beca Carmen Goudie {{anio}}',
 E'Hola {{nombre}}:\n\nEs un gusto saludarte nuevamente. Este correo contiene las instrucciones para el proceso de postulación a la Beca Carmen Goudie {{anio}}.\n\nTienes plazo hasta el día [fecha] para enviar tu postulación completa. Cuentas con tiempo suficiente para realizarla con atención y calma.\n\nInstrucciones de postulación:\n\n1. Lee el formulario adjunto: descarga y lee atentamente junto a tu apoderada/o el documento "Formulario Postulación Beca Carmen Goudie {{anio}}". Luego reúne toda la información que allí se solicita, lo cual te puede tomar algunos días.\n\n2. Completa y envía el formulario en línea: cuando tengas toda la información, responde el formulario en este enlace:\n[enlace al formulario de postulación]\n\n3. Envía tu cartola del Registro Social de Hogares: después de completar el formulario, responde a este mismo correo indicando tu nombre completo y adjuntando tu Cartola del Registro Social de Hogares.\n\n4. Fin de la postulación: si completaste el formulario y enviaste el correo con tu cartola, ¡tu postulación está lista! Solo tienes que esperar.\n\n5. Resultado: el día [fecha] te enviaremos un correo con los resultados de la primera etapa de selección.\n\n¡Esperamos tu participación!\n\nSaludos,\n{{firma}}'),

-- ---------------------------------------------------------------- Etapa 3
(3::smallint, 'Resultado Preselección N°1 (contrapartes)', 'INFORME_LICEO',
 'Beca Carmen Goudie {{anio}} — Resultados de la primera preselección en {{liceo}}',
 E'Estimado/a {{nombre}}:\n\nEs un gusto saludarle nuevamente.\n\nLe comunico que hemos finalizado la etapa de revisión de antecedentes de los postulantes del proceso de selección {{anio}}. Los criterios utilizados para esta primera preselección fueron:\n\n- Académica (35%): posición en el ranking de su generación.\n- Socioeconómica (40%): ingreso per cápita familiar (30%), nivel educativo de los padres (5%) y vulnerabilidad adicional del hogar (5%).\n- Compromiso y participación (25%): participación en actividades extraacadémicas, considerando frecuencia, permanencia, liderazgo y compromiso comunitario.\n\nLa situación de los postulantes de su establecimiento es la siguiente:\n\n{{estudiantes}}\n\nPor favor indíqueme si tiene alguna observación con respecto a este resultado. Si no la hubiera, enviaremos el resultado individual a cada estudiante por correo electrónico.\n\nLa próxima etapa consiste en una entrevista personal a los estudiantes preseleccionados, a realizarse en su establecimiento.\n\nQuedo atento/a a sus comentarios, agradeciendo de antemano su colaboración.\n\nSaludos cordiales,\n{{firma}}'),

(3::smallint, 'Preselección N°1: avanza a entrevista (postulantes)', 'AVISO_RESULTADO',
 'Beca Carmen Goudie {{anio}} — ¡Fuiste preseleccionada/o!',
 E'Hola {{nombre}}:\n\nJunto con saludarte, te informamos que fuiste preseleccionada/o para pasar a la siguiente etapa del proceso de selección {{anio}}.\n\nLa próxima etapa consiste en una entrevista personal. Durante la próxima semana nos comunicaremos con tu establecimiento para coordinar un horario para realizarla.\n\nAhora solo tienes que esperar a que te contactemos a través de tu establecimiento.\n\n¡Nos vemos próximamente!\n\nSaludos,\n{{firma}}'),

(3::smallint, 'Preselección N°1: no avanza (postulantes)', 'AVISO_RESULTADO',
 'Resultado de tu postulación — Beca Carmen Goudie {{anio}}',
 E'Hola {{nombre}}:\n\nJunto con saludarte, te informamos que no fuiste preseleccionada/o para continuar en el proceso de selección {{anio}}.\n\nNuestra fórmula de preselección considera la posición en el ranking de notas, la situación socioeconómica familiar y la participación. Tras la ponderación de estos criterios, estudiantes de otros establecimientos obtuvieron una prioridad mayor.\n\nValoramos tu esfuerzo y compromiso, y te animamos a que mantengas tu excelente rendimiento académico y tu motivación para ingresar a los estudios superiores, aprovechando los distintos apoyos que ofrece el Estado.\n\nAgradecemos nuevamente tu postulación y te deseamos mucho éxito en tus próximos desafíos.\n\nAfectuosamente,\n{{firma}}'),

-- ---------------------------------------------------------------- Etapa 4
(4::smallint, 'Resultado Preselección N°2 y entrevista final (contrapartes)', 'INFORME_LICEO',
 'Beca Carmen Goudie {{anio}} — Resultados de la segunda etapa en {{liceo}}',
 E'Estimado/a {{nombre}}:\n\nEspero se encuentre muy bien. Le escribo para informarle los resultados de la segunda etapa del proceso de selección {{anio}}:\n\n{{estudiantes}}\n\nEn breve informaremos estos resultados a los estudiantes por correo electrónico.\n\nLa última instancia del proceso consiste en una entrevista telemática a cada estudiante, de aproximadamente 40 minutos, moderada por dos directores de nuestra Fundación.\n\nQuisiera consultarle si sería posible realizar estas entrevistas el día [fecha] en el siguiente horario:\n\n[hora]: [estudiante]\n\nPara ello requerimos de su colaboración con un espacio adecuado y un computador con internet, cámara y acceso a la videollamada.\n\nQuedo atento/a a sus comentarios, agradeciendo nuevamente todas sus gestiones.\n\nSaludos cordiales,\n{{firma}}'),

(4::smallint, 'Preselección N°2: avanza a la etapa final (postulantes)', 'AVISO_RESULTADO',
 'Beca Carmen Goudie {{anio}} — Avanzas a la etapa final',
 E'Hola {{nombre}}:\n\nJunto con saludarte, te informamos que fuiste seleccionada/o para avanzar a la etapa final del proceso de selección {{anio}}.\n\nLa etapa final consiste en una entrevista online de 30 minutos con dos directores de la Fundación Carmen Goudie. Es una instancia muy similar a la entrevista que tuviste presencialmente en la etapa anterior, por lo que no requieres preparación previa.\n\nLa coordinación de esta entrevista la realizaremos directamente con tu establecimiento, así que solo tienes que esperar a que te contacten.\n\nCualquier duda que tengas, estamos a tu disposición.\n\nRecibe un saludo afectuoso,\n{{firma}}'),

(4::smallint, 'Preselección N°2: no avanza (postulantes)', 'AVISO_RESULTADO',
 'Resultado de tu postulación — Beca Carmen Goudie {{anio}}',
 E'Hola {{nombre}}:\n\nA través del presente correo te informamos que no fuiste seleccionada/o para pasar a la siguiente etapa del proceso de selección {{anio}}.\n\nReconocemos tus logros académicos y tus capacidades personales, y confiamos en que conseguirás ingresar a los estudios superiores aprovechando los beneficios que ofrecen el Estado y las universidades.\n\nSi durante este año o el próximo necesitas orientación sobre carreras, universidades o beneficios estudiantiles, te invitamos a contactarnos. Con gusto te ayudaremos a resolver tus dudas.\n\nTe agradecemos por haber participado de nuestro proceso de postulación.\n\nRecibe un saludo afectuoso,\n{{firma}}'),

-- ---------------------------------------------------------------- Etapa 5
(5::smallint, 'Coordinación entrevista virtual (contrapartes)', 'OTRO',
 'Beca Carmen Goudie {{anio}} — Entrevista final en {{liceo}}',
 E'Estimado/a {{nombre}}:\n\nMuchas gracias por su respuesta.\n\nLe escribo para proponerle realizar la entrevista de [estudiante] el día [fecha] a las [hora].\n\nA continuación, le envío el enlace de la entrevista:\n\n[estudiante] — [fecha] · [hora]\nEnlace de la videollamada: [enlace]\n\nCualquier comentario o duda, estoy a su disposición.\n\nSaludos y gracias nuevamente,\n{{firma}}'),

(5::smallint, 'Fecha de resultados finales (directivos)', 'OTRO',
 'Beca Carmen Goudie {{anio}} — Fecha de resultados finales',
 E'Estimado/a {{nombre}}:\n\nEs un gusto saludarle. Le escribo para agradecerle por la coordinación y la facilitación ofrecida para la realización de las entrevistas online.\n\nComplementariamente, le cuento que el día [fecha] entregaremos por esta vía el resultado final del proceso de selección {{anio}}.\n\nLe agradecemos todo el apoyo ofrecido durante este proceso.\n\nSaludos cordiales,\n{{firma}}'),

(5::smallint, 'Fecha de resultados finales (postulantes)', 'OTRO',
 'Beca Carmen Goudie {{anio}} — Fecha de resultados finales',
 E'Hola {{nombre}}:\n\nJunto con saludarte afectuosamente, te escribimos para informarte que los resultados del proceso de selección serán entregados el día [fecha].\n\nEstamos atentos para responder cualquier duda que tengas.\n\n¡Saludos!\n{{firma}}'),

(5::smallint, 'Resultado final del proceso (contrapartes)', 'INFORME_LICEO',
 'Beca Carmen Goudie {{anio}} — Resultado final del proceso en {{liceo}}',
 E'Estimado/a {{nombre}}:\n\nJunto con saludarle cordialmente, le informamos el resultado final del proceso de selección {{anio}} para los estudiantes de {{liceo}}:\n\n{{estudiantes}}\n\nDurante la tarde enviaremos un correo a cada estudiante informándole este resultado.\n\nLa definición de los estudiantes ganadores por parte del comité evaluador de la Fundación fue un proceso muy difícil, considerando que quienes llegaron a la instancia final son estudiantes muy destacadas/os. Para quienes no resultaron seleccionados, cuenten con nosotros para cualquier orientación sobre carreras, universidades y otros beneficios estudiantiles.\n\nEstamos muy agradecidos por su colaboración durante todo este proceso, y esperamos contar con nuevos postulantes de su establecimiento el próximo año.\n\nSaludos cordiales,\n{{firma}}'),

(5::smallint, 'Resultado final: becario/a (postulantes)', 'AVISO_RESULTADO',
 '¡Ganaste la Beca Carmen Goudie {{anio}}!',
 E'Hola {{nombre}}:\n\nJunto con saludar y esperando que te encuentres muy bien, queremos informarte que fuiste ganador/a de la Beca Carmen Goudie {{anio}}.\n\nEl proceso de decisión fue muy difícil, ya que recibimos un gran número de excelentes postulaciones. En este contexto, el jurado te eligió como becario/a de la Generación {{anio}}, un logro del que puedes sentirte muy orgullosa/o.\n\nEstamos muy felices de poder acompañarte en este largo camino de formación profesional, y con muchas ganas de conocerte más, que nos conozcas como equipo y que compartas con otras generaciones de becarios/as.\n\nPronto nos pondremos en contacto contigo vía WhatsApp para coordinar los próximos pasos.\n\nRecibe un afectuoso saludo,\n{{firma}}'),

(5::smallint, 'Resultado final: no seleccionado/a (postulantes)', 'AVISO_RESULTADO',
 'Resultado final — Beca Carmen Goudie {{anio}}',
 E'Hola {{nombre}}:\n\nJunto con saludarte cordialmente, te informamos que no fuiste seleccionada/o para la obtención de la Beca Carmen Goudie {{anio}}.\n\nEl proceso de decisión fue muy difícil, pues había muy buenas/os candidatas/os en la etapa final. En este contexto, el jurado priorizó a otros estudiantes.\n\nQueremos expresarte que reconocemos y valoramos tus logros académicos y tus habilidades personales. Confiamos en que la gratuidad y otros apoyos disponibles te permitirán seguir adelante con tus planes de estudios superiores.\n\nCuenta con nosotros este año o el próximo para cualquier orientación que necesites sobre carreras, universidades o beneficios estudiantiles. Cualquier comentario o duda, escríbenos por aquí.\n\nTe mandamos un afectuoso saludo,\n{{firma}}'),

(5::smallint, 'Invitación ceremonia de bienvenida (contrapartes)', 'AGRADECIMIENTO',
 'Invitación — Ceremonia de Bienvenida Becarios {{anio}}',
 E'Estimado/a {{nombre}}:\n\nJunto con saludarle cordialmente, tenemos el agrado de invitarle a nuestra Ceremonia de Bienvenida de Becarios {{anio}}, instancia en la que celebraremos el ingreso de los nuevos estudiantes a nuestro programa de becas.\n\nPara nuestra Fundación sería un honor contar con su presencia, como colaborador/a a lo largo de todo el proceso de selección, en este encuentro donde reconoceremos el compromiso de estudiantes, familias y comunidades educativas.\n\nLa ceremonia se realizará el día [fecha] a las [hora] en [lugar].\n\nAdjuntamos la invitación con los detalles de la actividad. Agradeceremos confirmar su asistencia respondiendo a este correo hasta el día [fecha].\n\nEsperando contar con su presencia, le saluda cordialmente,\n{{firma}}')

) AS v(etapa_orden, nombre, proposito, asunto, cuerpo)
WHERE NOT EXISTS (SELECT 1 FROM plantillas_correo p WHERE p.nombre = v.nombre);

COMMIT;
