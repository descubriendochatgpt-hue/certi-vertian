#!/usr/bin/env python3
"""Campaña de correo a inmobiliarias y empresas de reformas (Vertian Solutions).

Solo usa la biblioteca estándar de Python. Uso:

  python3 campana.py vista-previa        # genera salida/*.html para revisar cada correo
  python3 campana.py borradores          # guarda un borrador por lead en Gmail
  python3 campana.py enviar --pausa 90   # envía de verdad, con pausa entre correos

Para «borradores» y «enviar» hacen falta dos variables de entorno (o un fichero
.env en esta carpeta):

  GMAIL_USUARIO=vertialmail@gmail.com
  GMAIL_CLAVE_APP=xxxx xxxx xxxx xxxx    # contraseña de aplicación de Google

Los leads ya tratados se apuntan en enviados.csv y no se repiten.
"""

import argparse
import csv
import html
import imaplib
import os
import re
import smtplib
import sys
import time
import unicodedata
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

CARPETA = Path(__file__).resolve().parent
REGISTRO = CARPETA / "enviados.csv"


def cargar_env():
    fichero = CARPETA / ".env"
    if fichero.exists():
        for linea in fichero.read_text(encoding="utf-8").splitlines():
            if "=" in linea and not linea.lstrip().startswith("#"):
                clave, valor = linea.split("=", 1)
                os.environ.setdefault(clave.strip(), valor.strip())


def cargar_config():
    import json

    return json.loads((CARPETA / "config.json").read_text(encoding="utf-8"))


def cargar_leads():
    with open(CARPETA / "leads.csv", newline="", encoding="utf-8") as f:
        leads = [fila for fila in csv.DictReader(f) if fila.get("email", "").strip()]
    for lead in leads:
        lead["email"] = lead["email"].strip().lower()
        lead["tipo"] = lead.get("tipo", "").strip().lower() or "inmobiliaria"
        if not (CARPETA / "sectores" / f"{lead['tipo']}.html").exists():
            sys.exit(f"Tipo desconocido «{lead['tipo']}» para {lead['empresa']} (usa inmobiliaria o reformas)")
    return leads


def ya_tratados():
    if not REGISTRO.exists():
        return set()
    with open(REGISTRO, newline="", encoding="utf-8") as f:
        return {fila["email"] for fila in csv.DictReader(f)}


