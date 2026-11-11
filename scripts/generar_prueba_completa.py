#!/usr/bin/env python3
"""
Genera un set de prueba COMPLETO del proceso (etapas 1 a 5) con datos
inventados, para recorrer la plataforma de punta a punta:

    1_nominas/nomina_liceo_XX.xlsx         nóminas de notas (27 liceos; el 12 no participa)
    2_Forms_confirmacion_interes_2026.xlsx respuestas del formulario 1 (Microsoft Forms)
    3_Ranking_Preseleccion_N1_2026.xlsx    ranking que calcula la fundación (sin "Finalistas")
    GUIA_prueba_completa.xlsx              paso a paso y quién avanza / no avanza en cada etapa

Los Id. del ranking y de la guía son los que entrega el sistema SOLO SI se
invita liceo por liceo en orden de código (01, 02, 03… sin el 12), cada uno
de una vez con "mejores del liceo" y el N indicado en la guía (hoja Liceos).

Uso (desde la raíz del repo):
    python3 scripts/generar_prueba_completa.py db/nominas-demo/nomina_liceo_02.xlsx db/prueba-completa

La plantilla puede ser cualquier nómina generada con la plantilla real
"Formato envío notas Liceos" (se borran sus alumnos y se reutiliza el formato).
"""
import random
import sys
import unicodedata
from copy import copy
from datetime import date, datetime, timedelta
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

SEMILLA = 2026
ANIO = 2026
SUFIJO = 'a'
NO_PARTICIPA = '12'
CUPO_ETAPA3 = 60   # Preselección N°1 → entrevista
CUPO_ETAPA4 = 20   # Preselección N°2 → comité
CUPO_ETAPA5 = 10   # becarios

# (código, nombre, comuna, tipo) — mismos liceos que db/02_datos_demo.sql
LICEOS = [
    ('01', 'Colegio Parroquial de Andacollo', 'Andacollo', 'CH'),
    ('02', 'Liceo Pedro Regalado Videla', 'Andacollo', 'POLI'),
    ('03', 'Colegio de Artes Claudio Arrau', 'Coquimbo', 'CH'),
    ('04', 'Colegio Pablo Neruda', 'Coquimbo', 'CH'),
    ('05', 'Instituto de Ad. y Com. Estado de Israel IAC', 'Coquimbo', 'TP_COM'),
    ('06', 'INSUCO', 'Coquimbo', 'TP_COM'),
    ('07', 'Liceo Carmen Rodríguez - Tongoy', 'Coquimbo', 'POLI'),
    ('08', 'Liceo de Cs y Hum. S.J. M. E. de Balaguer', 'Coquimbo', 'CH'),
    ('09', 'Liceo Diego Portales', 'Coquimbo', 'CH'),
    ('10', 'Liceo Fernando Binvignat', 'Coquimbo', 'CH'),
    ('11', 'Liceo Industrial José Tomás de Urmeneta', 'Coquimbo', 'TP_IND'),
    ('12', 'Colegio Pedro Pablo Muñoz', 'La Higuera', 'CH'),
    ('13', 'Colegio Gabriel González Videla', 'La Serena', 'CH'),
    ('14', 'Colegio José Manuel Balmaceda', 'La Serena', 'CH'),
    ('15', 'Colegio José Miguel Carrera', 'La Serena', 'CH'),
    ('16', 'Colegio Nuestra Señora de Andacollo', 'La Serena', 'CH'),
    ('17', 'Colegio Pedro Aguirre Cerda', 'La Serena', 'CH'),
    ('18', 'Colegio San Francisco Coll', 'La Serena', 'CH'),
    ('19', 'Liceo Gabriela Mistral', 'La Serena', 'CH'),
    ('20', 'Liceo Gregorio Cordovez', 'La Serena', 'CH'),
    ('21', 'Liceo Ignacio Carrera Pinto', 'La Serena', 'CH'),
    ('22', 'Liceo Industrial Salesianos San Ramón', 'La Serena', 'TP_IND'),
    ('23', 'Liceo Jorge Alessandri Rodríguez', 'La Serena', 'CH'),
    ('24', 'Liceo Técnico Marta Brunet', 'La Serena', 'TP_SERV'),
    ('25', 'Liceo TP Educador J.B. de La Salle', 'La Serena', 'TP_IND'),
    ('26', 'Liceo Mistraliano', 'Paihuano', 'POLI'),
    ('27', 'Liceo Carlos Roberto Mondaca', 'Vicuña', 'POLI'),
    ('28', 'Colegio Edmundo Vidal Cárdenas', 'Vicuña', 'CH'),
]
CARGOS = ['Orientadora', 'Jefa UTP', 'Asistente Social', 'Orientador', 'Trabajadora Social']  # como en 02_datos_demo.sql
ESPECIALIDADES = {
    'TP_COM': ['Contabilidad', 'Administración', 'Programación', 'Administración (Logística)'],
    'TP_IND': ['Electricidad', 'Mecánica Industrial', 'Electrónica', 'Construcciones Metálicas'],
    'TP_SERV': ['Gastronomía', 'Atención de Párvulos', 'Servicios de Turismo', 'Administración'],
    'POLI': ['Científico Humanista', 'Científico Humanista', 'Electricidad', 'Atención de Enfermería'],
}

NOMBRES_F = ['Sofía', 'Martina', 'Florencia', 'Isidora', 'Agustina', 'Josefa', 'Emilia', 'Catalina', 'Antonia',
             'Valentina', 'Fernanda', 'Javiera', 'Camila', 'Constanza', 'Francisca', 'Trinidad', 'Maite', 'Amanda',
             'Renata', 'Ignacia', 'Victoria', 'Daniela', 'Paula', 'Belén', 'Monserrat', 'Rocío', 'Anaís', 'Scarlett',
             'Millaray', 'Ayelén', 'Dominga', 'Colomba', 'Gabriela', 'Valeria', 'Carolina', 'Alejandra', 'Macarena',
             'Pía', 'Rayén', 'Krishna']
NOMBRES_M = ['Mateo', 'Benjamín', 'Vicente', 'Tomás', 'Agustín', 'Joaquín', 'Maximiliano', 'Lucas', 'Matías',
             'Cristóbal', 'Diego', 'Martín', 'Gaspar', 'Bastián', 'Felipe', 'Ignacio', 'Nicolás', 'Sebastián',
             'Alonso', 'Facundo', 'Renato', 'Simón', 'Emilio', 'Julián', 'Bruno', 'Gabriel', 'Andrés', 'Francisco',
             'Alexis', 'Kevin', 'Brandon', 'Byron', 'Ángel', 'Esteban', 'Lautaro', 'Damián', 'Jorge', 'Pablo',
             'Rodrigo', 'Fabián']
APELLIDOS = ['González', 'Muñoz', 'Rojas', 'Díaz', 'Pérez', 'Soto', 'Contreras', 'Silva', 'Martínez', 'Sepúlveda',
             'Morales', 'Rodríguez', 'López', 'Fuentes', 'Hernández', 'Torres', 'Araya', 'Flores', 'Espinoza',
             'Valenzuela', 'Castillo', 'Tapia', 'Reyes', 'Gutiérrez', 'Castro', 'Pizarro', 'Álvarez', 'Vásquez',
             'Sánchez', 'Fernández', 'Ramírez', 'Carrasco', 'Gómez', 'Cortés', 'Herrera', 'Núñez', 'Jara', 'Vergara',
             'Rivera', 'Figueroa', 'Riquelme', 'García', 'Miranda', 'Bravo', 'Vera', 'Molina', 'Vega', 'Campos',
             'Sandoval', 'Orellana', 'Cárdenas', 'Olivares', 'Alarcón', 'Gallardo', 'Ortiz', 'Garrido', 'Salazar',
             'Guzmán', 'Henríquez', 'Saavedra', 'Navarro', 'Aguilera', 'Parra', 'Romero', 'Aravena', 'Vargas',
             'Vidal', 'Zamora', 'Ahumada', 'Cerda', 'Cisternas', 'Godoy', 'Pastén', 'Alfaro', 'Barraza', 'Rivas',
             'Varas', 'Ossandón', 'Galleguillos', 'Codoceo', 'Aguirre', 'Callejas']
