# Certificados CEE · herramienta de apoyo administrativo

Herramienta web para organizar el trabajo de emisión de **certificados de eficiencia energética de edificios**
(RD 390/2021) en Asturias: expedientes, toma de datos en la visita, seguimiento de estados y vencimientos.

> **Importante.** La herramienta **no** calcula, genera, firma ni registra certificados. No controla los programas
> oficiales (CE3X, CE3, CERMA…) ni presenta nada en la sede electrónica del Principado. Cada cambio de estado de un
> expediente exige una confirmación explícita del técnico. El certificado lo verifica y firma personalmente el
> técnico competente.

## Estado del desarrollo

| Módulo | Estado |
|---|---|
| 1. Gestión de expedientes (alta, estados, filtros, vencimientos) | ✅ Hecho |
| 2. Toma de datos en campo (móvil, borrador, guardado automático) | ✅ Hecho |
| 3. Ficheros para CE3X: fase 1, ficha de introducción · fase 2, `.cex` experimental | ⏳ Pendiente (fase 2: a la espera de proyectos `.cex` de prueba) |
| 4. Resultados (importación del PDF de CE3X), checklist previo a la firma y documentos | ✅ Hecho |
| 5. Paquete de documentación para el registro (sin envío) | ⏳ Pendiente |
| 6. Panel de recordatorios y estadísticas | ⏳ Pendiente (las alertas de vencimiento ya están en el listado) |

## Cómo funciona (en una frase)

La app es una **página web** alojada gratis en **Netlify**; tus datos se guardan en una base de datos **Supabase**
situada en la Unión Europea. Tu navegador habla directamente con Supabase: **los datos no pasan por Netlify**.

```
 Móvil / ordenador  ──(pantallas)──▶  Netlify (gratis)
        │
        └──────────(datos, cifrados)──▶  Supabase (UE, gratis)
```

Para entrar hacen falta **email + contraseña + un código del móvil** (verificación en dos pasos). Además, solo las
cuentas que tú autorices en la base de datos pueden ver algo.

---

# Instalación paso a paso

Solo hay que hacerlo **una vez**. Calcula unos 30–45 minutos. No hace falta instalar nada en tu ordenador.

Necesitas:
- Una cuenta de **GitHub** (ya la tienes: es donde está este código).
- Una app de autenticación en el móvil: **Google Authenticator** o **Microsoft Authenticator** (gratis).

## Paso 1 · Crear el proyecto en Supabase

1. Entra en <https://supabase.com> y pulsa **Start your project**. Regístrate con tu cuenta de GitHub.
2. Pulsa **New project** y rellena:
   - **Name:** `certificados` (o el que quieras).
   - **Database Password:** pulsa *Generate a password* y **guárdala** en un sitio seguro.
   - **Region:** elige una de Europa, por ejemplo **West EU (Ireland)** o **Central EU (Frankfurt)**.
     ⚠️ Esto es importante por protección de datos (RGPD) y no se puede cambiar después.
   - **Plan:** Free.
3. Pulsa **Create new project** y espera un par de minutos.

## Paso 2 · Crear las tablas

1. En el menú de la izquierda de Supabase, abre **SQL Editor**.
2. Pulsa **New query**.
3. Abre en GitHub el fichero [`supabase/migrations/20260923100000_01_expedientes.sql`](supabase/migrations/20260923100000_01_expedientes.sql),
   pulsa el botón **Copy raw file** (icono de copiar), pégalo en el editor de Supabase y pulsa **Run**.
   Debe decir *Success. No rows returned*.
4. Repite lo mismo con [`supabase/migrations/20260923100100_02_seguridad.sql`](supabase/migrations/20260923100100_02_seguridad.sql).
5. Y con [`supabase/migrations/20260924090000_03_resultados.sql`](supabase/migrations/20260924090000_03_resultados.sql)
   (resultados, checklist y almacén de documentos).

Ejecútalos **en ese orden** y **una sola vez** cada uno. Si ya tenías instalados los dos primeros, ejecuta solo el
tercero.

## Paso 3 · Configurar el acceso

En Supabase, menú **Authentication**:

1. **Sign In / Providers → Email**: déjalo activado.
2. **Desactiva los registros públicos**: en *Authentication → Sign In / Providers* (o *Settings*) desactiva
   **Allow new users to sign up**. Así nadie más puede crearse una cuenta.
3. **Multi-Factor**: en *Authentication → Multi-Factor* comprueba que **TOTP (App Authenticator)** está activado.
4. **Crea tu usuario**: *Authentication → Users → Add user → Create new user*. Pon tu email y una contraseña larga
   (12 caracteres o más) y marca **Auto Confirm User**.