def apuntar(lead, modo):
    nuevo = not REGISTRO.exists()
    with open(REGISTRO, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if nuevo:
            w.writerow(["fecha", "modo", "empresa", "email"])
        w.writerow([datetime.now().isoformat(timespec="seconds"), modo, lead["empresa"], lead["email"]])


def rellenar(texto, datos):
    return re.sub(r"\{\{(\w+)\}\}", lambda m: datos.get(m.group(1), m.group(0)), texto)


def componer(lead, config):
    esc = {k: html.escape(str(v)) for k, v in config.items()}
    datos = {
        **esc,
        "empresa": html.escape(lead["empresa"].strip()),
        "firma_telefono_enlace": "+34" + re.sub(r"\D", "", config["firma_telefono"]),
        "parrafo_sector": (CARPETA / "sectores" / f"{lead['tipo']}.html").read_text(encoding="utf-8").strip(),
        "personalizacion": f"<p>{html.escape(lead['personalizacion'].strip())}</p>"
        if lead.get("personalizacion", "").strip()
        else "",
    }
    cuerpo_html = rellenar((CARPETA / "plantilla.html").read_text(encoding="utf-8"), datos)
    asunto = rellenar(config["asunto"], {"empresa": lead["empresa"].strip()})
    return asunto, cuerpo_html


def html_a_texto(cuerpo_html):
    t = re.sub(r"<img[^>]*>", "", cuerpo_html)
    t = re.sub(r"<a [^>]*href=\"(?:mailto:|tel:)[^\"]*\"[^>]*>(.*?)</a>", r"\1", t, flags=re.S)
    t = re.sub(r"<a [^>]*href=\"([^\"]+)\"[^>]*>.*?</a>", r"\1", t, flags=re.S)
    t = re.sub(r"<br>\n?", "\n", t)
    t = re.sub(r"</p>|</tr>", "\n\n", t)
    t = html.unescape(re.sub(r"<[^>]+>", "", t))
    return re.sub(r"\n\s*\n+", "\n\n", "\n".join(l.strip() for l in t.splitlines())).strip() + "\n"


def mensaje(lead, config, usuario):
    asunto, cuerpo_html = componer(lead, config)
    msg = EmailMessage()
    msg["Subject"] = asunto
    msg["From"] = formataddr((config["remitente_nombre"], usuario))
    msg["To"] = lead["email"]
    if config.get("responder_a"):
        msg["Reply-To"] = config["responder_a"]
    msg["Message-ID"] = make_msgid(domain=usuario.split("@")[-1])
    msg.set_content(html_a_texto(cuerpo_html))
    msg.add_alternative(cuerpo_html, subtype="html")
    msg.get_payload()[1].add_related(
        (CARPETA / "logo-vertian.png").read_bytes(), "image", "png", cid="<logo-vertian>", filename="logo-vertian.png"
    )
    return msg


def carpeta_borradores(imap):
    _, carpetas = imap.list()
    for linea in carpetas:
        texto = linea.decode()
        if "\\Drafts" in texto:
            return texto.rsplit(' "/" ', 1)[-1]
    return '"[Gmail]/Drafts"'


def credenciales():
    usuario, clave = os.environ.get("GMAIL_USUARIO"), os.environ.get("GMAIL_CLAVE_APP")
    if not usuario or not clave:
        sys.exit("Faltan GMAIL_USUARIO y GMAIL_CLAVE_APP (en el entorno o en campana-leads/.env)")
    return usuario, clave.replace(" ", "")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("modo", choices=["vista-previa", "borradores", "enviar"])
    p.add_argument("--pausa", type=int, default=90, help="segundos entre envíos (modo enviar)")
    p.add_argument("--limite", type=int, default=0, help="tratar como mucho N leads en esta tanda")
    args = p.parse_args()

    cargar_env()
    config = cargar_config()
    leads = cargar_leads()

    if args.modo == "vista-previa":
        salida = CARPETA / "salida"
        salida.mkdir(exist_ok=True)
        logo = (CARPETA / "logo-vertian.png").as_uri()
        for i, lead in enumerate(leads, 1):
            asunto, cuerpo = componer(lead, config)
            nombre = unicodedata.normalize("NFKD", lead["empresa"].lower()).encode("ascii", "ignore").decode()
            nombre = re.sub(r"[^a-z0-9]+", "-", nombre).strip("-")
            (salida / f"{i:03d}-{nombre}.html").write_text(
                f"<!doctype html><meta charset=utf-8><title>{html.escape(asunto)}</title>"
                f"<p><b>Para:</b> {lead['email']}<br><b>Asunto:</b> {html.escape(asunto)}</p><hr>"
                + cuerpo.replace("cid:logo-vertian", logo),
                encoding="utf-8",
            )
        print(f"{len(leads)} correos generados en {salida}")
        return

    pendientes = [l for l in leads if l["email"] not in ya_tratados()]
    if args.limite:
        pendientes = pendientes[: args.limite]
    if not pendientes:
        print("No hay leads pendientes (todos están en enviados.csv).")
        return
    usuario, clave = credenciales()

    if args.modo == "borradores":
        with imaplib.IMAP4_SSL("imap.gmail.com") as imap:
            imap.login(usuario, clave)
            carpeta = carpeta_borradores(imap)
            for lead in pendientes:
                imap.append(carpeta, "\\Draft", None, mensaje(lead, config, usuario).as_bytes())
                apuntar(lead, "borrador")
                print(f"Borrador creado: {lead['empresa']} <{lead['email']}>")
        return

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(usuario, clave)
        for i, lead in enumerate(pendientes):
            if i:
                time.sleep(args.pausa)
            smtp.send_message(mensaje(lead, config, usuario))
            apuntar(lead, "enviado")
            print(f"Enviado: {lead['empresa']} <{lead['email']}>")


if __name__ == "__main__":
    main()
