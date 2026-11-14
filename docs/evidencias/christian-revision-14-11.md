# Christian — revisión de C0 del sábado 14/11/2026

Rama local `christian`; base `4ffbb6f`. Esta revisión no incluye commit, push, PR ni merge.
Alcance: apartado **SÁBADO 14/11** y contratos comunes de `Fuentes/Christian.md`.

## Error corregido y archivos cambiados

| Archivo | Cambio justificado |
| --- | --- |
| `src/app/panel/page.tsx` | Una cuenta ACTIVA con AUDITOR y otros roles mostraba funciones comerciales. Ahora AUDITOR tiene prioridad **solo en la presentación de este panel** y ve exclusivamente `/auditoria`, además del cierre de sesión. Fundamento: punto 8 del sábado, «AUDITOR solo ve enlace auditoría». No se cambió ninguna regla general de autorización. |
| `src/tests/auth.test.ts` | Refuerzo de caducidad exacta, revocación, actualización de roles/estado, SSR, origen, privacidad y atributos de cookie. El hash esperado se calcula de forma independiente del helper probado. |
| `src/tests/auth.integration.ts` | Prueba real de `/panel` sin sesión, inválida, vencida y revocada; inspección de enlaces visibles de cuatro perfiles; privacidad, login/logout y limpieza de sus fixtures. |
| `docs/evidencias/*` | Capturas, salidas de comprobaciones y este informe, solicitados por la guía y la revisión. |

No se encontró otro error funcional confirmado en los helpers revisados; se conservaron sin modificaciones. Se corrigió un error de tipado `HeadersInit` introducido al ampliar un caso de prueba; la comprobación final de TypeScript pasa.

## Contratos verificados

| Export | Resultado |
| --- | --- |
| `getUserFromCookieHeader(cookieHeader?: string): Promise<SessionUser \| null>` | Lee `pf_session`; consulta DB por SHA-256; devuelve null sin cookie válida, si la sesión no existe/revocó/venció o si la cuenta está SUSPENDIDA/CERRADA. Proyecta solo `id,nombreCompleto,email,status,roles`. No memoriza roles/estado entre consultas. |
| `requireSession(request: Request)` | Devuelve usuario autenticado, incluida cuenta PENDIENTE; en caso contrario lanza `AuthError` 401. |
| `requireActive(request: Request)` | Exige sesión y estado ACTIVA; PENDIENTE recibe `AuthError` 403. |
| `requireRole(request: Request, roles: Role[])` | Exige cuenta ACTIVA y al menos un rol autorizado; rol ajeno/lista vacía recibe 403. No se agregó una prohibición global a usuarios con varios roles. |
| `hasRole` / `canAccessResource` | Membresía de rol / propiedad autenticada; no hay bypass de administrador para propiedad ajena. |
| `assertTrustedOrigin(request: Request)` | Exige Origin exactamente igual al origen de `request.url`; rechaza Origin ausente, `null`, diferente o `Sec-Fetch-Site: cross-site`. No usa `X-Forwarded-Host/Proto` para aceptar un origen. Login y logout lo ejecutan antes de mutar datos. El host/protocolo canónicos del despliegue y su proxy siguen siendo configuración compartida. |
| `getCurrentUser` / `requireCurrentUser` | Usa `await cookies()` y el helper común; redirige a `/iniciar-sesion` cuando la sesión es inválida. `/panel` conserva Suspense, necesario con Cache Components. |
| `encryptCedula(text: string): string` / `decryptCedula(ciphertext: string): string` | Solo backend, AES-256-GCM con clave de 32 bytes de `ENCRYPTION_KEY_HEX`, IV aleatorio de 12 bytes, formato hexadecimal `iv:ciphertext:tag`; valida autenticidad y rechaza manipulación/clave inválida. No se exponen por endpoints. |

Sesiones: token aleatorio de 32 bytes, solo su hash SHA-256 en PostgreSQL y caducidad de **604800000 ms (7 días)**. Cookie `pf_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Expires`; `Secure` únicamente en producción. El token sin hash se envía exclusivamente mediante Set-Cookie, no en JSON ni HTML. Login y `/me` devuelven únicamente el perfil propio que permite el contrato; no incluyen contraseña, hashes, cédula, teléfono o dirección. Los errores HTTP no devuelven detalles internos de DB.