## Paso 4 · Autorizar tu cuenta

En **SQL Editor → New query**, pega esto cambiando el email por el tuyo, y pulsa **Run**:

```sql
insert into public.tecnicos (user_id, nombre)
select id, 'Tu nombre' from auth.users where email = 'tu-email@ejemplo.com';
```

Debe decir *Success. 1 row*. Si dice *0 rows*, el email no coincide con el del paso 3.

## Paso 5 · Copiar las claves de conexión

En Supabase, abre **Project Settings** (la rueda dentada) → **API** (o **Data API** / **API Keys**) y copia:

- **Project URL**: algo como `https://abcdefghijk.supabase.co`
- **Clave pública**: la llamada **anon public** o **publishable** (empieza por `eyJ…` o por `sb_publishable_…`).

⚠️ **No copies nunca** la clave **service_role** / **secret**: esa da acceso total y no debe ir en la web.

## Paso 6 · Publicar la web en Netlify

1. Entra en <https://www.netlify.com> y regístrate con tu cuenta de GitHub (plan **Free**, que permite uso
   profesional).
2. Pulsa **Add new site → Import an existing project → GitHub** y elige el repositorio `certi-vertian`.
3. Netlify detecta la configuración sola (`netlify.toml`). **Antes de desplegar**, en **Environment variables**
   (o después, en *Site configuration → Environment variables*) añade estas dos:

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | la *Project URL* del paso 5 |
   | `VITE_SUPABASE_CLAVE_PUBLICA` | la clave pública del paso 5 |

4. Pulsa **Deploy**. En uno o dos minutos te dará una dirección tipo `https://nombre-aleatorio.netlify.app`.
   Puedes cambiar el nombre en *Site configuration → Change site name*.
5. Si añadiste las variables después del primer despliegue: *Deploys → Trigger deploy → Deploy site*.

## Paso 7 · Primer acceso

1. Abre la dirección de Netlify en el móvil o el ordenador.
2. Entra con tu email y contraseña.
3. La app te pedirá **activar la verificación en dos pasos**: escanea el código QR con Google/Microsoft
   Authenticator y escribe el código de 6 cifras.
4. A partir de ahí, cada vez que entres te pedirá contraseña + código del móvil.

**Consejo para el móvil:** en el navegador del móvil, menú → **Añadir a pantalla de inicio**. Tendrás un icono
como si fuera una app.

---

# Uso diario

## Flujo de un expediente

```
Visita pendiente → Datos introducidos → Cálculo revisado → Certificado firmado → Registrado
```

- **Ningún paso es automático.** Cada uno se confirma con un botón y una casilla de declaración, y queda anotado en
  el historial con fecha y hora.
- Se puede **devolver** un expediente al estado anterior indicando el motivo (queda en el historial).
- Al marcar **Certificado firmado** se pide la fecha de firma (las calificaciones salen de los resultados); la app calcula el
  **vencimiento**: 10 años, o 5 si alguna calificación es G. El listado avisa de los vencimientos con 6 meses de
  antelación.
- Solo se pueden **borrar** expedientes en «Visita pendiente».

## Toma de datos en la visita

- Se rellena desde el móvil: datos generales, cerramientos, huecos, puentes térmicos, instalaciones, renovables e
  iluminación (esta última en terciario).
- **Se guarda sola** cada 20 segundos si hay conexión, y además **se guarda una copia en el propio móvil** en cada
  cambio. Si se corta la conexión no pierdes nada: al volver a abrir el expediente, la app te ofrecerá recuperar los
  cambios.
- Los valores poco habituales (una U muy alta, un rendimiento de caldera raro…) se marcan en amarillo. **La app nunca
  los corrige**: tienes que confirmarlos uno a uno antes de verificar.
- Cuando todo está revisado, pulsa **Verificar y pasar a «Datos introducidos»**. Desde ese momento los datos quedan
  **congelados**; para corregirlos hay que devolver el expediente a «Visita pendiente».

## Resultados del cálculo

- Cuando hayas calculado en CE3X, abre **Resultados del cálculo** y elige el **PDF del certificado**. Se lee en tu
  propio dispositivo (no se envía a ningún sitio) y la app te enseña lo leído al lado de los datos del expediente.
  Solo si pulsas **Usar estos valores** se pasan al formulario, donde puedes corregir cualquier cosa.
- También puedes teclear los resultados a mano.
- Recomendaciones de mejora: añádelas una a una o, si no hay medidas viables, escribe la justificación.
- Si algo no cuadra (letra que no corresponde a la escala del propio certificado, referencia catastral o fecha de
  visita distintas, certificado anterior a la visita, sin recomendaciones…) aparece un aviso que debes confirmar.
