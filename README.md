# PujaFácil — Casa de Subastas en Línea

Plataforma monolítica de comercio y subastas en tiempo real diseñada para pequeñas y medianas empresas (PYMEs), orientada a la venta transparente, verificación de bienes y ofertas concurrentes. Proyecto desarrollado para el primer bimestre de **Aplicaciones Web Avanzadas** y **Desarrollo de Software Seguro**.

---

## 1. Alcance del Proyecto (1B)

El sistema implementa el ciclo comercial central de una casa de subastas mediante un **monolito único en Next.js**:
- **Registro y Acceso Seguro:** Registro con documento de identidad ficticio, validación en servidor, almacenamiento de contraseñas con hash + sal (`bcryptjs`), sesión mediante cookie `HttpOnly` y recuperación de cuenta con token de un solo uso de caducidad temporal.
- **Catálogo y CRUD de Artículos:** Publicación de artículos por vendedores activos, subida y validación estricta de fotografías/certificados privados, filtros por categoría y búsqueda paginada.
- **Verificación Técnica:** Asignación de artículos a verificadores y evaluación de autenticidad antes de su publicación en subasta.
- **Subastas y Pujas en Tiempo Real:** Gestión de subastas programadas/activas, registro concurrente de ofertas mediante transacción en PostgreSQL y difusión en vivo vía WebSockets (`Socket.IO`).
- **Chat y Presencia:** Sala general y salas de subasta en tiempo real con historial persistido y seudónimos protegidos (`AuctionAlias`).
- **Auditoría:** Registro de eventos del sistema sin filtración de datos de carácter personal (PII).

> **Aviso de Privacidad y Seguridad:** Todos los datos de usuarios, documentos de identidad, cédulas y fotografías utilizados en este repositorio y en las demostraciones son **estrictamente ficticios**.

---

## 2. Stack Tecnológico

- **Entorno de Ejecución:** Node.js 24 LTS
- **Framework Web:** Next.js 16 (App Router, Server Components y Route Handlers)
- **Lenguaje:** TypeScript 5
- **Estilos:** Tailwind CSS 4 con tokens de diseño propios (`.pf-*`)
- **Base de Datos:** PostgreSQL 16
- **ORM:** Prisma ORM 6
- **Tiempo Real:** Socket.IO 4 (integrado en el mismo proceso y puerto HTTP/HTTPS de Node)
- **Validación:** Zod
- **Criptografía y Sesiones:** `bcryptjs`, cifrado simétrico AES-256-GCM y cookies `HttpOnly`
- **Pruebas Automatizadas:** Vitest
- **Contenedores:** Docker y Docker Compose

---



## 4. Requisitos Previos

