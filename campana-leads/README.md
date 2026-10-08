# Campaña de leads: certificados energéticos en Gijón

Correo personalizado a inmobiliarias y empresas de reformas de Gijón y alrededores, con enlace a
<https://www.vertiansolutions.es/certificado-energetico-gijon/>.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `leads.csv` | Los leads: `empresa`, `email`, `tipo` (`inmobiliaria` o `reformas`), `personalizacion` (frase opcional para esa empresa) y `fuente` (dónde salió el email) |
| `plantilla.html` | El texto del correo (la parte común) |
| `sectores/inmobiliaria.html`, `sectores/reformas.html` | El párrafo que cambia según el tipo de empresa |
| `config.json` | Firma, teléfono, email de respuesta, asunto y enlace. **Para cambiar el teléfono basta con editar `firma_telefono`.** |
| `logo-vertian.png` | Logo que va dentro del correo, bajo la firma |
| `campana.py` | La automatización (solo necesita Python 3, sin instalar nada) |
| `enviados.csv` | Se crea solo: registro de a quién ya se le ha preparado o enviado el correo, para no repetir |

## Uso

1. **Revisar los correos:** `python3 campana.py vista-previa` genera en `salida/` un HTML por lead para verlo en el navegador.
2. **Preparar la cuenta de Gmail** (una sola vez), en vertialmail@gmail.com:
   - Activa la verificación en dos pasos: <https://myaccount.google.com/security>.
   - Crea una contraseña de aplicación: <https://myaccount.google.com/apppasswords> (nombre: «Campaña Vertian»).
   - Copia `.env.ejemplo` como `.env` y pega la contraseña en `GMAIL_CLAVE_APP`.
3. **Crear borradores:** `python3 campana.py borradores` deja un borrador por lead en Gmail. Los revisas y los envías tú.
4. **(Opcional) Envío automático:** `python3 campana.py enviar --pausa 90 --limite 20` envía de verdad, con 90 s
   entre correos y como mucho 20 por tanda. Mejor pocas tandas al día para no caer en spam.

Los correos salen desde vertialmail@gmail.com con el nombre «Julián Pérez · Vertian Solutions», y las respuestas
van a info@vertiansolutions.es (campo `responder_a` de `config.json`).

Para volver a tratar un lead ya registrado, borra su línea de `enviados.csv`.

## Leads

La lista está en `leads.csv`. Cada email lleva la web de la que salió (columna `fuente`).
