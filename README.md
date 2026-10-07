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
| 2b. Rellenar la toma de datos por voz, texto libre o archivo (Excel/CSV/JSON) | ✅ Hecho |
| 3. Ficheros para CE3X · fase 1: ficha de introducción imprimible | ✅ Hecho |
| 3. Ficheros para CE3X · fase 2: generar el `.cex` (experimental) | 🧪 Datos administrativos y generales sobre una plantilla; envolvente e instalaciones, pendientes |
| 4. Resultados (importación del PDF de CE3X), checklist previo a la firma y documentos | ✅ Hecho |
| 5. Paquete de documentación para el registro de Asturias (sin envío) | ✅ Hecho |
| 6. Panel (pendientes, visitas, vencimientos, estadísticas) y copia de seguridad completa | ✅ Hecho |
| 7. Misma base de datos que el CRM de Vertian: expedientes desde sus pedidos y presupuestos de certificados | ✅ Hecho |

## Cómo funciona (en una frase)

La app es una **página web** publicada en **Cloudflare**, en la misma cuenta que el CRM. Sus datos se guardan en el **mismo Supabase que el CRM de
Vertian** (Unión Europea), en tablas propias. Así lee directamente los pedidos de certificado del CRM, sin copiar
nada entre dos bases de datos. Tu navegador habla directamente con Supabase: **los datos no pasan por Cloudflare**.

```
 Móvil / ordenador  ──(pantallas)──▶  Cloudflare (Worker certi-vertian)
        │
        └──────────(datos, cifrados)──▶  Supabase del CRM (UE)
                                          ├─ tablas del CRM (clientes, pedidos, presupuestos…)
                                          └─ tablas de CertiVertian (expedientes, toma de datos…)
```

Los empleados del CRM no ven nada de CertiVertian, y CertiVertian solo **lee** del CRM los encargos de certificado.

Para entrar hacen falta **email + contraseña + un código del móvil** (verificación en dos pasos). Además, solo las
cuentas que tú autorices en la base de datos pueden ver algo.

---

# Instalación paso a paso

Solo hay que hacerlo **una vez**. Calcula unos 20–30 minutos. No hace falta instalar nada en tu ordenador.

Necesitas:
- El **CRM de Vertian ya instalado** (su Supabase, con todas sus migraciones ejecutadas).
- Una cuenta de **GitHub** (ya la tienes: es donde está este código).
- Una app de autenticación en el móvil: **Google Authenticator** o **Microsoft Authenticator** (gratis).

> ¿Ya tenías CertiVertian con su propio Supabase? Lee antes «Pasar al Supabase del CRM», al final de esta sección.

## Paso 1 · Usar el Supabase del CRM

No hay que crear otro proyecto. Entra en <https://supabase.com/dashboard> y abre el **proyecto del CRM**. Todo lo que
sigue se hace en ese proyecto.

## Paso 2 · Crear las tablas

Las migraciones del CRM tienen que estar ya ejecutadas: la última de estas (la 05) las necesita y, si faltan,
avisa sin cambiar nada.

1. En el menú de la izquierda de Supabase, abre **SQL Editor**.
2. Pulsa **New query**.
3. Abre en GitHub el fichero [`supabase/migrations/20260923100000_01_expedientes.sql`](supabase/migrations/20260923100000_01_expedientes.sql),
   pulsa el botón **Copy raw file** (icono de copiar), pégalo en el editor de Supabase y pulsa **Run**.
   Debe decir *Success. No rows returned*.
4. Repite lo mismo con [`supabase/migrations/20260923100100_02_seguridad.sql`](supabase/migrations/20260923100100_02_seguridad.sql).
5. Y con [`supabase/migrations/20260924090000_03_resultados.sql`](supabase/migrations/20260924090000_03_resultados.sql)
   (resultados, checklist y almacén de documentos).
6. Y con [`supabase/migrations/20260925090000_04_registro.sql`](supabase/migrations/20260925090000_04_registro.sql)
   (tipos de documento para el registro).
7. Y con [`supabase/migrations/20261007090000_05_encargos_crm.sql`](supabase/migrations/20261007090000_05_encargos_crm.sql)
   (lectura de los encargos de certificado del CRM; ver «Conexión con el CRM»).
8. Y con [`supabase/migrations/20261008090000_06_plantilla_cex.sql`](supabase/migrations/20261008090000_06_plantilla_cex.sql)
   (tu plantilla de CE3X guardada y la dirección del cliente desde el CRM).