Antes de ejecutar el proyecto, asegúrate de contar con:
1. **Node.js 24 LTS:** Verifica con `node -v` (ejemplo: `v24.22.x`).
2. **Docker Desktop:** Instalado y en ejecución (el servicio de Docker debe estar activo para levantar la base de datos).
3. **PowerShell en Windows (Opcional):** Si la ejecución de scripts está restringida al ejecutar `npm`, habilítala con:
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
   ```

---

## 5. Guía de Instalación y Ejecución Paso a Paso

Sigue estos pasos para poner en marcha el proyecto localmente:

### Paso 1: Clonar el repositorio
```bash
git clone https://github.com/Jonathan593/PujaFacil.git
cd PujaFacil
```

### Paso 2: Instalar las dependencias
```bash
npm ci
```

### Paso 3: Configurar variables de entorno
Copia la plantilla de variables de entorno y ajusta los valores locales necesarios:
```bash
cp .env.example .env
```
> El archivo `.env` local ya incluye los valores por defecto para conectar a la base de datos de Docker Compose y claves seguras de desarrollo. **Nunca agregues el archivo `.env` a Git.**

### Paso 4: Levantar la base de datos PostgreSQL
Inicia el contenedor de base de datos con Docker Compose:
```bash
docker compose up -d db
```
Para verificar que el contenedor esté listo y saludable:
```bash
docker ps --filter "name=pujafacil_db"
```
*(Debe mostrar el estado `Up ... (healthy)`).*

### Paso 5: Aplicar migraciones y generar el cliente Prisma
Aplica las migraciones pendientes en la base de datos:
```bash
npx prisma migrate deploy
npx prisma generate
```

### Paso 6: Cargar datos iniciales de prueba (Seed)
Inserta los usuarios de prueba, artículos y subasta demostrativa:
```bash
npm run db:seed
```

### Paso 7: Iniciar el servidor de desarrollo
Inicia el servidor Node con soporte de recarga en caliente y WebSockets:
```bash
npm run dev
```
Verás en consola:
```text
[server] Modo HTTP (desarrollo local sin TLS)
[server] Escuchando en http://localhost:3000
```

### Paso 8: Abrir en el navegador
Ingresa a:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 6. Usuarios de Demostración (Datos Ficticios)

Al ejecutar `npm run db:seed`, se generan las siguientes cuentas de prueba:

| Rol | Correo | Estado |
|---|---|---|
| Administrador de Subastas | `admin@pujafacil.test` | `ACTIVA` |
| Auditor | `auditor@pujafacil.test` | `ACTIVA` |
| Verificador Técnico | `verificador@pujafacil.test` | `ACTIVA` |
| Vendedor | `vendedor@pujafacil.test` | `ACTIVA` |
| Comprador 1 | `comprador1@pujafacil.test` | `ACTIVA` |
| Comprador 2 | `comprador2@pujafacil.test` | `ACTIVA` |
| Cuenta Pendiente | `pendiente@pujafacil.test` | `PENDIENTE` |

> La contraseña para todas las cuentas de prueba se define en la variable `DEMO_PASSWORD` del archivo `.env` local (por defecto `Demo1234!`).

---

## 7. Comandos de Verificación y Calidad

Para comprobar la integridad del proyecto antes de realizar un Pull Request:

```bash
# 1. Comprobar reglas de estilo y tipado con ESLint:
npm run lint

# 2. Ejecutar pruebas automatizadas con Vitest:
npm test

# 3. Compilación optimizada para producción:
npm run build
```

---

## 8. Configuración Opcional de HTTPS / WSS Local

El servidor `server.ts` soporta TLS de forma nativa sin requerir un proxy inverso (Nginx o Caddy). Para activar HTTPS y WebSockets seguros (`wss://`):

1. **Generar certificados locales de desarrollo** (ejemplo con OpenSSL en terminal):
   ```bash
   mkdir -p .certs
   openssl req -x509 -nodes -newkey rsa:2048 -keyout .certs/dev-key.pem -out .certs/dev-cert.pem -days 7 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost"
   ```
2. **Configurar en `.env`:**
   ```dotenv
   HTTPS_KEY_PATH=.certs/dev-key.pem
   HTTPS_CERT_PATH=.certs/dev-cert.pem
   ```
3. **Reiniciar con `npm run dev`** y abrir `https://localhost:3000/`.
4. En DevTools → Red (Network) → WS se puede validar la conexión bajo `wss://localhost:3000/socket.io/...`.

> **Nota de Seguridad:** La carpeta `.certs/` se encuentra excluida en `.gitignore`. Nunca compartas ni subas claves privadas (`*.pem`) al repositorio.

---

## 9. Documentación y Diagramas

- **Modelo de Datos y Entidades:** Detalle de tablas, tipos y relaciones en [`docs/modelo-datos.md`](docs/modelo-datos.md).
- **Esquema Prisma:** Definición completa en [`prisma/schema.prisma`](prisma/schema.prisma).

---

## 10. Declaración sobre el Uso de Inteligencia Artificial

En cumplimiento con las directrices académicas del curso:
- **Herramientas utilizadas:** Asistentes de IA generativa para aceleración de maquetado inicial, scaffolding de tipados TypeScript y esquematización de pruebas unitarias.
- **Alcance de su uso:** Generación de código base, resolución de configuraciones de bundler y revisión sintáctica.
- **Supervisión y autoría:** Todo el código generado fue inspeccionado, adaptado a la arquitectura monolítica requerida, validado contra el esquema de base de datos relacional y probado exhaustivamente por los integrantes del equipo.