APODOS = {'Constanza': 'Coni', 'Francisca': 'Fran', 'Maximiliano': 'Maxi', 'Sebastián': 'Seba', 'Ignacia': 'Nacha'}

CARRERAS = ['Ingeniería Civil Industrial', 'Enfermería', 'Pedagogía en Matemática', 'Medicina', 'Ingeniería en Computación',
            'Kinesiología', 'Derecho', 'Arquitectura', 'Psicología', 'Ingeniería en Minas', 'Obstetricia', 'Geología',
            'Trabajo Social', 'Ingeniería Civil Eléctrica', 'Nutrición', 'Pedagogía en Educación Básica', 'Odontología',
            'Ingeniería en Construcción', 'Tecnología Médica', 'Contador Auditor']
ACTIVIDADES = ['el centro de alumnos', 'un voluntariado de la parroquia', 'el club deportivo de su barrio',
               'la brigada escolar', 'la banda del liceo', 'el taller de robótica', 'la selección de básquetbol del liceo',
               'una olimpiada de matemática', 'el grupo scout de su sector', 'un preuniversitario social']
CONTEXTOS = ['Vive con su madre y dos hermanos menores, a quienes cuida en las tardes.',
             'El hogar está a cargo de sus abuelos.', 'El padre trabaja por turnos en la minería; la madre es dueña de casa.',
             'Los fines de semana trabaja en la feria con su familia.', 'Sería la primera persona de su familia en la universidad.',
             'Viaja más de una hora diaria al liceo.', 'Hogar monoparental; la madre trabaja como temporera.',
             'Comparte pieza con dos hermanos; estudia en la biblioteca del liceo.']


# ----------------------------------------------------------------------------
# Utilidades (las de nombre/liceo replican la lógica del backend para saber de
# antemano qué va a pasar al importar las respuestas del formulario)
# ----------------------------------------------------------------------------

def normalizar(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c)).replace('º', '°').lower()
    return ' '.join(s.split())


def sin_tildes(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if not unicodedata.combining(c))


def palabras_nombre(s):
    import re
    if not s:
        return []
    t = normalizar(re.sub(r'\(.*?\)', ' ', s))
    t = re.sub(r'[^a-z\s]', ' ', t)
    return [w for w in t.split() if len(w) > 1 and w not in ('de', 'del', 'la', 'las', 'los', 'y')]


def misma_palabra(a, b):
    if a == b:
        return True
    if min(len(a), len(b)) < 5 or abs(len(a) - len(b)) > 1:
        return False
    i = j = difs = 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1; j += 1; continue
        difs += 1
        if difs > 1:
            return False
        if len(a) > len(b): i += 1
        elif len(b) > len(a): j += 1
        else: i += 1; j += 1
    return difs + (len(a) - i) + (len(b) - j) <= 1


def puntaje_nombre(resp, inv):
    esta = lambda w: any(misma_palabra(r, w) for r in resp)
    apP, apM, nom = palabras_nombre(inv['apP']), palabras_nombre(inv['apM']), palabras_nombre(inv['nombres'])
    if not apP or not all(esta(w) for w in apP):
        return 0
    n = sum(1 for w in nom if esta(w))
    if not n:
        return 0
    p = 3 + n
    if apM and all(esta(w) for w in apM):
        p += 2
    return p


def reconocer_liceo(texto, liceos):
    import re
    if not texto:
        return None
    m = re.match(r'^0*(\d{1,3})\b', texto.strip())
    if m:
        for l in liceos:
            if int(l[0]) == int(m.group(1)):
                return l
    ignorar = {'liceo', 'colegio', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'escuela', 'instituto', 'bicentenario', 'excelencia'}
    pal = lambda s: [w for w in re.split(r'[^a-z0-9]+', normalizar(s)) if len(w) > 2 and w not in ignorar]
    buscadas = pal(texto)
    if not buscadas:
        return None
    pts = sorted(((sum(1 for w in buscadas if w in set(pal(l[1]))), l) for l in liceos), key=lambda x: -x[0])
    pts = [x for x in pts if x[0] > 0]
    if not pts or (len(pts) > 1 and pts[1][0] == pts[0][0]):
        return None
    return pts[0][1]


def dv_rut(cuerpo):
    s, m = 0, 2
    for d in reversed(str(cuerpo)):
        s += int(d) * m
        m = 2 if m == 7 else m + 1
    r = 11 - s % 11
    return '0' if r == 11 else 'K' if r == 10 else str(r)


def fmt_rut(cuerpo, estilo=0):
    dv = dv_rut(cuerpo)
    c = f'{cuerpo:,}'.replace(',', '.')
    return [f'{c}-{dv}', f'{cuerpo}-{dv}', f'{cuerpo}{dv}'][estilo]


def clp(n):
    return '$' + f'{int(n):,}'.replace(',', '.')


def nombre_completo(a):
    return f"{a['nombres']} {a['apP']} {a['apM']}"


# ----------------------------------------------------------------------------
# Generación
# ----------------------------------------------------------------------------

