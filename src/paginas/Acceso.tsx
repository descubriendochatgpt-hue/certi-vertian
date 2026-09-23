import { type FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';

function destino(estado: unknown): string {
  const d = (estado as { desde?: string } | null)?.desde;
  return d && d.startsWith('/') && !d.startsWith('/acceso') ? d : '/';
}

export function Acceso() {
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave });
    setEnviando(false);
    if (error) {
      setError(/invalid/i.test(error.message) ? 'Email o contraseña incorrectos.' : error.message);
      return;
    }
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.nextLevel === 'aal2') navegar('/acceso/verificar', { replace: true, state: ubicacion.state });
    else navegar('/acceso/activar-2fa', { replace: true });
  }

  return (
    <main className="pagina estrecha">
      <h1>Certificados energéticos</h1>
      <p className="suave">Herramienta de apoyo administrativo. Acceso solo para el técnico.</p>
      <form onSubmit={entrar} className="formulario">
        <label>Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Contraseña
          <input type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
        {error && <div className="caja error">{error}</div>}
        <button type="submit" className="principal" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  );
}

/** Segundo paso del acceso: el código de 6 cifras de la app de autenticación. */
export function Verificar2fa() {
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function verificar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    const { data: factores, error: e1 } = await supabase.auth.mfa.listFactors();
    const factor = factores?.totp[0];
    if (e1 || !factor) {
      setEnviando(false);
      setError(e1?.message ?? 'No hay ningún factor de verificación activado.');
      return;
    }
    const { error: e2 } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: codigo.replace(/\s/g, '') });
    setEnviando(false);
    if (e2) {
      setError('Código incorrecto o caducado. Prueba con el que aparece ahora en la app.');
      return;
    }
    navegar(destino(ubicacion.state), { replace: true });
  }

  return (
    <main className="pagina estrecha">
      <h1>Verificación en dos pasos</h1>
      <p>Abre tu app de autenticación (Google Authenticator, Microsoft Authenticator…) y escribe el código de 6 cifras.</p>
      <form onSubmit={verificar} className="formulario">
        <label>Código
          <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus
                 value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        </label>
        {error && <div className="caja error">{error}</div>}
        <button type="submit" className="principal" disabled={enviando}>Verificar</button>
      </form>
      <button className="enlace" onClick={() => supabase.auth.signOut().then(() => navegar('/acceso'))}>Salir</button>
    </main>
  );
}

/** Primer acceso: activar la verificación en dos pasos (obligatoria). */
export function Activar2fa() {
  const navegar = useNavigate();
  const [qr, setQr] = useState('');
  const [secreto, setSecreto] = useState('');
  const [factorId, setFactorId] = useState('');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navegar('/acceso', { replace: true }); return; }
      // Si quedó a medias un alta anterior, se descarta para empezar limpio.
      const { data: factores } = await supabase.auth.mfa.listFactors();
      for (const f of factores?.all ?? []) {
        if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `certi-${Date.now()}` });
      if (error) { setError(error.message); return; }
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecreto(data.totp.secret);
    })();
  }, [navegar]);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    setError('');
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: codigo.replace(/\s/g, '') });
    if (error) { setError('Código incorrecto. Comprueba la hora del móvil y prueba con el código actual.'); return; }
    navegar('/', { replace: true });
  }

  return (
    <main className="pagina estrecha">
      <h1>Activa la verificación en dos pasos</h1>
      <p>Tus expedientes contienen datos personales (NIF, direcciones). Por eso, además de la contraseña, la app pide un código del móvil.</p>
      <ol>
        <li>Instala en el móvil una app de autenticación (Google Authenticator o Microsoft Authenticator).</li>
        <li>En esa app, pulsa «Añadir» y escanea este código QR.</li>
        <li>Escribe abajo el código de 6 cifras que te muestre.</li>
      </ol>
      {qr ? <img src={qr} alt="Código QR para la app de autenticación" className="qr" /> : !error && <p>Preparando…</p>}
      {secreto && <p className="suave">Si no puedes escanearlo, introduce esta clave a mano: <code>{secreto}</code></p>}
      <form onSubmit={confirmar} className="formulario">
        <label>Código de 6 cifras
          <input inputMode="numeric" autoComplete="one-time-code" required value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        </label>
        {error && <div className="caja error">{error}</div>}
        <button type="submit" className="principal" disabled={!factorId}>Activar</button>
      </form>
    </main>
  );
}
