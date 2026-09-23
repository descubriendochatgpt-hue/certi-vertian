export function AvisoLegal() {
  return (
    <main className="pagina estrecha texto">
      <h1>Acerca de / Aviso legal</h1>

      <h2>Qué es esta herramienta</h2>
      <p>
        Es una herramienta de <strong>apoyo administrativo</strong> para el técnico competente que emite certificados de
        eficiencia energética de edificios conforme al Real Decreto 390/2021. Sirve para organizar expedientes, tomar los
        datos de la visita, preparar ficheros y documentación y hacer el seguimiento de vencimientos.
      </p>

      <h2>Qué NO hace</h2>
      <ul>
        <li>No calcula, genera ni firma certificados de eficiencia energética.</li>
        <li>No ejecuta ni controla los programas oficiales de certificación (CE3X, CE3, CERMA, HULC…).</li>
        <li>No presenta nada en la sede electrónica del Principado de Asturias ni en ningún otro registro.</li>
        <li>No cambia el estado de un expediente por su cuenta: cada paso exige una confirmación explícita del técnico.</li>
        <li>No corrige datos por su cuenta: si un valor parece fuera de rango, lo señala y pide confirmación.</li>
      </ul>

      <h2>Responsabilidad del técnico</h2>
      <p>
        El certificado de eficiencia energética es un documento con efectos jurídicos. Debe basarse en una visita real al
        inmueble y en datos tomados y comprobados in situ, y debe ser <strong>verificado y firmado personalmente por el
        técnico competente</strong> antes de su registro. Los avisos y comprobaciones de esta herramienta son una ayuda
        para reducir errores de introducción de datos, no sustituyen el criterio profesional.
      </p>

      <h2>Datos personales</h2>
      <p>
        La herramienta guarda datos personales de propietarios y promotores (nombre, NIF, dirección, contacto). El técnico
        es el responsable de su tratamiento conforme al RGPD. Los datos se alojan en un proyecto de Supabase situado en la
        Unión Europea, accesible solo con contraseña y verificación en dos pasos. Durante la visita, el borrador puede
        guardarse temporalmente en el propio dispositivo hasta que se sube al servidor.
      </p>
    </main>
  );
}