9. Y con [`supabase/migrations/20261009090000_07_visitas_catalogo.sql`](supabase/migrations/20261009090000_07_visitas_catalogo.sql)
   (visitas grabadas y catálogo de soluciones de CE3X).

Ejecútalos **en ese orden** y **una sola vez** cada uno. Si ya tenías instalados algunos, ejecuta solo los que
faltan.

## Paso 3 · Configurar el acceso

Las cuentas son **las mismas que las del CRM**: entras en CertiVertian con tu usuario del CRM. En Supabase, menú
**Authentication**:

1. **Registros públicos desactivados**: en *Authentication → Sign In / Providers* (o *Settings*), **Allow new users
   to sign up** debe estar desactivado (el CRM ya lo pide así).
2. **Multi-Factor**: en *Authentication → Multi-Factor* activa **TOTP (App Authenticator)**. CertiVertian exige la
   verificación en dos pasos aunque el CRM no la pida.
3. No hace falta crear usuario: usa tu cuenta del CRM. (Si algún día creas aquí un usuario solo para CertiVertian,
   el CRM lo dará de alta como empleado: desactívalo en el CRM, en *Usuarios*.)

## Paso 4 · Autorizar tu cuenta

En **SQL Editor → New query**, pega esto cambiando el email por el tuyo, y pulsa **Run**:

```sql
insert into public.tecnicos (user_id, nombre)
select id, 'Tu nombre' from auth.users where email = 'tu-email@ejemplo.com';
```

Debe decir *Success. 1 row*. Si dice *0 rows*, el email no coincide con el de tu cuenta del CRM.

Solo las cuentas de esta tabla ven algo de CertiVertian. Los demás usuarios del CRM no ven nada.

## Paso 5 · Copiar las claves de conexión

En el Supabase del CRM, abre **Project Settings** (la rueda dentada) → **API** (o **Data API** / **API Keys**) y copia:

- **Project URL**: algo como `https://abcdefghijk.supabase.co`
- **Clave pública**: la llamada **anon public** o **publishable** (empieza por `eyJ…` o por `sb_publishable_…`).

⚠️ **No copies nunca** la clave **service_role** / **secret**: esa da acceso total y no debe ir en la web.

## Paso 6 · Publicar la web en Cloudflare

Se publica en la **misma cuenta de Cloudflare que el CRM**, como un Worker que solo sirve las pantallas (no tiene
servidor ni claves secretas). Va incluido en el plan Workers que ya pagas para el CRM.

1. Cloudflare → **Workers & Pages → Create → Import a repository** → elige el repositorio **certi-vertian**
   (si no aparece, en *Manage GitHub permissions* dale acceso a Cloudflare).
2. Rellena:

   | Campo | Valor |
   |---|---|
   | Project name (nombre) | `certi-vertian` (tiene que ser exactamente este) |
   | Build command (compilar) | `npm run build` |
   | Deploy command (publicar) | `npx wrangler deploy` |
   | Rama (branch) | `main` |

3. Antes de pulsar **Create and deploy**, abre **Advanced settings → Build variables** (si no aparece, hazlo
   después en *Settings → Build → Variables and secrets*) y añade:

   | Variable | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | la *Project URL* del paso 5 |
   | `VITE_SUPABASE_CLAVE_PUBLICA` | la clave pública del paso 5 |

   Son variables **de compilación** (se meten en la web al publicarla), no las de *Variables and Secrets* de
   ejecución. La dirección del CRM para el botón «Abrir en el CRM» ya va en `.env.production`.
4. **Create and deploy**. En uno o dos minutos tendrás una dirección de prueba como
   `https://certi-vertian.<tu-cuenta>.workers.dev`. Si añadiste las variables después, vuelve a publicar:
   *Deployments → … → Retry deployment* (o haz cualquier cambio en `main`).
5. **Tu dirección:** *Settings → Domains & Routes → Add → Custom domain* → `certi.vertiansolutions.es`. En unos
   minutos funcionará con candado (HTTPS).

