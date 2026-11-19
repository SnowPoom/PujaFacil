# Inicio y acceso a PujaFácil

PujaFácil se abre en el navegador. VS Code se utiliza para abrir la carpeta del proyecto y ejecutar el servidor; no necesitas Visual Studio.

## Arranque diario en este equipo

1. Abre **Docker Desktop** y espera a que el motor esté en ejecución.
2. Abre **Visual Studio Code** y selecciona Archivo → Abrir carpeta → `PujaFacil` (la carpeta que contiene `package.json`).
3. En VS Code abre Terminal → Nueva terminal. Ejecuta los comandos, uno por uno:

```powershell
docker compose up -d db
npm.cmd run dev
```

4. Conserva abierta la terminal del servidor. Cuando muestre `Escuchando`, abre **http://127.0.0.1:3000** en Chrome, Edge o Firefox. La primera visita a una pantalla puede tardar mientras Next la compila.
5. Pulsa **Iniciar sesión** e ingresa con una cuenta de la tabla siguiente.

Node.js 24 y las dependencias ya están instalados en este equipo. Si faltara `node_modules`, ejecuta `npm.cmd ci` antes del arranque. La base local ya está poblada: para entrar normalmente no necesitas migraciones ni volver a cargar datos.

## Cuentas disponibles

La contraseña común es el valor de **`DEMO_PASSWORD`** en el archivo **`.env`**, ubicado en la raíz del proyecto. Ábrelo desde el explorador de VS Code y copia únicamente el texto de esa variable, sin las comillas. La contraseña no se encuentra en el código ni en `package.json`.

| Cuenta | Correo | Qué permite demostrar |
|---|---|---|
| Administración | `admin@pujafacil.test` | Revisar cuentas, asignar verificadores, programar, activar y suspender subastas |
| Verificación | `verificador@pujafacil.test` | Consultar expedientes asignados y aprobar, rechazar o solicitar correcciones |
| Segunda verificación | `verificador2@pujafacil.test` | Otro expediente asignado para mostrar separación de trabajo |
| Venta | `vendedor@pujafacil.test` | Artículos, fotos, edición, envío a revisión, observaciones y mis subastas |
| Compra 1 | `comprador1@pujafacil.test` | Ofertas, historial, chat y notificaciones |
| Compra 2 | `comprador2@pujafacil.test` | Segunda sesión para chat y pujas en vivo |
| Compra y venta | `comerciante@pujafacil.test` | Menú con ambos perfiles comerciales |
| Auditoría | `auditor@pujafacil.test` | Consulta paginada y filtros de eventos |
| Pendiente | `pendiente@pujafacil.test` | Estado pendiente y revisión administrativa del documento |

Las cuentas son sintéticas. La ubicación y el comportamiento del seed se describen en `prisma/seed.ts`. En una instalación nueva, `npm.cmd run db:seed` crea estas cuentas usando la contraseña local. Si una cuenta ya existe, el seed conserva su contraseña y estado.

## Recorrido sugerido

- Comprueba el catálogo y sus filtros como visitante.
- Como vendedor, abre Mis artículos y busca el artículo que requiere correcciones. Sus observaciones aparecen en la ficha. Hay borradores propios para crear, editar y demostrar la eliminación con confirmación.
- Como administrador, abre Verificaciones para asignar expedientes y Subastas para programar una pieza aprobada. Las fechas se introducen en hora de Ecuador continental.
- Como verificador, abre Verificación y resuelve un expediente asignado.
- Para dos compradores simultáneos, usa una ventana normal y una ventana de incógnito, o dos navegadores distintos. Dos pestañas normales comparten la misma sesión. Entra con comprador1 en una ventana y comprador2 en la otra, abre la misma subasta activa y el mismo chat.
- Para mostrar un cierre durante la exposición, programa una subasta nueva con apertura anterior a la hora actual y cierre unos minutos después; actívala desde Administración. El servidor cierra y adjudica por su reloj, sin modificar la base manualmente.
- El sistema implementa el alcance del primer bimestre hasta adjudicación. Los pagos y la entrega no están implementados en esta etapa.

## Recuperación de contraseña

En **Recuperar contraseña**, solicita el enlace para una cuenta existente. Regresa a la terminal donde corre `npm.cmd run dev`: aparecerá una línea `[auth] Recuperación:`. Copia la URL completa al navegador. Tiene 10 minutos de vigencia y un solo uso. Al restablecer la clave, las sesiones anteriores se cierran. Si cambias la contraseña de una cuenta, el valor de `DEMO_PASSWORD` deja de ser su contraseña; conserva la nueva que elegiste.

No se envía correo real, conforme a la simulación admitida por la materia. Para producción local sin SMTP se habilita la salida por consola con `PASSWORD_RESET_DELIVERY=console` en `.env`.

## Si no abre

- Revisa que Docker Desktop siga activo y que `docker compose ps` muestre `db` saludable.
- Revisa que la terminal del servidor no se haya cerrado y abre la dirección exacta **http://127.0.0.1:3000**.
- Si el puerto está ocupado por otra instancia del proyecto, detén esa instancia con Ctrl+C en su propia terminal antes de volver a arrancar.
- Conserva el `.env` actual y su clave de cifrado. No lo reemplaces con la plantilla: las cuentas ya cargadas dependen de esa configuración.

## Detener la aplicación

Pulsa **Ctrl+C** en la terminal del servidor. Puedes dejar PostgreSQL activo o detenerlo después con `docker compose stop db`; los datos permanecen guardados. No uses `docker compose down -v`, porque elimina el volumen de datos.