class Generador:
    def __init__(self):
        self.rnd = random.Random(SEMILLA)
        self.usados = set()
        self.ruts = set()

    def nombre(self):
        r = self.rnd
        while True:
            pool = NOMBRES_F if r.random() < 0.55 else NOMBRES_M
            n1 = r.choice(pool)
            nombres = n1 if r.random() < 0.15 else f'{n1} {r.choice([x for x in pool if x != n1])}'
            apP, apM = r.choice(APELLIDOS), r.choice(APELLIDOS)
            k = normalizar(f'{nombres} {apP} {apM}')
            if k not in self.usados:
                self.usados.add(k)
                return nombres, apP, apM

    def rut(self):
        while True:
            c = self.rnd.randint(22_100_000, 23_400_000)
            if c not in self.ruts:
                self.ruts.add(c)
                return c

    # --- Nóminas ------------------------------------------------------------
    def nominas(self):
        r = self.rnd
        estilos = [lambda l: f'3° año {l}', lambda l: f'3°{l}', lambda l: f'3° {l}', lambda l: f'3° Medio {l}']
        self.liceos = []
        for cod, nombre, comuna, tipo in LICEOS:
            if cod == NO_PARTICIPA:
                self.liceos.append(dict(cod=cod, nombre=nombre, comuna=comuna, participa=False))
                continue
            ncur = r.choice([1, 2, 2, 3]) if tipo == 'CH' else r.choice([3, 4])
            estilo = r.choice(estilos)
            cursos = []
            for i in range(ncur):
                letra = 'ABCD'[i]
                esp = 'Científico Humanista' if tipo == 'CH' else ESPECIALIDADES[tipo][i]
                alumnos = []
                for k in range(r.randint(24, 38)):
                    nombres, apP, apM = self.nombre()
                    base = r.gauss(5.6, 0.48)
                    n1 = round(min(7.0, max(4.0, base + r.gauss(0, 0.18))), 1)
                    n2 = round(min(7.0, max(4.0, base + r.gauss(0, 0.18))), 1)
                    alumnos.append(dict(nombres=nombres, apP=apP, apM=apM, n1=n1, n2=n2, curso=f'3°{letra}',
                                        cursoOriginal=estilo(letra), especialidad=esp, liceo=cod, nLista=k + 1))
                cursos.append(dict(letra=letra, original=estilo(letra), especialidad=esp, alumnos=alumnos))
            todos = [a for c in cursos for a in c['alumnos']]
            n_inv = min(8, max(4, 3 + ncur + r.choice([0, 0, 1])))
            self.liceos.append(dict(cod=cod, nombre=nombre, comuna=comuna, participa=True, tipo=tipo,
                                    cursos=cursos, alumnos=todos, n_inv=n_inv,
                                    cargo=CARGOS[(1 + int(cod) % 5) - 1]))

        # Caso ambiguo a propósito: dos "Camila … Rojas" entre los mejores del liceo 20
        l20 = next(l for l in self.liceos if l['cod'] == '20')
        a, b = sorted(l20['alumnos'], key=lambda x: -(x['n1'] + x['n2']))[1:3]
        a.update(nombres='Camila Antonia', apP='Rojas', apM='Araya', n1=6.8, n2=6.9)
        b.update(nombres='Camila Fernanda', apP='Rojas', apM='Tapia', n1=6.7, n2=6.8)

        for l in self.liceos:
            if l['participa']:
                self._sin_empates_arriba(l)
                self._posiciones(l)

    def _prom(self, a):
        return round((a['n1'] + a['n2']) / 2, 3)

    def _sin_empates_arriba(self, l):
        """Los N+1 mejores del liceo con promedios distintos: la sugerencia trae exactamente N."""
        k = l['n_inv'] + 1
        for _ in range(500):
            orden = sorted(l['alumnos'], key=lambda a: -self._prom(a))
            empate = next((orden[i] for i in range(1, k) if self._prom(orden[i]) == self._prom(orden[i - 1])), None)
            if not empate:
                return
            if empate['n2'] > 4.0:
                empate['n2'] = round(empate['n2'] - 0.1, 1)
            else:
                empate['n1'] = round(empate['n1'] - 0.1, 1)
        raise RuntimeError('no se pudieron deshacer los empates')

    def _posiciones(self, l):
        for a in l['alumnos']:
            a['prom'] = self._prom(a)
        for c in l['cursos']:
            orden = sorted(c['alumnos'], key=lambda a: -a['prom'])
            for i, a in enumerate(orden):
                a['posCurso'] = orden[i - 1]['posCurso'] if i and orden[i - 1]['prom'] == a['prom'] else i + 1
        orden = sorted(l['alumnos'], key=lambda a: -a['prom'])
        for i, a in enumerate(orden):
            a['posLiceo'] = orden[i - 1]['posLiceo'] if i and orden[i - 1]['prom'] == a['prom'] else i + 1

    # --- Invitados (Id igual al que asigna el sistema) ----------------------
    def invitados(self):
        r = self.rnd
        correlativo = 0
        self.inv = []
        for l in self.liceos:
            if not l['participa']:
                continue
            elegidos = sorted(l['alumnos'], key=lambda a: -a['prom'])[:l['n_inv']]
            # mismo orden que InvitadosService.invitar: curso, posición en el curso, apellido paterno
            for a in sorted(elegidos, key=lambda a: (a['curso'], a['posCurso'], a['apP'])):
                correlativo += 1
                a['id'] = f"{l['cod']}.{correlativo:03d}{SUFIJO}"
                a['liceoNombre'] = l['nombre']
                a['rutN'] = self.rut()
                a['rut'] = fmt_rut(a['rutN'])
                usuario = sin_tildes(f"{a['nombres'].split()[0]}.{a['apP']}").lower().replace(' ', '')
                dom = r.choices(['gmail.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'yahoo.com'], [62, 20, 10, 5, 3])[0]
                a['email'] = f"{usuario}{r.randint(1, 99) if r.random() < 0.6 else ''}@{dom}"
                a['telefono'] = f"+569{r.randint(10_000_000, 99_999_999)}"
                self.inv.append(a)
        self.por_id = {a['id']: a for a in self.inv}

    # --- Etapa 1: formulario de confirmación (Microsoft Forms) --------------
    def formulario(self):
        r = self.rnd
        inv = self.inv
        camA = next(a for a in inv if a['nombres'] == 'Camila Antonia' and a['apP'] == 'Rojas')
        camB = next(a for a in inv if a['nombres'] == 'Camila Fernanda' and a['apP'] == 'Rojas')
        libres = [a for a in inv if a not in (camA, camB)]
        r.shuffle(libres)
        no_responde, dice_no, tal_vez = libres[:8], libres[8:14], libres[14]
        si = [a for a in inv if a not in no_responde and a not in dice_no and a is not tal_vez]
        for a in no_responde: a['etapa1'] = ('No responde', 'NO AVANZA', 'No respondió el formulario ni a la contraparte.')
        for a in dice_no: a['etapa1'] = ('No', 'NO AVANZA', 'Respondió que no acepta postular.')
        tal_vez['etapa1'] = ('Tal vez', 'AVANZA', 'Respondió "Tal vez"; la fundación la/lo llamó y confirmó: marcar "Aceptó postular = Sí" a mano.')
        for a in si: a['etapa1'] = ('Sí', 'AVANZA', '')

        # Casos especiales entre los que dicen que sí
        cand = [a for a in si if a not in (camA, camB)]
        r.shuffle(cand)
        casos = {}
        orden_casos = ['gmial', 'hotmial', 'email_malo', 'tel_malo', 'rut_malo', 'typo_apellido', 'apodo',
                       'duplicado', 'liceo_raro', 'solo_un_nombre_1', 'solo_un_nombre_2', 'mayusculas', 'sin_tildes']
        for caso in orden_casos:
            for a in cand:
                if a.get('caso'):
                    continue
                if caso == 'typo_apellido' and len(sin_tildes(a['apP'])) < 7:
                    continue
                if caso == 'apodo' and a['nombres'].split()[0] not in APODOS:
                    continue
                a['caso'] = caso
                casos[caso] = a
                break
        if 'apodo' not in casos:
            orden_casos.remove('apodo')

        filas = []
        participantes = [l for l in self.liceos if l['participa']]
        lic_tuplas = [(l['cod'], l['nombre']) for l in participantes]

        def texto_liceo(a):
            l = next(x for x in participantes if x['cod'] == a['liceo'])
            opciones = [l['nombre'], sin_tildes(l['nombre']), l['nombre'].replace('Liceo ', '').replace('Colegio ', ''),
                        l['nombre'].upper()]
            for t in r.sample(opciones, len(opciones)):
                rec = reconocer_liceo(t, lic_tuplas)
                if rec and rec[0] == a['liceo']:
                    return t
            return l['nombre']

        def respuesta(a, acepta, **cambios):
            nombres, apP, apM = a['nombres'], a['apP'], a['apM']
            est = r.random()
            tel_local = a['telefono'][3:]
            tel = r.choice([a['telefono'], tel_local, f'+56 9 {tel_local[1:5]} {tel_local[5:]}', f'9 {tel_local[1:5]} {tel_local[5:]}'])
            fila = dict(nombres=nombres, apP=apP, apM=apM, rut=fmt_rut(a['rutN'], r.randint(0, 2)),
                        liceo=texto_liceo(a), curso=a['cursoOriginal'], email=a['email'], tel=tel, acepta=acepta,
                        motivo=None, inv=a)
            if est < 0.2:
                fila['email'] = fila['email'].capitalize()
            fila.update(cambios)
            return fila

        textos_si = ['Sí', 'Sí', 'Sí', 'Sí, acepto postular', 'Si']
        textos_no = ['No', 'No, gracias', 'No acepto']
        for a in si:
            if a is camA or a is camB:
                continue
            f = respuesta(a, r.choice(textos_si))
            c = a.get('caso')
            if c == 'gmial': f['email'] = a['email'].split('@')[0] + '@gmial.com'
            if c == 'hotmial': f['email'] = a['email'].split('@')[0] + '@hotmial.com'
            if c == 'email_malo': f['email'] = a['email'].split('@')[0] + '@gmail'
            if c == 'tel_malo': f['tel'] = '3214'
            if c == 'rut_malo':
                malo = str((int(dv_rut(a['rutN'])) + 1) % 10) if dv_rut(a['rutN']).isdigit() else '1'
                f['rut'] = f"{a['rutN']}-{malo}"
            if c == 'typo_apellido':
                p = a['apP']; f['apP'] = p[:-2] + p[-1]
            if c == 'apodo':
                n1 = a['nombres'].split()[0]; f['nombres'] = f"{a['nombres']} ({APODOS[n1]})"
            if c == 'liceo_raro': f['liceo'] = 'Liceo de mi comuna'
            if c in ('solo_un_nombre_1', 'solo_un_nombre_2'): f['nombres'] = a['nombres'].split()[0]; f['apM'] = ''
            if c == 'mayusculas':
                f.update(nombres=a['nombres'].upper(), apP=a['apP'].upper(), apM=a['apM'].upper())
            if c == 'sin_tildes':
                f.update(nombres=sin_tildes(a['nombres']).lower(), apP=sin_tildes(a['apP']).lower(), apM=sin_tildes(a['apM']).lower())
            if c == 'duplicado':
                primera = dict(f, tel=f'+569{r.randint(10_000_000, 99_999_999)}', descartada=True)
                filas.append(primera)
            filas.append(f)
        # Camila Antonia escribe solo "Camila Rojas" → ambiguo dentro del liceo 20
        fa = respuesta(camA, 'Sí'); fa.update(nombres='Camila', apM=''); camA['caso'] = 'ambiguo'
        filas.append(fa)
        filas.append(respuesta(camB, 'Sí'))
        for a in dice_no:
            filas.append(respuesta(a, r.choice(textos_no)))
        filas.append(respuesta(tal_vez, 'Tal vez, tengo dudas'))
        tal_vez['caso'] = 'tal_vez'

        # Una compañera NO invitada que recibió el enlace
        l = next(x for x in participantes if x['cod'] == '09')
        intrusa = next(x for x in sorted(l['alumnos'], key=lambda a: -a['prom'])[l['n_inv'] + 3:]
                       if all(puntaje_nombre(palabras_nombre(nombre_completo(x)), i) == 0 for i in self.inv))
        filas.append(dict(nombres=intrusa['nombres'], apP=intrusa['apP'], apM=intrusa['apM'], rut=fmt_rut(self.rut()),
                          liceo=l['nombre'], curso=intrusa['cursoOriginal'],
                          email=sin_tildes(intrusa['apP']).lower() + '.' + str(r.randint(10, 99)) + '@gmail.com',
                          tel=f'9{r.randint(10_000_000, 99_999_999)}', acepta='Sí', inv=None, motivo='no_invitada'))
        self.intrusa = intrusa

        r.shuffle(filas)
        # el duplicado: la primera respuesta debe quedar ANTES que la segunda
        dup = [i for i, f in enumerate(filas) if f['inv'] is not None and f['inv'].get('caso') == 'duplicado']
        a, b = dup
        if filas[b].get('descartada'):
            filas[a], filas[b] = filas[b], filas[a]
        inicio = datetime(ANIO, 4, 6, 9, 0)
        for i, f in enumerate(filas):
            f['inicio'] = inicio + timedelta(minutes=int(i * (11 * 24 * 60) / len(filas)) + r.randint(0, 40))
            f['fin'] = f['inicio'] + timedelta(minutes=r.randint(2, 9), seconds=r.randint(0, 59))
        self.filas_forms = filas

        # Resultado esperado al importar (replica la lógica del backend)
        for idx, f in enumerate(filas, start=2):
            f['filaExcel'] = idx
            pal = palabras_nombre(' '.join(x for x in (f['nombres'], f['apP'], f['apM']) if x))
            lic = reconocer_liceo(f['liceo'], lic_tuplas)
            def buscar(lista):
                pts = [(puntaje_nombre(pal, i), i) for i in lista]
                pts = [x for x in pts if x[0] > 0]
                mx = max([p for p, _ in pts], default=0)
                return [i for p, i in pts if p == mx]
            c = buscar([i for i in self.inv if lic and i['liceo'] == lic[0]]) if lic else []
            if not c:
                c = buscar(self.inv)
            f['calce'] = 'CALZA' if len(c) == 1 else 'AMBIGUO' if c else 'SIN_CALCE'
            f['calzaCon'] = c[0]['id'] if len(c) == 1 else ', '.join(i['id'] for i in c)

    # --- Etapa 2: encuentro online -----------------------------------------
    def encuentro(self):
        r = self.rnd
        self.fechas_encuentro = [datetime(ANIO, 4, 21, 18, 30), datetime(ANIO, 4, 23, 18, 30), datetime(ANIO, 4, 28, 18, 30)]
        e2 = [a for a in self.inv if a['etapa1'][1] == 'AVANZA']
        for a in e2:
            a['encuentro'] = r.choice(self.fechas_encuentro)
        ausentes = r.sample(e2, 8)
        for a in e2:
            a['asistio'] = a not in ausentes
            a['etapa2'] = ('AVANZA', '') if a['asistio'] else ('NO AVANZA', 'No asistió y no justificó.')
        ausentes[0]['etapa2'] = ('AVANZA', 'No asistió, pero justificó (estaba en un campeonato) y vio la grabación: marcar "avanza" a mano.')

    # --- Etapa 3: documentos, ficha RSH y ranking ---------------------------
    def preseleccion(self):
        r = self.rnd
        e3 = [a for a in self.inv if a.get('etapa2', ('',))[0] == 'AVANZA']
        r.shuffle(e3)
        desisten = e3[:6]
        motivos = ['Avisó por correo que desiste (trabajará el próximo año).', 'No envió el formulario de postulación.',
                   'No envió el formulario de postulación.', 'Avisó a la contraparte que se cambia de ciudad.',
                   'No envió el formulario ni documentos pese a 2 recordatorios.', 'No envió el formulario de postulación.']
        for a, m in zip(desisten, motivos):
            a['etapa3'] = ('NO AVANZA', m)
            a['req'] = dict(form=False, rsh=False, notas=False, ingresos=False)
        enRanking = e3[6:]
        pendientesRSH = enRanking[:4]
        sinNotas = enRanking[4:7]
        sinDeclaracion = enRanking[7:10]
        for a in enRanking:
            a['req'] = dict(form=True, rsh=a not in pendientesRSH, notas=a not in sinNotas, ingresos=a not in sinDeclaracion)
            if a in pendientesRSH:
                a['tramo'] = None
            else:
                a['tramo'] = r.choices([40, 50, 60, 70, 80], [78, 12, 5, 3, 2])[0]
            personas = r.choices([2, 3, 4, 5, 6, 7], [8, 22, 32, 22, 11, 5])[0]
            base = {None: (60_000, 230_000), 40: (45_000, 210_000), 50: (170_000, 300_000),
                    60: (280_000, 420_000), 70: (330_000, 480_000), 80: (400_000, 600_000)}[a['tramo']]
            ipc = r.randint(*base) // 500 * 500
            a['ipc'] = None if a in sinDeclaracion else ipc
            ingreso = ipc * personas
            piso = ingreso // 100_000 * 100_000
            menores = min(personas - 1, r.choices([0, 1, 2, 3], [20, 40, 30, 10])[0])
            a['ficha'] = dict(
                personas=personas, menores=menores,
                mayores60=r.choices([0, 1, 2], [75, 20, 5])[0],
                discapacidad=r.choices([0, 1], [90, 10])[0], dependencia=r.choices([0, 1], [95, 5])[0],
                invalidez=r.choices([0, 1], [96, 4])[0], nee=r.choices([0, 1], [88, 12])[0],
                ingresos=f'Entre {clp(piso)} y {clp(piso + 99_999)}' if a['tramo'] else '',
                personasForm=personas, actualizada=date(ANIO, 1, 1) + timedelta(days=r.randint(-330, 120)) if a['tramo'] else None,
                obs='')
            if a in pendientesRSH:
                a['ficha']['obs'] = 'Cartola RSH en trámite (pidió actualización en el municipio).'
        # Diferencias entre personas del formulario y del RSH (para probar la comparación)
        for a, d, obs in zip(r.sample([x for x in enRanking if x['tramo']], 5), [1, -1, 2, 1, -1],
                             ['RSH no actualizado, el padre cambió de trabajo y se fue a vivir con ellos un tío.',
                              'El hermano mayor se fue a estudiar a Santiago.',
                              'Llegaron a vivir los abuelos; RSH aún no lo refleja.',
                              'Nació una hermana en 2026.',
                              'La madre se separó; el padre ya no vive en el hogar.']):
            a['ficha']['personasForm'] = max(1, a['ficha']['personas'] + d)
            a['ficha']['obs'] = obs

        # Puntajes
        for a in enRanking:
            a['comp'] = r.choices([0, 7, 13, 19, 25], [5, 15, 30, 30, 20])[0]
            a['nivel'] = r.choices([0, 2.5, 5, 7.5, 10, 12.5, 15], [4, 8, 18, 25, 22, 15, 8])[0]
            a['vul'] = 1 if r.random() < 0.15 else 0
        for l in self.liceos:
            if not l['participa']:
                continue
            delLiceo = sorted([a for a in enRanking if a['liceo'] == l['cod']], key=lambda a: -a['prom'])
            for i, a in enumerate(delLiceo):
                a['rankNotas'] = i + 1
                a['acad'] = [35, 30, 25, 20, 15, 10][i] if i < 6 else 5

        def calcular(a):
            ipc = a['ipc']
            a['pIpc'] = 0 if ipc is None else int(round(max(0, min(30, 30 * (450_000 - ipc) / 350_000))))
            a['socio'] = round(a['pIpc'] + a['nivel'] + 5 * a['vul'], 1)
            a['total'] = round(a['acad'] + a['socio'] + a['comp'], 1)

        for _ in range(200):
            for a in enRanking:
                calcular(a)
            orden = sorted(enRanking, key=lambda a: -a['total'])
            # RSH sobre 50%: no deben quedar entre los que avanzan
            altos = [a for a in orden[:CUPO_ETAPA3] if a['tramo'] and a['tramo'] > 50]
            if altos:
                for a in altos:
                    a['comp'] = max(0, a['comp'] - 7); a['nivel'] = max(0, a['nivel'] - 2.5)
                continue
            if orden[CUPO_ETAPA3 - 1]['total'] == orden[CUPO_ETAPA3]['total']:
                x = orden[CUPO_ETAPA3]
                x['nivel'] = max(0, x['nivel'] - 2.5) if x['nivel'] else x['nivel']
                if not x['nivel']:
                    x['comp'] = max(0, x['comp'] - 6)
                continue
            break
        orden = sorted(enRanking, key=lambda a: -a['total'])
        for i, a in enumerate(orden):
            a['lugar'] = orden[i - 1]['lugar'] if i and orden[i - 1]['total'] == a['total'] else i + 1
            if a['lugar'] <= CUPO_ETAPA3:
                a['etapa3'] = ('AVANZA', f"Lugar {a['lugar']} del ranking (entre los {CUPO_ETAPA3} primeros).")
            else:
                motivo = f"Lugar {a['lugar']} del ranking."
                if a['tramo'] and a['tramo'] > 50:
                    motivo += f" RSH {a['tramo']}% (sobre el máximo)."
                a['etapa3'] = ('NO AVANZA', motivo)
        assert sum(1 for a in enRanking if a['lugar'] <= CUPO_ETAPA3) == CUPO_ETAPA3
        self.enRanking = enRanking
        # apodos en el Excel del ranking (como el archivo real)
        for a in r.sample(enRanking, 2):
            n1 = a['nombres'].split()[0]
            a['nombreRanking'] = f"{a['nombres']} ({APODOS.get(n1, n1[:3])})"

    # --- Etapa 4: entrevistas presenciales ----------------------------------
    def entrevistas(self):
        r = self.rnd
        e4 = sorted([a for a in self.enRanking if a['etapa3'][0] == 'AVANZA'], key=lambda a: a['lugar'])
        self.e4 = e4
        slots = []
        d = date(ANIO, 6, 1)
        while len(slots) < len(e4):
            if d.weekday() < 5:
                for h in (10, 11, 12):
                    slots.append(datetime(d.year, d.month, d.day, h))
            d += timedelta(days=1)
        r.shuffle(e4)
        for a, s in zip(e4, slots):
            a['ent4'] = dict(fecha=s, estado='REALIZADA')
        cancela, conflicto = e4[0], e4[1]
        cancela['ent4'].update(estado='CANCELADA', comentario='Avisó el día anterior que desiste del proceso (entró a trabajar).')
        conflicto['ent4']['reprogramada'] = conflicto['ent4']['fecha']
        conflicto['ent4'].update(fecha=datetime(ANIO, 6, 30, 10), estado='REALIZADA')
        for a in e4:
            if a is cancela:
                a['eval4'] = -1
                continue
            a['eval4'] = round(0.55 * a['total'] / 110 * 100 + 0.45 * r.uniform(40, 100), 2)
        orden = sorted([a for a in e4 if a is not cancela], key=lambda a: -a['eval4'])
        for i, a in enumerate(orden):
            fuerte = i < CUPO_ETAPA4
            carrera, act, ctx = r.choice(CARRERAS), r.choice(ACTIVIDADES), r.choice(CONTEXTOS)
            if fuerte:
                txt = r.choice([f'Tiene muy claro que quiere estudiar {carrera} y explica por qué. Participa en {act}. {ctx}',
                                f'Se expresa con claridad y seguridad. Quiere estudiar {carrera}. {ctx} Buena disposición al acompañamiento.',
                                f'Destaca su perseverancia. {ctx} Participa en {act}. Interés en {carrera}.'])
            else:
                txt = r.choice([f'Respuestas breves; le cuesta explicar sus metas. Menciona {carrera} sin mucha convicción.',
                                f'Aún no define qué estudiar (duda entre {carrera} y otra carrera). {ctx}',
                                f'Buena actitud, pero poco conocimiento de la beca y del compromiso que implica. Participa en {act}.'])
            if a is conflicto:
                txt = f"Reprogramada (tenía prueba el {a['ent4']['reprogramada']:%d/%m}). " + txt
            a['ent4']['comentario'] = txt
            a['etapa4'] = ('AVANZA' if fuerte else 'NO AVANZA', f'Evaluación de la entrevista: {i + 1}° de {len(orden)}.')
        cancela['etapa4'] = ('NO AVANZA', 'Canceló la entrevista: desiste.')

    # --- Etapa 5: comité y becarios -----------------------------------------
    def comite(self):
        r = self.rnd
        e5 = [a for a in self.e4 if a['etapa4'][0] == 'AVANZA']
        r.shuffle(e5)
        d, slots = date(ANIO, 7, 6), []
        while len(slots) < len(e5):
            if d.weekday() < 5:
                for h in (10, 11, 12):
                    slots.append(datetime(d.year, d.month, d.day, h))
            d += timedelta(days=1)
        for a, s in zip(e5, slots):
            a['ent5'] = dict(fecha=s, estado='REALIZADA')
            a['eval5'] = round(0.5 * a['eval4'] + 0.5 * r.uniform(50, 100), 2)
        orden = sorted(e5, key=lambda a: -a['eval5'])
        for i, a in enumerate(orden):
            becario = i < CUPO_ETAPA5
            a['ent5']['comentario'] = r.choice(
                ['El comité destaca su madurez y claridad vocacional.', 'Muy buena entrevista; el comité valora su compromiso con la comunidad.',
                 'El comité valora su esfuerzo académico en un contexto familiar exigente.']
                if becario else
                ['Buena candidatura, pero el comité prioriza otros perfiles este año.',
                 'El comité considera que aún no tiene claro su proyecto de estudios.',
                 'Queda en lista de espera según el comité.'])
            a['etapa5'] = ('BECARIO/A' if becario else 'NO SELECCIONADO/A', f'Lugar {i + 1} de {len(orden)} en la decisión del comité.')
        self.e5 = e5


# ----------------------------------------------------------------------------
# Escritura de archivos
# ----------------------------------------------------------------------------

AZUL = PatternFill('solid', fgColor='1F4E78')
VERDE = PatternFill('solid', fgColor='C6EFCE')
ROJO = PatternFill('solid', fgColor='FFC7CE')
AMARILLO = PatternFill('solid', fgColor='FFEB9C')
GRIS = PatternFill('solid', fgColor='EDEDED')


def hoja_tabla(wb, titulo, encabezados, filas, anchos=None, color_col=None):
    ws = wb.create_sheet(titulo)
    ws.append(encabezados)
    for c in ws[1]:
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = AZUL
        c.alignment = Alignment(wrap_text=True, vertical='center')
    for f in filas:
        ws.append(f)
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions
    for i, h in enumerate(encabezados, start=1):
        ancho = (anchos or {}).get(h) or min(45, max(10, len(str(h)) + 2,
                                                   *(len(str(f[i - 1])) + 1 for f in filas if f[i - 1] is not None)))
        ws.column_dimensions[get_column_letter(i)].width = ancho
    if color_col:
        col = encabezados.index(color_col) + 1
        for row in ws.iter_rows(min_row=2):
            v = str(row[col - 1].value or '')
            row[col - 1].fill = VERDE if v.startswith(('AVANZA', 'BECARIO')) else ROJO if v.startswith('NO') else GRIS
    return ws


def escribir_nominas(g, plantilla, carpeta):
    carpeta.mkdir(parents=True, exist_ok=True)
    for l in g.liceos:
        if not l['participa']:
            continue
        wb = openpyxl.load_workbook(plantilla)
        base = wb.worksheets[0]
        for ws in wb.worksheets[1:]:
            wb.remove(ws)
        hojas = [base] + [wb.copy_worksheet(base) for _ in l['cursos'][1:]]
        for ws, c in zip(hojas, l['cursos']):
            ws.title = f"Curso 3°{c['letra']}"
            for row in ws.iter_rows(min_row=9, min_col=2, max_col=6):
                for cell in row:
                    cell.value = None
            ws['C2'] = l['nombre']
            ws['C3'] = f"Contraparte Liceo {l['cod']}"
            ws['C4'] = l['cargo']
            ws['C6'] = c['original']
            ws['C7'] = c['especialidad']
            for k, a in enumerate(c['alumnos']):
                fila = 9 + k
                ws.cell(fila, 1, k + 1)
                ws.cell(fila, 2, a['apP']); ws.cell(fila, 3, a['apM']); ws.cell(fila, 4, a['nombres'])
                ws.cell(fila, 5, a['n1']); ws.cell(fila, 6, a['n2'])
        # Errores típicos (sin cambiar el valor) en dos liceos, lejos de los invitados
        if l['cod'] in ('09', '23'):
            ws = hojas[0]
            orden = sorted(l['cursos'][0]['alumnos'], key=lambda a: a['prom'])
            a1, a2 = orden[0], orden[1]
            r1 = 9 + l['cursos'][0]['alumnos'].index(a1)
            r2 = 9 + l['cursos'][0]['alumnos'].index(a2)
            ws.cell(r1, 5, f"{a1['n1']:.1f}".replace('.', ','))   # "5,1" como texto
            ws.cell(r2, 6, int(round(a2['n2'] * 10)))              # 51 sin coma
        wb.save(carpeta / f"nomina_liceo_{l['cod']}.xlsx")


def escribir_forms(g, ruta):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Sheet1'
    enc = ['Id', 'Hora de inicio', 'Hora de finalización', 'Correo electrónico', 'Nombre', 'Hora de la última modificación',
           'Nombres', 'Apellido paterno', 'Apellido materno', 'RUT (con guion)', '¿En qué liceo estudias?', 'Curso',
           'Correo electrónico personal', 'Teléfono celular (WhatsApp)', f'¿Aceptas postular a la Beca Carmen Goudie {ANIO}?']
    ws.append(enc)
    for i, f in enumerate(g.filas_forms, start=1):
        ws.append([i, f['inicio'], f['fin'], 'anonymous', None, None, f['nombres'], f['apP'], f['apM'] or None,
                   f['rut'], f['liceo'], f['curso'], f['email'], f['tel'], f['acepta']])
    for row in ws.iter_rows(min_row=2, min_col=2, max_col=3):
        for c in row:
            c.number_format = 'm/d/yy h:mm:ss'
    for c in ws[1]:
        c.font = Font(bold=True)
    for i in range(1, len(enc) + 1):
        ws.column_dimensions[get_column_letter(i)].width = 22
    ws.auto_filter.ref = ws.dimensions
    wb.save(ruta)


def escribir_ranking(g, ruta):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    filas_orden = sorted(g.enRanking, key=lambda a: (a['liceo'], a['id']))

    def hoja(nombre, f_socio, f_comp, max_socio, max_comp):
        ws = wb.create_sheet(nombre)
        enc = ['n°', 'Estab.', 'Id.', 'Apellido Paterno', 'Apellido Materno', 'Nombre', 'Notas', 'Ranking Notas\n(1-3)',
               'Puntaje Académico\n(35)', 'RSH', 'I.P.C.', 'Puntaje I.P.C.\nFunc. Log. (30)', 'Puntaje Nivel\nEd. Padres',
               'Vul +\n(0/1)', 'Pje. Vul.\n(5)', f'Pje. Socio\necon. ({max_socio})', f'Comp. Y\nPart. ({max_comp})', 'Puntaje\nTotal',
               None, 'Ranking']
        ws.append(enc)
        tot = []
        for a in filas_orden:
            socio = round(a['socio'] * f_socio, 1)
            comp = round(a['comp'] * f_comp, 1)
            tot.append((a, round(a['acad'] + socio + comp, 1), socio, comp))
        ordenados = sorted(tot, key=lambda x: -x[1])
        lugar = {}
        for i, (a, t, _, _) in enumerate(ordenados):
            lugar[a['id']] = lugar[ordenados[i - 1][0]['id']] if i and ordenados[i - 1][1] == t else i + 1
        if f_socio == 1 and f_comp == 1:
            assert all(lugar[a['id']] == a['lugar'] for a in g.enRanking)
        for n, (a, t, socio, comp) in enumerate(tot, start=1):
            ws.append([n, f"{int(a['liceo'])}. {a['liceoNombre']}", a['id'], a['apP'], a['apM'],
                       a.get('nombreRanking', a['nombres']), round(a['prom'], 2), a['rankNotas'], a['acad'],
                       f"{a['tramo']}%" if a['tramo'] else 'P', a['ipc'] if a['ipc'] is not None else '-',
                       a['pIpc'], a['nivel'], a['vul'] or None, 5 * a['vul'], socio, comp, t, None, lugar[a['id']]])
        ultima = ws.max_row
        ws.cell(ultima + 2, 14, f'=SUM(N2:N{ultima})')   # celda suelta con la suma, como en el archivo real
        for c in ws[1]:
            if c.value:
                c.font = Font(bold=True)
                c.alignment = Alignment(wrap_text=True, horizontal='center', vertical='center')
        ws.row_dimensions[1].height = 45
        for row in ws.iter_rows(min_row=2, max_row=ultima):
            row[6].number_format = '0.00'
            row[10].number_format = '#,##0'
            for c in (row[12], row[15], row[16], row[17]):
                c.number_format = '0.0'
            row[16].fill = AMARILLO
            row[17].fill = PatternFill('solid', fgColor='DDEBF7')
        anchos = [5, 34, 10, 16, 16, 24, 7, 9, 10, 6, 10, 10, 9, 6, 7, 9, 8, 9, 2, 8]
        for i, w in enumerate(anchos, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.auto_filter.ref = f'A1:T{ultima}'
        ws.freeze_panes = 'D2'

    hoja('35.50.25', 1, 1, 50, 25)
    hoja('35.55.10', 55 / 50, 10 / 25, 55, 10)   # pestaña alternativa (para probar el selector)
    wb.save(ruta)


def si_no(v):
    return 'Sí' if v else 'No'


def escribir_guia(g, ruta, total_alumnos):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    inv = g.inv
    e1_av = [a for a in inv if a['etapa1'][1] == 'AVANZA']
    e2_av = [a for a in e1_av if a['etapa2'][0] == 'AVANZA']
    e3_av = [a for a in g.enRanking if a['etapa3'][0] == 'AVANZA']
    e4_av = [a for a in g.e4 if a['etapa4'][0] == 'AVANZA']
    becarios = [a for a in g.e5 if a['etapa5'][0].startswith('BECARIO')]
    participan = [l for l in g.liceos if l['participa']]

    # --- Paso a paso
    pasos = [
        ('0', 'Base', 'Base desde cero: docker compose --profile app down -v && docker compose --profile app up -d --build', '', 'Proceso 2025 cerrado, 28 liceos.'),
        ('1', 'Iniciar proceso 2026', f'Confirmar todos los liceos menos el {NO_PARTICIPA} ({next(l["nombre"] for l in g.liceos if l["cod"] == NO_PARTICIPA)}): marcarlo como "no participa".', '', f'{len(participan)} liceos participando. Ojo: 03 y 21 no tienen email de contraparte (advertencia esperada).'),
        ('2', 'Liceos → cada liceo → Subir nómina', 'Subir la nómina de cada liceo.', '1_nominas/nomina_liceo_XX.xlsx', f'{total_alumnos} alumnos en total. Liceos 09 y 23: 1 advertencia cada uno (nota escrita sin coma, ej. 46 → 4,6) y una nota escrita "5,1" como texto que se lee sin aviso. Todo se carga.'),
        ('3', 'Nómina del liceo → Invitar', 'IMPORTANTE para que los Id calcen: invitar liceo por liceo EN ORDEN (01, 02, 03, … sin el 12), con "mejores del liceo" y el N de la hoja Liceos, todos de una vez (un solo clic por liceo).', '', f'{len(inv)} invitados, Id 01.001a … {inv[-1]["id"]}. Comparar con la hoja Invitados.'),
        ('4', 'Invitados → Importar respuestas del formulario', 'Subir el Excel de Forms y revisar la previsualización contra la columna "Resultado esperado" de la hoja Forms (casos).', '2_Forms_confirmacion_interes_2026.xlsx',
         f'{len(g.filas_forms)} respuestas: 1 ambigua (elegir la del Id indicado), 1 sin calce (compañera no invitada: no cargar), 1 repetida (vale la última), avisos de email/teléfono/RUT.'),
        ('5', 'Invitados (a mano)', 'Corregir lo que el import no carga (ver hoja Forms (casos)) y marcar "Aceptó postular = Sí" al caso "Tal vez".', '', ''),
        ('6', 'Avance → Etapa 1', '"Sugerir desde confirmación"; marcar NO AVANZA a los que no respondieron; confirmar.', '', f'Avanzan {len(e1_av)} · No avanzan {len(inv) - len(e1_av)}.'),
        ('7', 'Encuentro (Etapa 2)', 'Crear las 3 fechas, inscribir según la hoja Etapa 2 y registrar los ausentes.', '', f'{sum(1 for a in e1_av if a["asistio"])} asisten, {sum(1 for a in e1_av if not a["asistio"])} ausentes.'),
        ('8', 'Avance → Etapa 2', '"Sugerir desde asistencia"; cambiar a AVANZA al ausente que justificó; confirmar.', '', f'Avanzan {len(e2_av)} · No avanzan {len(e1_av) - len(e2_av)}.'),
        ('9', 'Preselección (Etapa 3)', 'Marcar requisitos y llenar la ficha RSH según la hoja Etapa 3. Subir el ranking, pestaña "35.50.25".', '3_Ranking_Preseleccion_N1_2026.xlsx', f'{len(g.enRanking)} filas en el ranking, 0 sin cruzar. 6 estudiantes de la etapa no están en el ranking (desisten).'),
        ('10', 'Avance → Etapa 3', f'"Marcar según ranking" con N = {CUPO_ETAPA3}; marcar NO AVANZA a los 6 que no están en el ranking; confirmar.', '', f'Avanzan {len(e3_av)} · No avanzan {len(e2_av) - len(e3_av)}.'),
        ('11', 'Entrevistas (Etapa 4)', 'Agendar según la hoja Etapa 4 (bloques 10:00, 11:00, 12:00), poner estado y comentario.', '', f"{sum(1 for a in g.e4 if a['ent4']['estado'] == 'REALIZADA')} realizadas (1 de ellas reprogramada al 30/06), 1 cancelada."),
        ('12', 'Avance → Etapa 4', 'Marcar a mano quién avanza según la hoja Etapa 4; confirmar.', '', f'Avanzan {len(e4_av)} · No avanzan {len(g.e4) - len(e4_av)}.'),
        ('13', 'Entrevistas comité (Etapa 5)', 'Agendar y comentar según la hoja Etapa 5.', '', ''),
        ('14', 'Avance → Etapa 5', 'Marcar a los becarios (avanzan) y al resto (no avanza); confirmar.', '', f'Becarios {len(becarios)} · No seleccionados {len(g.e5) - len(becarios)}.'),
    ]
    hoja_tabla(wb, 'Paso a paso', ['Paso', 'Dónde', 'Qué hacer', 'Archivo', 'Resultado esperado'], pasos,
               anchos={'Dónde': 30, 'Qué hacer': 70, 'Archivo': 36, 'Resultado esperado': 60})
    ws = wb['Paso a paso']
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical='top')

    embudo = [('Liceos participando', len(participan)), ('Alumnos en nóminas', total_alumnos), ('Invitados (Etapa 1)', len(inv)),
              ('Etapa 2 (aceptaron postular)', len(e1_av)), ('Etapa 3 (asistieron al encuentro)', len(e2_av)),
              ('En el ranking', len(g.enRanking)), ('Etapa 4 (entrevista)', len(e3_av)), ('Etapa 5 (comité)', len(e4_av)),
              ('Becarios', len(becarios))]
    hoja_tabla(wb, 'Embudo', ['Etapa', 'Estudiantes'], embudo)

    hoja_tabla(wb, 'Liceos', ['Código', 'Liceo', 'Comuna', 'Participa', 'Cursos', 'Alumnos', 'N a invitar ("mejores del liceo")',
                              'Primer Id', 'Último Id'],
               [(l['cod'], l['nombre'], l['comuna'], si_no(l['participa']),
                 len(l['cursos']) if l['participa'] else None, len(l['alumnos']) if l['participa'] else None,
                 l['n_inv'] if l['participa'] else None,
                 min((a['id'] for a in inv if a['liceo'] == l['cod']), default=None),
                 max((a['id'] for a in inv if a['liceo'] == l['cod']), default=None)) for l in g.liceos])

    hoja_tabla(wb, 'Invitados', ['Id', 'Liceo', 'Curso', 'Nombres', 'Apellido paterno', 'Apellido materno', 'Promedio',
                                 'Lugar en el liceo', 'RUT', 'Email', 'Teléfono', 'Respuesta formulario', 'Caso de prueba',
                                 'Etapa 1', 'Detalle'],
               [(a['id'], f"{a['liceo']}. {a['liceoNombre']}", a['curso'], a['nombres'], a['apP'], a['apM'], a['prom'],
                 a['posLiceo'], a['rut'], a['email'], a['telefono'], a['etapa1'][0], a.get('caso', ''), a['etapa1'][1],
                 a['etapa1'][2]) for a in inv], color_col='Etapa 1')

    casos_txt = {
        'gmial': 'Dominio mal escrito: aceptar la sugerencia (@gmail.com).', 'hotmial': 'Dominio mal escrito: aceptar la sugerencia (@hotmail.com).',
        'email_malo': 'Email sin ".com": no se carga; escribir a mano el email correcto (columna Email de la hoja Invitados).',
        'tel_malo': 'Teléfono "3214": se carga con aviso; corregir a mano.', 'rut_malo': 'RUT con dígito verificador malo: no se carga; escribir a mano el correcto.',
        'typo_apellido': 'Apellido con una letra menos: igual calza.', 'apodo': 'Apodo entre paréntesis: igual calza.',
        'duplicado': 'Respondió 2 veces: vale la última (cambió el teléfono).', 'liceo_raro': 'Liceo no reconocido: busca en todos y calza por nombre.',
        'solo_un_nombre_1': 'Escribió un solo nombre y sin apellido materno: calza.', 'solo_un_nombre_2': 'Escribió un solo nombre y sin apellido materno: calza.',
        'mayusculas': 'Todo en mayúsculas: calza.', 'sin_tildes': 'Sin tildes y en minúsculas: calza.',
        'ambiguo': 'Escribió "Camila Rojas": AMBIGUO entre dos invitadas del liceo 20. Elegir la del Id indicado en "Debe quedar en".',
        'tal_vez': 'Respuesta "Tal vez": no se entiende; queda pendiente. Marcar Sí a mano.',
    }
    filas = []
    for f in g.filas_forms:
        a = f['inv']
        caso = 'no_invitada' if f['motivo'] == 'no_invitada' else (a.get('caso', '') if a else '')
        if caso == 'duplicado' and f.get('descartada'):
            nota = 'Primera respuesta del duplicado (queda descartada).'
        elif caso == 'no_invitada':
            nota = 'Compañera NO invitada que recibió el enlace: sin calce, no cargar.'
        else:
            nota = casos_txt.get(caso, '')
        filas.append((f['filaExcel'], ' '.join(x for x in (f['nombres'], f['apP'], f['apM']) if x), f['liceo'], f['email'], f['tel'],
                      f['rut'], f['acepta'], f['calce'], f['calzaCon'], a['id'] if a else '—', nota))
    filas.sort(key=lambda x: (x[10] == '', x[0]))
    hoja_tabla(wb, 'Forms (casos)', ['Fila Excel', 'Nombre escrito', 'Liceo escrito', 'Email escrito', 'Teléfono escrito', 'RUT escrito',
                                     'Acepta', 'Resultado esperado', 'Calza con', 'Debe quedar en', 'Qué revisar'], filas,
               anchos={'Qué revisar': 70})

    hoja_tabla(wb, 'Etapa 2 Encuentro', ['Id', 'Estudiante', 'Liceo', 'Fecha del encuentro', 'Asistió', 'Etapa 2', 'Detalle'],
               [(a['id'], nombre_completo(a), f"{a['liceo']}. {a['liceoNombre']}", a['encuentro'].strftime('%d/%m/%Y %H:%M'),
                 si_no(a['asistio']), a['etapa2'][0], a['etapa2'][1]) for a in e1_av], color_col='Etapa 2')

    e3 = [a for a in inv if a.get('etapa3')]
    hoja_tabla(wb, 'Etapa 3 Preselección', [
        'Id', 'Estudiante', 'Liceo', 'Formulario postulación', 'Cartola RSH', 'Certificado de notas', 'Declaración de ingresos',
        '% RSH (Excel)', 'Última actualización RSH', 'Personas hogar (RSH)', 'Menores de 18', 'Mayores de 60', 'Con discapacidad',
        'Con dependencia', 'Con invalidez', 'Con NEE', 'Ingresos del hogar (cartola)', 'Personas (formulario)', 'Observaciones',
        'Puntaje total', 'Lugar ranking', 'Etapa 3', 'Detalle'],
        [(a['id'], nombre_completo(a), f"{a['liceo']}. {a['liceoNombre']}", si_no(a['req']['form']), si_no(a['req']['rsh']),
          si_no(a['req']['notas']), si_no(a['req']['ingresos']),
          (f"{a['tramo']}%" if a.get('tramo') else 'P') if 'ficha' in a else None,
          a['ficha']['actualizada'].strftime('%d/%m/%Y') if 'ficha' in a and a['ficha']['actualizada'] else None,
          *((a['ficha'][k] for k in ('personas', 'menores', 'mayores60', 'discapacidad', 'dependencia', 'invalidez', 'nee'))
            if 'ficha' in a else [None] * 7),
          a['ficha']['ingresos'] if 'ficha' in a else None, a['ficha']['personasForm'] if 'ficha' in a else None,
          a['ficha']['obs'] if 'ficha' in a else None, a.get('total'), a.get('lugar'), a['etapa3'][0], a['etapa3'][1])
         for a in sorted(e3, key=lambda a: (a.get('lugar') or 999, a['id']))], color_col='Etapa 3',
        anchos={'Observaciones': 45, 'Detalle': 45})

    hoja_tabla(wb, 'Etapa 4 Entrevistas', ['Id', 'Estudiante', 'Liceo', 'Lugar ranking', 'Fecha', 'Hora', 'Estado', 'Comentario',
                                           'Etapa 4', 'Detalle'],
               [(a['id'], nombre_completo(a), f"{a['liceo']}. {a['liceoNombre']}", a['lugar'], a['ent4']['fecha'].strftime('%d/%m/%Y'),
                 a['ent4']['fecha'].strftime('%H:%M'), a['ent4']['estado'], a['ent4'].get('comentario', ''), a['etapa4'][0],
                 a['etapa4'][1]) for a in sorted(g.e4, key=lambda a: a['ent4']['fecha'])], color_col='Etapa 4',
               anchos={'Comentario': 70})

    hoja_tabla(wb, 'Etapa 5 Comité', ['Id', 'Estudiante', 'Liceo', 'Fecha', 'Hora', 'Estado', 'Comentario', 'Etapa 5', 'Detalle'],
               [(a['id'], nombre_completo(a), f"{a['liceo']}. {a['liceoNombre']}", a['ent5']['fecha'].strftime('%d/%m/%Y'),
                 a['ent5']['fecha'].strftime('%H:%M'), a['ent5']['estado'], a['ent5']['comentario'], a['etapa5'][0], a['etapa5'][1])
                for a in sorted(g.e5, key=lambda a: a['ent5']['fecha'])], color_col='Etapa 5', anchos={'Comentario': 55})

    # Ficha completa de quienes llegan a la etapa 4
    def final(a):
        if a in g.e5:
            return a['etapa5'][0]
        return 'Llegó a etapa 4'
    hoja_tabla(wb, 'Llegan a etapa 4 (60)', [
        'Id', 'Nombres', 'Apellido paterno', 'Apellido materno', 'RUT', 'Email', 'Teléfono', 'Liceo', 'Comuna', 'Curso',
        'Promedio 1°M', 'Promedio 2°M', 'Promedio', '% RSH', 'Personas hogar', 'Ingresos del hogar', 'I.P.C.',
        'Pje. académico', 'Pje. socioeconómico', 'Pje. compromiso', 'Puntaje total', 'Lugar ranking',
        'Entrevista (etapa 4)', 'Comentario etapa 4', 'Etapa 4', 'Entrevista comité', 'Comentario comité', 'Resultado final'],
        [(a['id'], a['nombres'], a['apP'], a['apM'], a['rut'], a['email'], a['telefono'], a['liceoNombre'],
          next(l['comuna'] for l in g.liceos if l['cod'] == a['liceo']), a['curso'], a['n1'], a['n2'], a['prom'],
          f"{a['tramo']}%" if a['tramo'] else 'P', a['ficha']['personas'], a['ficha']['ingresos'], a['ipc'],
          a['acad'], a['socio'], a['comp'], a['total'], a['lugar'],
          f"{a['ent4']['fecha']:%d/%m/%Y %H:%M} ({a['ent4']['estado']})", a['ent4'].get('comentario', ''), a['etapa4'][0],
          f"{a['ent5']['fecha']:%d/%m/%Y %H:%M}" if 'ent5' in a else '', a['ent5']['comentario'] if 'ent5' in a else '',
          final(a)) for a in sorted(g.e4, key=lambda a: a['lugar'])],
        color_col='Resultado final', anchos={'Comentario etapa 4': 50, 'Comentario comité': 45})
    ws = wb['Llegan a etapa 4 (60)']
    col = 28
    for row in ws.iter_rows(min_row=2):
        v = row[col - 1].value
        row[col - 1].fill = VERDE if v.startswith('BECARIO') else AMARILLO if v.startswith('NO SEL') else GRIS
    wb.save(ruta)


def main(plantilla, salida):
    base = Path.cwd().resolve()
    salida = (base / salida).resolve()
    if not salida.is_relative_to(base):
        sys.exit(f'La carpeta de salida debe estar dentro de {base}')
    g = Generador()
    g.nominas(); g.invitados(); g.formulario(); g.encuentro(); g.preseleccion(); g.entrevistas(); g.comite()
    total = sum(len(l['alumnos']) for l in g.liceos if l['participa'])
    escribir_nominas(g, plantilla, salida / '1_nominas')
    escribir_forms(g, salida / f'2_Forms_confirmacion_interes_{ANIO}.xlsx')
    escribir_ranking(g, salida / f'3_Ranking_Preseleccion_N1_{ANIO}.xlsx')
    escribir_guia(g, salida / 'GUIA_prueba_completa.xlsx', total)
    print(f'liceos {sum(l["participa"] for l in g.liceos)} · alumnos {total} · invitados {len(g.inv)} · '
          f'respuestas forms {len(g.filas_forms)} · ranking {len(g.enRanking)} · etapa4 {len(g.e4)} · etapa5 {len(g.e5)}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