6. **Secretos para la visita grabada** (Cloudflare → Workers & Pages → certi-vertian → *Settings → Variables and
   Secrets* → *Add*, tipo **Secret**; son de **ejecución**, distintos de los del punto 3):

   | Nombre | Valor |
   |---|---|
   | `ANTHROPIC_API_KEY` | una clave de <https://console.anthropic.com> → *API Keys* → *Create Key* (`sk-ant-…`). Puede ser de la misma cuenta que la del chat del CRM: Cloudflare no deja leer la del CRM, así que crea otra para CertiVertian. |
   | `SUPABASE_URL` | la misma *Project URL* del paso 5 |
   | `SUPABASE_CLAVE_PUBLICA` | la misma clave pública del paso 5 |

   El Worker los usa para comprobar que quien pide procesar una visita es un técnico con doble factor, y para llamar a
   Claude. La transcripción del audio usa **Workers AI** de Cloudflare, que ya viene activado con la cuenta (no
   necesita clave). Opcional: `ANTHROPIC_MODEL` para usar otro modelo (por defecto `claude-opus-5-5`).

Las cabeceras de seguridad (las que limitan con quién puede hablar la página) están en `public/_headers` y las
aplica Cloudflare solo. Cada cambio en `main` se publica automáticamente.

**Si vienes de Netlify:** cuando la dirección nueva funcione y hayas entrado con tu usuario, en Netlify →
*Site configuration → General → Delete this site*. Si ya no lo usas para nada más, en GitHub → *Settings →
Applications* puedes quitar también el acceso de Netlify.

## Paso 7 · Primer acceso

1. Abre `https://certi.vertiansolutions.es` (o la de prueba `…workers.dev`) en el móvil o el ordenador.
2. Entra con tu email y contraseña.
3. La app te pedirá **activar la verificación en dos pasos**: escanea el código QR con Google/Microsoft
   Authenticator y escribe el código de 6 cifras.
4. A partir de ahí, cada vez que entres te pedirá contraseña + código del móvil.

**Consejo para el móvil:** en el navegador del móvil, menú → **Añadir a pantalla de inicio**. Tendrás un icono
como si fuera una app.

## Pasar al Supabase del CRM (si ya tenías CertiVertian instalado aparte)

1. **Guarda una copia** de lo que tengas: en el Panel de CertiVertian, **Descargar copia completa**.
2. Sigue los pasos 2 a 4 en el **Supabase del CRM**.
3. Publica la web en Cloudflare con `VITE_SUPABASE_URL` y `VITE_SUPABASE_CLAVE_PUBLICA` **del CRM** (paso 6).
4. Entra en CertiVertian con tu cuenta del CRM y activa la verificación en dos pasos.
5. Los expedientes del Supabase antiguo **no pasan solos**. Si solo eran pruebas, empieza de cero. Si alguno es real,
   la copia del paso 1 lo conserva (con sus documentos) y se puede volver a dar de alta. El proyecto antiguo puedes
   pausarlo o borrarlo cuando ya no lo necesites.

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

## Conexión con el CRM (solicitudes de la web)

CertiVertian usa la **misma base de datos que el CRM**, así que ve directamente sus **encargos de certificado**:

- los **pedidos de certificado** que el cliente hace con su formulario del CRM:
  - tipo de inmueble, superficie, dirección, código postal, población y referencia catastral;
  - para qué lo quiere, plazo, contacto para la visita y mensaje;
- los **presupuestos de certificados** en los que el cliente ha rellenado el inmueble en el trámite. Si el
  presupuesto viene de un pedido, sale una sola vez, con los datos más completos;
- y la **visita** que haya reservado.

Aparecen en **Solicitudes** (menú de arriba, con el número de pendientes):

1. Pulsa **Crear expediente**: se abre el formulario de siempre ya relleno (dirección, municipio, código postal,
   referencia catastral, tipo de edificio, propietario, NIF, teléfono, email y fecha de la visita). En las notas van
   el resto de datos del encargo. Arriba te dice qué revisar.
2. Revisa y pulsa **Guardar**. Hasta entonces no se crea nada. El expediente queda **enlazado** a su pedido o
   presupuesto del CRM.
3. Después, en la toma de datos, completa el resto por **voz, texto o archivo** y genera el `.cex` desde la
   **Ficha para CE3X**.

Algunos datos no se copian a propósito:
- La **superficie** que da el cliente es construida o aproximada. Va a las notas: la útil la mides tú.
- Un tipo dudoso, como «Edificio completo», se deja para que lo elijas tú.
- Si el inmueble no está en Asturias, se avisa.

