import { redirect } from 'next/navigation'

// El historial vive ahora dentro de /resumen (misma lista, con filtros y
// borrar, más el resumen por persona). Se mantiene la URL vieja por si
// quedó algún acceso directo guardado.
export default function HistorialRedirect() {
  redirect('/resumen')
}