## Pruebas y resultados finales

| Comprobación | Resultado | Salida |
| --- | --- | --- |
| `npm run lint` | PASS, salida 0, sin errores ni advertencias | [log](christian-lint.log) |
| `npm test` | PASS, **27 pruebas**: 25 de auth y 2 del bootstrap existente; 2 archivos aprobados | [log](christian-tests.log) |
| `npx tsc --noEmit` | PASS, salida 0 | [log](christian-typescript.log) |
| Integración PostgreSQL + servidor de desarrollo | PASS, cuatro perfiles, redirecciones reales y cero fixtures residuales | [log](christian-integracion.log) |
| Navegador Chrome | PASS: login pendiente, panel sin operaciones, logout; login de auditor con varios roles, solo auditoría y logout | Capturas abajo |
| Limpieza de cuentas de capturas | PASS: cero cuentas, sesiones y roles de esas dos cuentas; metadata temporal eliminada | [log](christian-limpieza-capturas.log) |
| `npm run build` (Turbopack) | **FAIL, salida 1**, worker de CSS termina antes de la conexión | [log](christian-build-turbopack.log) |
| `npx next build --debug-build-paths=src/app/page.tsx` | **FAIL, salida 1**, mismo error en la página de inicio compartida, sin incluir las rutas de C0 | [log](christian-turbopack-solo-inicio.log) |
| `npx next build --webpack` | **PASS, salida 0**, compilación, TypeScript y generación de las 10 páginas completadas. No sustituye el build habitual | [log](christian-build-webpack.log) |

Las pruebas HTTP con DB simulada ejecutan los handlers y helpers reales; solo se simula el acceso a Prisma y, para las pruebas SSR aisladas, las cookies de Next. Las pruebas de integración usan PostgreSQL y solicitudes HTTP reales, sin mocks. Comprueban:

- `/panel` sin cookie o con cookie malformada redirige; con sesión vencida o revocada también. Next puede enviar una respuesta 200 por streaming y el **meta refresh** documentado, o una redirección HTTP; se valida el destino efectivo en ambos formatos, no una simple mención de la URL.
- Comprador/vendedor ACTIVA ve sus tres enlaces; PENDIENTE entra y ve aviso sin enlaces; AUDITOR puro y AUDITOR combinado con otros cuatro roles solo ven `/auditoria`.
- Los guards permiten los roles reales de una cuenta ACTIVA y rechazan los ajenos. PENDIENTE no pasa `requireActive` ni `requireRole`.
- Login incorrecto/origen ajeno no entrega acceso; cookie correcta, hash independiente, TTL de 7 días, perfil JSON mínimo y HTML sin secretos. La prueba unitaria cubre también ausencia/null de Origin y `Secure` en producción.
- Caducidad real modificando exclusivamente las sesiones ficticias de esta ejecución; restauración de su expiración, logout y rechazo posterior del token revocado.
- Limpieza en `finally`, transacción para borrar únicamente las cuentas identificadas por sus correos únicos aleatorios de este run, sus roles y sesiones; conteos finales iguales a cero. Nunca se ejecuta el seed ni se buscan/borran cuentas ajenas por un prefijo genérico.

### Ejecución separada de integración

Requisitos locales: dependencias instaladas, `.env` válido, PostgreSQL de Docker saludable y migración **J1** ya aplicada por el flujo acordado. No ejecutar el seed provisional de Jonathan. No publicar `.env` ni los valores de sus claves.

Terminal 1, desde el repositorio:

```powershell
npm run dev
```

Terminal 2, desde el mismo repositorio:

```powershell
# Solo este proceso de pruebas usa NODE_ENV=test para evitar logs de consultas.
# El servidor de la terminal 1 debe seguir en desarrollo HTTP en localhost:3000.
$env:NODE_ENV = 'test'
node --env-file=.env --import tsx src/tests/auth.integration.ts
Remove-Item Env:NODE_ENV
```