Si después el cliente cambia datos en el CRM o reserva la visita, al **Editar** el expediente verás lo que hay en el
expediente al lado de lo que hay ahora en el CRM. Pulsa **Usar** en lo que quieras traer.

**Descartar** quita un encargo de tus pendientes (por ejemplo, si no sigue adelante). En el CRM no cambia nada.

**Seguridad:**
- CertiVertian solo **lee** del CRM y solo los encargos de certificado, con los campos necesarios. No puede
  modificar nada del CRM.
- Solo lo ven las cuentas autorizadas en `tecnicos`, con la verificación en dos pasos.
- Si en el CRM se borran los datos de un cliente (derecho de supresión), el expediente se conserva sin el enlace.

## Grabar la visita (voz y fotos)

La forma recomendada de tomar datos: **sin bolígrafo ni libreta, y sin que el móvil te pregunte nada**.

1. **En el inmueble**, en la ficha del expediente o en la toma de datos: **🎙 Grabar la visita**.
   - Pulsa **● Grabar** y ve contando lo que ves, en el orden que quieras: «fachada norte de ladrillo, cámara sin
     aislar, doce metros por dos sesenta… ventana del salón de aluminio sin rotura, doble vidrio, persiana, uno
     cuarenta de ancho por uno veinte de alto… termo eléctrico de 80 litros, 2,5 kW». Puedes corregirte («no,
     perdón, son catorce metros»).
   - **📷 Foto**: placas de la caldera o el termo, ventanas, fachadas, contador… La IA lee las placas (marca, modelo,
     potencia, año).
   - **📄 PDF**: si tienes la consulta descriptiva y gráfica del Catastro en PDF, adjúntala y se sacan de ella el año,
     la superficie construida y el uso.
   - **Funciona sin cobertura**: el audio se guarda en el móvil por tramos de 2 minutos y cada foto al momento. Si se
     cierra la página, no se pierde lo grabado. Deja la pantalla encendida mientras grabas.
2. **Procesar la visita** (cuando haya conexión, en el mismo móvil):
   - el audio se pasa a texto con Whisper en Cloudflare (Workers AI);
   - Claude lee la transcripción, las fotos y los PDF y propone los datos para la toma de datos, cada uno con la frase
     de la que sale; lo dudoso lo pone en «Dudas que conviene revisar» en lugar de inventarlo;
   - también redacta el texto de «pruebas, comprobaciones e inspecciones realizadas» del informe de CE3X.

   Después te ofrece borrar el audio y las fotos del móvil. En el servidor solo queda la transcripción y la
   propuesta, nunca el audio ni las fotos. Cuesta unos céntimos por visita en la cuenta de Anthropic.
3. **En la oficina**, en la toma de datos, **Visitas grabadas**: revisas la propuesta, desmarcas lo que no quieras y
   **Añadir a la toma de datos**. Lo añadido pasa por las comprobaciones de siempre. Luego **⬇ Generar .cex**.

**Datos del Catastro:** en la toma de datos, el apartado *Datos del Catastro* consulta la referencia catastral del
expediente en el servicio público de la Sede Electrónica del Catastro (año, superficie construida, uso, planta) y
te deja usar el año o añadir el resto a las observaciones. Si el Catastro no responde, adjunta su PDF en la visita.

## Asistente por voz para CE3X

En la toma de datos, **🎙 Empezar el asistente** te guía por las cuatro pantallas de CE3X, en su orden:

1. **Datos administrativos:** no pregunta nada que ya se sepa:
   - edificio y propietario salen del expediente;
   - la dirección del cliente sale de su ficha del CRM, o, si no la hay, se usa la del inmueble;
   - grado de protección «ninguno» y uso «residencial privado» en viviendas.

   Todo lo puesto así aparece en «Lo que he apuntado» para que lo revises.
2. **Datos generales:** año (si no está en el expediente), superficies, plantas y ACS.
   - La **normativa** sale del año de construcción, con aviso en los años frontera, donde manda la fecha de la
     licencia.
   - La **zona climática** no se pregunta: CE3X la asigna al elegir la localidad.
3. **Envolvente térmica:** describes cada elemento («fachada norte de 25 metros cuadrados», «ventana sur de 1,20
   por 1,50, doble vidrio») y solo te pregunta lo que falte (superficie, orientación, vidrio, marco…). Di
   «terminado» para pasar a lo siguiente.
