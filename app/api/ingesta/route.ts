import { NextResponse } from 'next/server'
import { registrarGasto } from '@/lib/ingesta'

/**
 * Carga de gastos desde afuera (Google Forms vía Apps Script, atajos de
 * iPhone/Android, lo que sea que pueda hacer un POST). Protegido por
 * INGESTA_TOKEN. Acepta JSON o form-data con:
 *   token        (obligatorio)
 *   texto        "12500 súper" — si viene, manda sobre los campos sueltos
 *   monto, descripcion, categoria, personal, quien ('Mati'/'Vicky'), fecha
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      body = await request.json()
    } else {
      const form = await request.formData()
      body = Object.fromEntries(form.entries())
    }
  } catch {
    return NextResponse.json({ ok: false, mensaje: 'Body inválido.' }, { status: 400 })
  }

  const token = process.env.INGESTA_TOKEN
  if (!token || body.token !== token) {
    return NextResponse.json({ ok: false, mensaje: 'Token inválido.' }, { status: 401 })
  }

  const personal =
    body.personal === true ||
    ['true', 'si', 'sí', 'Sí', 'Si', '1'].includes(String(body.personal ?? '').trim())

  const r = await registrarGasto({
    texto: typeof body.texto === 'string' ? body.texto : undefined,
    monto: body.monto as string | number | undefined,
    descripcion: typeof body.descripcion === 'string' ? body.descripcion : undefined,
    categoria: typeof body.categoria === 'string' ? body.categoria : null,
    personal,
    quienNombre: typeof body.quien === 'string' ? body.quien : null,
    fecha: typeof body.fecha === 'string' ? body.fecha : null,
  })

  return NextResponse.json(r, { status: r.ok ? 200 : 422 })
}