`npm test` no ejecuta `auth.integration.ts` (no tiene sufijo `.test`/`.spec`); no necesita PostgreSQL ni servidor. Se conserva `vitest.config.mts` **sin cambios**: resuelve `@/` al directorio `src`, usa entorno Node, restaura mocks/variables de entorno. Es compatible con Vitest 5.1.0 / Vite 8.3.8 instalados. Vite no activa `resolve.tsconfigPaths` por defecto; el alias explícito permite probar los imports contractuales sin cambiar scripts ni dependencias.

## Diagnóstico de Turbopack y límites de la conclusión

La causa inmediata comprobada es un fallo al arrancar o comunicar el proceso Node del pipeline compartido de CSS (`globals.css.css` → `evaluate_webpack_loader`): el pool de Turbopack observa que termina con código 0 antes de conectar. No es un error de tipo ni una excepción del módulo auth. Se reproduce con el build completo y compilando únicamente `src/app/page.tsx`, que consume el layout/CSS compartidos.

Se inspeccionó la regla existente `*.css` con `@tailwindcss/turbopack` y `as: '*.css'`: coincide con la documentación incluida en el paquete instalado. **No se demostró que esa regla esté mal configurada.** También se arrancó, sin editarlo, el worker generado bajo un pequeño listener local de diagnóstico: produjo `IPC_CONNECTED`, `IPC_READY_BYTES 4`, `WORKER_EXIT 0`. Esto muestra que el worker puede conectar al arrancarlo desde Node por separado; no demuestra por qué falla dentro del pool de Turbopack.

Por tanto, se aisló el fallo al compilador/entorno de CSS compartido, pero **la causa última del fallo dentro del pool queda sin determinar**. Hay [reportes del mismo síntoma en el repositorio oficial de Next.js](https://github.com/vercel/next.js/discussions/94693); no constituyen un diagnóstico de este equipo ni una solución comprobada. Jonathan debe coordinar la investigación de configuración/entorno con Leonel si afecta a estilos. No se editaron `next.config.ts`, `package.json`, `package-lock.json`, `globals.css`, layout ni archivos de otros integrantes. Webpack se informa por separado y no convierte `npm run build` en aprobado.

## Capturas y alcance de cada evidencia

- [christian-registro.png](christian-registro.png): pantalla completa con el registro deshabilitado y el aviso de dependencia de J2. **No prueba un alta completada**.
- [christian-login.png](christian-login.png): formulario de acceso con una cuenta ficticia temporal y contraseña oculta; el ingreso posterior se verificó en navegador.
- [christian-panel-pendiente.png](christian-panel-pendiente.png): sesión real PENDIENTE, aviso y ausencia de operaciones comerciales.
- [christian-panel-auditor.png](christian-panel-auditor.png): cuenta real de prueba con AUDITOR+COMPRADOR+VENDEDOR+ADMIN_SUBASTAS; solo auditoría visible, además de cerrar sesión.

Las dos cuentas de las capturas se eliminaron después del logout; no contienen datos personales verdaderos. Las capturas de login/registro conservan los nombres que exige el punto 9 del sábado. No se fabricó una captura de registro exitoso.

## Cierre de alcance del día

**C0 independiente del 14/11: implementado y probado** (helpers, login/logout/me y panel, incluidos sus ajustes de autorización visual). La aceptación del **build habitual del proyecto sigue pendiente** por el fallo compartido de Turbopack.

Pendientes ajenos a esta revisión:

- **Jonathan, J2 (15/11):** `saveValidatedUpload`, archivos privados y sustitución de `encryptCedulaPlaceholder` del seed por `encryptCedula` de C0. No se tocó su seed.
- **Christian después de J2:** registro definitivo con documento y prueba/captura del alta PENDIENTE; no se implementa en esta revisión, por petición expresa y excepción de la guía.
- **Leonel, L0:** componentes visuales y navegación compartidos; por ahora se mantienen las clases `.pf-*` de J0 sin crear estilos paralelos.
- Recuperación, perfil, activación y auditoría de autenticación corresponden al 15/11 y no se adelantaron.

Codex asistió en esta corrección, pruebas y evidencias. El README compartido de Jonathan no fue modificado; este informe delimita lo comprobado y lo pendiente.