4. **Instalaciones:** igual, con cada equipo («caldera de gas natural para calefacción y ACS de 24 kilovatios»).

Cómo te pregunta:
- Lee cada pregunta en voz alta y escucha tu respuesta. Si quitas «Manos libres», pulsa «Escuchar» cada vez.
  También puedes responder escribiendo.
- Entiende números dichos («ochenta y cinco coma cinco», «mil novecientos setenta») y medidas («1,20 por 1,50»).
- Puedes decir «saltar», «atrás», «repetir», «terminado» o «parar».
- **No pregunta** lo que ya está en el expediente o en la toma de datos, ni los valores que CE3X pone por defecto
  (altura libre 2,7 m, ventilación 0,63 ren/h, masa media, «Sin patrón», rendimientos estimados…).
- En una vivienda pone solo el uso «residencial privado» y una unidad de uso.

Lo que dictas va a los campos de la toma de datos. Ahí lo ves, lo corriges y pasa las comprobaciones de siempre.

## Generar el .cex desde la toma de datos

Arriba de la toma de datos está **Fichero para CE3X → ⬇ Generar .cex**.

- **La primera vez** te pide tu **plantilla**: en CE3X, un proyecto nuevo con solo tus datos de técnico,
  guardado. Se queda guardada (solo la ves tú) y no hay que volver a elegirla.
- **El .cex sale con las pantallas 1 y 2 de CE3X rellenas:**
  - edificio: nombre, dirección, provincia, localidad, código postal, catastro, protección y uso;
  - cliente: nombre, dirección, localidad, código postal, provincia, teléfono y email;
  - datos generales: normativa, tipo, año, zona, superficies, viviendas, plantas y ACS.

  Al descargarlo te enseña qué ha puesto y qué queda por completar.
- **Los desplegables de CE3X** solo se rellenan con valores comprobados en un proyecto real. Si el texto no
  coincide exactamente con una de sus opciones, CE3X se cuelga al abrir el fichero.
  - La **localidad** la eliges tú en CE3X (pantallas 1 y 2), y al hacerlo CE3X asigna la zona climática.
  - Lo demás que no esté comprobado sale en la lista de pendientes con el texto exacto que hay que elegir.
- **Envolvente e instalaciones** se escriben copiando **soluciones de un proyecto real de CE3X** (ver el
  catálogo, abajo): fachadas, particiones, ventanas, puentes térmicos y equipos. En la copia solo cambian el
  nombre, las medidas, la orientación y la potencia. Lo que no encaja con ninguna solución del catálogo queda en
  pendientes para introducirlo en CE3X con la «Ficha para CE3X».
  - Los **puentes térmicos** se generan como los genera CE3X por defecto: pilares, esquina y forjado de cada
    fachada (necesita largo y alto), contorno de cada hueco y caja de persiana.
  - En los **huecos**, abre cada uno en CE3X, asigna el patrón de sombras si lo hay y pulsa «Modificar» para que
    recalcule los factores solares.
- **Catálogo de soluciones de CE3X** (dentro de «Fichero para CE3X»): trae de serie las del proyecto de ejemplo
  (fachada estimada de doble hoja, fachada con composición, partición interior por defecto, ventana metálica sin
  RPT con doble vidrio, termo y radiadores eléctricos). **Sube tus proyectos .cex terminados** para que aprenda
  los tuyos (calderas, bombas de calor, PVC, cubiertas…): de cada proyecto solo se guardan la envolvente y las
  instalaciones, nunca los datos del cliente. En cada cerramiento, hueco o instalación de la toma de datos puedes
  elegir la solución en **Solución de CE3X**; si la dejas vacía se usa la única que encaje (por tipo y U, por marco
  y vidrio, o por servicio, generador y combustible). Las orientaciones solo se escriben si ya han aparecido en
  algún proyecto del catálogo.


En la toma de datos, el apartado **Rellenar por voz, texto o archivo** ahorra teclear campo a campo:

- **Dictado**: pulsa **🎙 Dictar** y di un elemento cada vez, haciendo una pausa (o diciendo «siguiente») entre
  uno y otro. Por ejemplo:
  - «Zona climática D1, superficie útil 85,5, altura libre 2,5, 2 plantas, NBE-CT-79»
  - «Fachada norte 24 metros cuadrados U 1,35 estimada»
  - «Dos ventanas en fachada norte de 1,20 por 1,50, doble vidrio, aluminio con rotura de puente térmico, con persiana»
  - «Frente de forjado 12 metros»
  - «Caldera de condensación de gas natural para calefacción y agua caliente, 24 kilovatios, rendimiento 98 %»
