# Christian C2 — integración e identidad, lunes 16/11/2026

Guía aplicada: `Fuentes/Christian.md`, apartado **LUNES 16/11**. Rama personal: `christian`. Base sincronizada con `origin/main` en `df761d8` mediante avance rápido, sin conflictos; la referencia local `main` también se actualizó.

## Comprobación previa a C2

- Node.js `v24.15.0`, npm `11.12.1`, PostgreSQL 16 en Docker Desktop, entorno local Windows.
- Se inició Docker Desktop y `docker compose up -d db`. `npx.cmd prisma migrate deploy`: una migración existente, ninguna pendiente. Se regeneró Prisma Client.
- `npm.cmd run lint`: correcto. `npm.cmd test`: **320 pruebas existentes aprobadas** en siete archivos.
- La primera compilación falló en el proceso auxiliar de transformación CSS de Turbopack. Repetir fuera del sandbox produjo el mismo fallo. Se detuvo el servidor y se eliminó exclusivamente la carpeta generada `.next`, verificando que su ruta absoluta perteneciera al proyecto. Con caché limpia, `npm.cmd run build` terminó correctamente, incluida comprobación TypeScript y generación de 41 páginas. No se cambiaron dependencias, configuración ni estilos.
- `auth.integration.ts`: comprobación HTTP/PostgreSQL real de login, cookie HttpOnly/SameSite, hash de sesión, privacidad, panel por rol, sesiones caducadas/revocadas, CSRF y logout. También rechaza combinaciones de roles no permitidas.
- `auth-c1.integration.ts`: registro real con PNG ficticio privado, cuenta pendiente, permisos de identidad, apertura explícita y lectura auditada antes de activar, rollback al fallar auditoría, activaciones concurrentes 200/409, perfil y recuperación. Los fixtures propios se eliminaron al finalizar.

## Entrega del lunes

No fue necesario cambiar las firmas ni las rutas de autenticación: los consumidores integrados ya son compatibles. Se añadieron tres regresiones a `src/tests/auth.test.ts`:

1. Una misma contraseña se verifica contra hashes bcrypt con sales distintas; una misma cédula ficticia produce cifrados distintos y recuperables.
2. Enviar `roles: ["ADMIN_SUBASTAS"]` en login no eleva los permisos del comprador persistido en PostgreSQL.
3. Un reset que vence exactamente en el instante actual es rechazado sin cambiar contraseña ni sesiones.

`src/tests/auth-c2.integration.ts` ejecuta contra HTTP y PostgreSQL:

| Comprobación | Resultado observado |
|---|---|
| `/panel`, `/perfil`, `/admin/usuarios` sin cookie | Redirección al login, incluida la redirección transmitida por streaming de Next.js |
| `/api/auth/me`, `/api/admin/users` sin cookie | 401 |
| `/api/admin/users` con comprador / admin | 403 / 200 |
| `/admin/usuarios` con comprador | Acceso restringido renderizado en servidor, sin tabla administrativa |
| `/api/auth/me` autenticado | Solo `id`, `nombreCompleto`, `email`, `roles`, `status` |
| JSON y SSR autenticados | Sin `passwordHash`, `cedulaCifrada`, `tokenHash`, contraseña ni token de sesión |
| Artículos y verificación: lectura sin sesión / con comprador | 401 / 403 |
| Creación de subasta sin sesión / con comprador | 401 / 403, antes de procesar datos comerciales |
| Ofertas propias sin sesión / con comprador | 401 / 200 |
| `requireRole(request, ['ADMIN_SUBASTAS'])` | Usa roles actuales de PostgreSQL; 403 después de retirar el rol |
| Handshake importado de Kevin | Resuelve `pf_session` mediante el helper compartido; sin cookie rechaza `UNAUTHORIZED` |
| Cambio de admin a comprador manteniendo cookie | API y SSR administrativos dejan de autorizar |
| Suspensión manteniendo cookie | `/api/auth/me` devuelve 401 y `/perfil` redirige al login |

Las modificaciones de rol/estado se limitan a cuentas ficticias creadas por el propio script en la base local. No se añadió una ruta de cambio de roles ni se modificaron cuentas demo.

También se repitió `auth-c1.integration.ts` con `C1_IDENTITY_FORMAT=pdf`: sin abrir PDF la activación devuelve conflicto; abrirlo entrega sus bytes por el acceso protegido y genera una consulta auditada. Reset de 10 minutos, expiración, dos consumos concurrentes, rechazo de reutilización e invalidación de todas las sesiones aprobados sobre PostgreSQL.

## Verificación final

- `npm.cmd run lint`: correcto.
- `npm.cmd test`: **323 pruebas aprobadas**, siete archivos (320 previas y tres nuevas).
- `npm.cmd run build`: correcto, TypeScript y 41 páginas generadas.
- Integraciones C0, C1 con PNG, C1 con PDF y C2: aprobadas con PostgreSQL real; limpieza de sus fixtures completada.
- En Windows hay que detener `npm.cmd run dev` antes de `npm.cmd run build`: `prisma generate` no puede sustituir la DLL que tiene cargada el servidor. En esta ejecución también fue necesario limpiar `.next` para retirar artefactos bloqueados de la compilación anterior. Se conservó toda la configuración del repositorio.

## Reproducción

Con Docker y `.env` local configurados:

```powershell
docker compose up -d db
npx.cmd prisma migrate deploy
npm.cmd run dev
# En otra terminal:
node --env-file=.env --import tsx src/tests/auth.integration.ts
node --env-file=.env --import tsx src/tests/auth-c1.integration.ts
$env:C1_IDENTITY_FORMAT = 'pdf'
node --env-file=.env --import tsx src/tests/auth-c1.integration.ts
Remove-Item Env:C1_IDENTITY_FORMAT
node --env-file=.env --import tsx src/tests/auth-c2.integration.ts
```

Para capturas, añadir `--evidence` al último comando: conserva una cuenta compradora ficticia hasta pulsar Enter en esa terminal; después elimina cuentas, sesiones, roles y auditorías propios. No interrumpir la terminal mientras se toman las capturas. Las pruebas no requieren ejecutar el seed sobre las cuentas existentes.

## Evidencia visual y alcance

- `christian-roles.png`: navegador autenticado con comprador ficticio, navegación directa a `/admin/usuarios`, mensaje «Acceso restringido».
- `christian-recuperacion.png`: respuesta genérica del formulario de recuperación para un correo ficticio. El uso único y la caducidad se demuestran mediante las pruebas, no por esta captura.
- No se modificaron archivos de Kevin, Leonel, Antony o Jonathan, modelos, rutas, estilos, dependencias ni nombres de cookies.
- La integración del handshake comprueba su función real con PostgreSQL; no constituye una prueba de transporte WebSocket, WSS ni una demostración de chat con dos clientes. Las pruebas globales incluyen los módulos comerciales, pero esta evidencia C2 no atribuye un recorrido comercial completo con base real.
- Uso de IA: Codex apoyó la revisión de contratos, implementación de pruebas, ejecución local y captura de evidencia. Los resultados anteriores proceden de comandos ejecutados; la explicación académica y revisión humana corresponden al responsable.