- Al pulsar **Confirmar y pasar a «Cálculo revisado»** los resultados quedan congelados.

## Checklist previo a la firma

- 12 puntos de revisión (referencia catastral, dirección, tipo, superficie, Anexo I, fechas, calificación,
  recomendaciones, fichero de cálculo adjunto, PDF adjunto, datos del técnico).
- Junto a cada punto, una **comprobación de apoyo** (✓ coincide / ⚠ revisar) calculada con el PDF importado. Es solo
  una ayuda: **ningún punto se marca solo**. Si marcas uno que señala una diferencia, la app te pide confirmarlo y lo
  anota.
- Sin los 12 puntos marcados no se puede pasar a «Certificado firmado». Al firmar, las calificaciones se toman de
  los resultados confirmados (no se vuelven a teclear).
- Si devuelves el expediente a «Datos introducidos», el checklist se reinicia.

## Documentos

- En la ficha y en el checklist puedes subir el `.cex`, el PDF, el XML, fotos… (máximo 25 MB por fichero). Se
  guardan en el almacén privado de Supabase; solo tú puedes verlos.
- Los documentos de un expediente **registrado** ya no se pueden borrar.

---

# Copias de seguridad

El plan gratuito de Supabase **no incluye copias de seguridad descargables**. Hasta que la app tenga su botón de
«Descargar copia completa» (previsto con el módulo 6), haz una copia manual de vez en cuando:

1. Supabase → **Table Editor** → tabla `expedientes` → botón **Export → Export to CSV**.
2. Repite con `toma_datos`, `historial_estados`, `resultados` y `checklist_revision`.
   Los documentos se descargan uno a uno desde la ficha del expediente (o en Supabase → **Storage** → `documentos`).
3. Guarda los ficheros en tu ordenador y, a ser posible, en un disco externo.

Si en el futuro pasas al plan **Pro** de Supabase, tendrás copias diarias automáticas sin cambiar nada de la app.

**Pausa por inactividad:** si pasas más de 7 días sin usar la app, Supabase puede **pausar** el proyecto gratuito.
No se pierde nada: entra en <https://supabase.com/dashboard>, abre el proyecto y pulsa **Restore project**.

---

# Protección de datos (RGPD)

Tú eres el **responsable del tratamiento** de los datos de propietarios y promotores. Recomendaciones:

- Proyecto de Supabase en una región de la **UE** (paso 1).
- Acepta el **acuerdo de encargado del tratamiento (DPA)** de Supabase: <https://supabase.com/legal/dpa>.
- Contraseña larga y única, y verificación en dos pasos (la app la exige).
- Si usas un ordenador o móvil compartido, pulsa **Salir** al terminar: se borran las copias locales de los
  borradores.

---

# Para desarrolladores

```bash
npm install
cp .env.ejemplo .env.local     # y rellenar las dos variables
npm run dev                    # http://localhost:5173
npm test                       # pruebas de validaciones y toma de datos
npm run typecheck
npm run build                  # genera dist/ (lo que publica Netlify)
```

Pruebas de la base de datos (Postgres 16 local, simula el `auth` de Supabase):

```bash
PGHOST=/tmp PGPORT=5433 npm run db:test
```

Estructura:

```
src/
  lib/            validaciones, estados, modelo de la toma de datos, acceso a datos
  componentes/    campos de formulario, sesión, marco de la app
  paginas/        pantallas
supabase/
  migrations/     esquema y seguridad (RLS) — se ejecutan en el SQL Editor
  tests/          pruebas SQL del flujo de estados y de la seguridad
netlify.toml      publicación y cabeceras de seguridad
```

Principios del diseño:

- **Toda la seguridad está en la base de datos** (RLS): sesión + verificación en dos pasos (`aal2`) + cuenta en
  `tecnicos` + titularidad de la fila. La web no tiene servidor propio ni clave de servicio.
- **El estado solo cambia con `cambiar_estado()`**, que avanza o retrocede un paso y lo anota en el historial. Un
  `UPDATE` directo del estado, la firma o el registro se rechaza.
- **Los PDF se leen en el navegador** (`src/lib/certificadoPdf.ts`, probado con CE3X v2.3). Lo leído es una
  propuesta que el técnico revisa; lo que no se encuentra se deja vacío.
- **Las validaciones no modifican datos**: devuelven error (no se admite) o aviso (se admite si el técnico lo
  confirma). La clave de cada aviso incluye el valor, así que si el valor cambia hay que volver a confirmarlo.