- **Texto libre**: escribe o pega lo mismo, una línea por elemento, y pulsa **Interpretar**.
- **Archivo**: un Excel (`.xlsx`) o CSV con una fila por elemento y una columna «Sección» (descarga la plantilla
  desde el propio apartado), un `.txt` con frases como las de arriba, o un JSON de la toma de datos de la app.

La app enseña **lo que ha entendido** (y lo que no), qué datos sustituye y qué queda por rellenar. Solo se añade lo
que marcas, y después pasa por las mismas comprobaciones de siempre (valores raros en amarillo). Una U de ventana hay
que decir si es «del vidrio» o «del marco»; si no, no se usa. Las medidas «1,20 por 1,50» se multiplican y se avisa.

⚠️ El dictado usa el reconocimiento de voz del navegador: en Chrome y Edge **la voz se envía a Google o Microsoft**
para pasarla a texto. Dicta solo datos técnicos (nada de nombres, DNI o teléfonos). Firefox no tiene dictado; en el
móvil siempre puedes usar el micrófono del teclado dentro del cuadro de texto. Los archivos se leen en tu
dispositivo y no se envían a ningún sitio.

## Ficha para CE3X

- En la ficha del expediente, **Ficha para CE3X**: todos los datos de la visita ordenados como las pantallas de CE3X
  (datos administrativos, datos generales, envolvente por tipo de cerramiento, huecos, puentes térmicos,
  instalaciones, renovables). Puedes elegir coma o punto decimal y **imprimirla o guardarla en PDF**.
- Es una ayuda para teclear: la app no abre ni controla CE3X.

### Generar el proyecto `.cex` (experimental)

En la misma ficha, **Generar el proyecto .cex** crea un fichero que se abre en CE3X con parte de los datos ya puestos:

1. **Una vez:** en CE3X crea un proyecto nuevo, rellena **solo tus datos de técnico** y guárdalo (por ejemplo
   `plantilla.cex`).
2. En cada expediente, elige esa plantilla. La app te enseña qué campos va a rellenar (dirección, municipio,
   referencia catastral, zona climática, superficie, altura, plantas, ACS, masa, ventilación, año…) y cuáles tendrás
   que completar en CE3X. Pulsa **Descargar** y ábrelo en CE3X.
3. Revisa todas las pantallas y **califica en CE3X**: el cálculo y la comprobación siguen siendo tuyos.

La envolvente y las instalaciones se copian del catálogo de soluciones (ver «Generar el .cex desde la toma de
datos»). La app rechaza una plantilla que ya tenga elementos, para no arrastrar los de otro edificio. Solo se ha
comprobado con **CE3X v3.1 Residencial**.

Cómo es el formato (para desarrolladores): un `.cex` es una sucesión de *pickles* de Python 2 (protocolo 0) con
saltos de línea CRLF. `src/lib/cex/pickle.ts` los lee y escribe sin ejecutar nada, conservando la diferencia entre
`str` y `unicode`, enteros y reales, y qué textos eran el mismo objeto (Python solo escribe una referencia «gN»
cuando es el mismo objeto): un proyecto real se vuelve a escribir **idéntico byte a byte**. El último bloque es una
huella del propio CE3X que la app no toca ni recalcula.

## Checklist previo a la firma

- 12 puntos de revisión (referencia catastral, dirección, tipo, superficie, Anexo I, fechas, calificación,
  recomendaciones, fichero de cálculo adjunto, PDF adjunto, datos del técnico).
- Junto a cada punto, una **comprobación de apoyo** (✓ coincide / ⚠ revisar) calculada con el PDF importado. Es solo
  una ayuda: **ningún punto se marca solo**. Si marcas uno que señala una diferencia, la app te pide confirmarlo y lo
  anota.
- Sin los 12 puntos marcados no se puede pasar a «Certificado firmado». Al firmar, las calificaciones se toman de
  los resultados confirmados (no se vuelven a teclear).
- Si devuelves el expediente a «Datos introducidos», el checklist se reinicia.

## Paquete para el registro (Asturias)

- Con el certificado firmado, **Paquete para el registro** reúne lo que pide el trámite RECE0016T01 de la sede
  electrónica del Principado:
  - el certificado firmado en PDF;
  - el XML del programa;
  - el justificante de la tasa (modelo 046);
  - la declaración responsable, solo si no estás inscrito en el Registro de técnicos;
  - el informe de conformidad, si ha habido control externo.
- Además mete el `.cex` y el XML juntos en un comprimido para tu archivo.
- Antes de montar el ZIP comprueba que cada fichero no ha cambiado desde que se subió (huella SHA-256), que el PDF
  tiene una firma electrónica (no valida la firma: eso lo hace la sede) y que el XML tiene la estructura oficial.
- Descarga un ZIP con un `LEEME.txt` (índice y huellas). **No envía nada**: lo subes tú en la sede y después marcas
  el expediente como «Registrado».

## Panel

- Al entrar verás el **panel**:
  - expedientes por estado;
  - pendientes;
  - próximas visitas;
  - vencimientos de los próximos 12 meses (buena ocasión para ofrecer la renovación);
  - certificados firmados por mes y por año;
  - calificaciones más frecuentes.

## Documentos

- En la ficha y en el checklist puedes subir el `.cex`, el PDF, el XML, fotos… (máximo 25 MB por fichero). Se
  guardan en el almacén privado de Supabase; solo tú puedes verlos.
- Los documentos de un expediente **registrado** ya no se pueden borrar.

---

# Copias de seguridad

El plan gratuito de Supabase **no incluye copias de seguridad descargables**. Por eso el panel tiene el botón
**«Descargar copia completa»**. Descarga un ZIP con:
- un listado para Excel;
- todas las tablas en JSON;
- todos los documentos de cada expediente.

Si pasa una semana sin copia, el panel te avisa. **Guárdala en un sitio seguro** (contiene datos personales): tu
ordenador y, a ser posible, un disco externo.

Si prefieres hacerlo a mano desde Supabase:

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
- **Visita grabada:** al procesarla, el audio va a **Cloudflare (Workers AI)** para pasarlo a texto, y el texto, las
  fotos y los PDF a **Anthropic (Claude)** para interpretarlos. Son encargados del tratamiento: acepta sus DPA
  (Cloudflare ya lo tienes por el CRM; Anthropic: condiciones comerciales y DPA en su consola) y añádelos al registro
  de actividades. No grabes nombres, DNI ni teléfonos y evita fotos con personas o documentos personales. El audio y
  las fotos se quedan en el móvil hasta que los borras; en Supabase solo se guarda la transcripción y la propuesta.

---

# Para desarrolladores

```bash
npm install
cp .env.ejemplo .env.local     # y rellenar las variables
npm run dev                    # http://localhost:5173
npm test                       # pruebas de validaciones y toma de datos
npm run typecheck
npm run build                  # genera dist/ (lo que publica Cloudflare)
npm run cf:dev                 # prueba dist/ en local tal como lo sirve Cloudflare
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
  lib/cex/        lectura y escritura del .cex de CE3X y catálogo de soluciones
worker/           /api del Worker: transcripción (Workers AI), Claude y Catastro
supabase/
  migrations/     esquema y seguridad (RLS) — se ejecutan en el SQL Editor
  tests/          pruebas SQL del flujo de estados y de la seguridad
wrangler.jsonc    publicación en Cloudflare (Worker certi-vertian)
public/_headers   cabeceras de seguridad
```

Principios del diseño:

- **Toda la seguridad está en la base de datos** (RLS): sesión + verificación en dos pasos (`aal2`) + cuenta en
  `tecnicos` + titularidad de la fila. La web no tiene servidor propio ni clave de servicio. El Worker de `/api`
  no lee ni escribe datos: solo pregunta a Supabase, con el token del técnico, si es un técnico verificado.
- **El estado solo cambia con `cambiar_estado()`**, que avanza o retrocede un paso y lo anota en el historial. Un
  `UPDATE` directo del estado, la firma o el registro se rechaza.
- **Los PDF se leen en el navegador** (`src/lib/certificadoPdf.ts`, probado con CE3X v2.3). Lo leído es una
  propuesta que el técnico revisa; lo que no se encuentra se deja vacío.
- **Las validaciones no modifican datos**: devuelven error (no se admite) o aviso (se admite si el técnico lo
  confirma). La clave de cada aviso incluye el valor, así que si el valor cambia hay que volver a confirmarlo.
